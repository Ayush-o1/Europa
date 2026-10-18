/**
 * @fileoverview Snapshot Ingestion and Provenance Service
 * Manages atomic snapshot ingestion, disk archiving, deduplication, and error reporting.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getPool } from '../../db/pool.js';
import { loadConfig } from '../../config/env.js';
import { parseSocratesCsv } from './socratesParser.js';
import { correlateBatch } from '../correlation/correlatorService.js';

/**
 * Calculates SHA-256 hash of a buffer or string.
 * @param {Buffer | string} content
 * @returns {string}
 */
export function calculateContentHash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Archives raw snapshot file to storage directory with read-only permissions.
 * @param {Buffer | string} content
 * @param {string} contentHash
 * @param {string} storageDir
 * @returns {Promise<string>} Archive file path
 */
async function archiveSnapshot(content, contentHash, storageDir) {
  await fs.mkdir(storageDir, { recursive: true });
  const archivePath = path.join(storageDir, `${contentHash}.csv`);

  try {
    await fs.writeFile(archivePath, content, { mode: 0o444, flag: 'wx' });
  } catch (err) {
    if (err.code !== 'EEXIST') {
      throw err;
    }
  }

  return archivePath;
}

/**
 * Ingests a SOCRATES CSV snapshot into PostgreSQL.
 *
 * @param {string | Buffer} input - File path (string) or file content buffer
 * @param {object} metadata - Ingestion metadata
 * @param {string} metadata.sourceUri - Origin URL or file path
 * @param {Record<string, any>} [metadata.queryParams={}] - Query parameters if fetched via API
 * @param {'FULL_CATALOG_MINRANGE' | 'FILTERED_QUERY' | 'LOCAL_FIXTURE'} [metadata.screeningScope='LOCAL_FIXTURE']
 * @param {string | Date} [metadata.capturedAt] - When the snapshot was retrieved
 * @param {string | Date | null} [metadata.httpLastModified=null] - Server Last-Modified header
 * @param {string | null} [metadata.httpEtag=null] - Server ETag header
 * @param {boolean} [metadata.isSubsequentPoll=false] - True if this represents an un-updated periodic poll
 * @param {object} [options]
 * @param {string} [options.connectionString]
 * @param {string} [options.storageDir]
 * @returns {Promise<{
 *   status: string,
 *   batchId: string,
 *   isDuplicate: boolean,
 *   rowCount: number,
 *   validCount: number,
 *   errorCount: number,
 *   message?: string
 * }>}
 */
export async function ingestSnapshot(input, metadata = {}, options = {}) {
  const config = loadConfig();
  const storageDir = options.storageDir || config.storageDir;
  const pool = getPool(options.connectionString);

  // 1. Resolve content bytes and file path
  let content;
  let sourceUri = metadata.sourceUri;

  if (Buffer.isBuffer(input)) {
    content = input;
    sourceUri = sourceUri || 'buffer://in-memory';
  } else if (typeof input === 'string') {
    try {
      // Check if it's a file path
      content = await fs.readFile(input);
      sourceUri = sourceUri || input;
    } catch {
      // Otherwise treat as raw CSV string
      content = Buffer.from(input, 'utf-8');
      sourceUri = sourceUri || 'string://in-memory';
    }
  } else {
    throw new TypeError('Input must be a valid file path, buffer, or string');
  }

  // 2. Compute cryptographic content hash & archive file
  const contentHash = calculateContentHash(content);
  const archivePath = await archiveSnapshot(content, contentHash, storageDir);

  const capturedAt = metadata.capturedAt
    ? new Date(metadata.capturedAt).toISOString()
    : new Date().toISOString();

  const httpLastModified = metadata.httpLastModified
    ? new Date(metadata.httpLastModified).toISOString()
    : null;

  const screeningScope = metadata.screeningScope || 'LOCAL_FIXTURE';
  const queryParams = metadata.queryParams || {};
  const httpEtag = metadata.httpEtag || null;

  const client = await pool.connect();

  try {
    await client.query('BEGIN;');

    // 3. Inspect existing batches for idempotency
    const existingRes = await client.query(
      `SELECT id, status, captured_at, http_last_modified, row_count, valid_count, error_count
       FROM ingestion_batches
       WHERE content_sha256 = $1
       ORDER BY captured_at ASC;`,
      [contentHash],
    );

    if (existingRes.rows.length > 0) {
      // If it's explicitly an un-updated subsequent poll
      if (metadata.isSubsequentPoll) {
        const supersededBatchRes = await client.query(
          `INSERT INTO ingestion_batches (
             source_uri, query_params, screening_scope, content_sha256,
             archive_file_path, http_etag, http_last_modified, captured_at,
             status, row_count, valid_count, error_count, error_summary
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'SUPERSEDED_UNMODIFIED_POLL', $9, 0, 0, $10)
           RETURNING id;`,
          [
            sourceUri,
            JSON.stringify(queryParams),
            screeningScope,
            contentHash,
            archivePath,
            httpEtag,
            httpLastModified,
            capturedAt,
            existingRes.rows[0].row_count,
            `Unchanged upstream report content identical to prior batch ${existingRes.rows[0].id}`,
          ],
        );

        await client.query('COMMIT;');
        return {
          status: 'SUPERSEDED_UNMODIFIED_POLL',
          batchId: supersededBatchRes.rows[0].id,
          isDuplicate: false,
          rowCount: existingRes.rows[0].row_count,
          validCount: 0,
          errorCount: 0,
          message:
            'Upstream snapshot content unmodified; recorded provenance poll without duplicating rows.',
        };
      }

      const match = existingRes.rows.find(b => {
        // Match exact duplicate: same content hash and (same captured_at OR same http_last_modified)
        if (httpLastModified && b.http_last_modified) {
          return new Date(b.http_last_modified).getTime() === new Date(httpLastModified).getTime();
        }
        return new Date(b.captured_at).getTime() === new Date(capturedAt).getTime();
      });

      if (match && match.status === 'COMPLETED') {
        await client.query('ROLLBACK;');
        return {
          status: 'DUPLICATE_IGNORED',
          batchId: match.id,
          isDuplicate: true,
          rowCount: match.row_count,
          validCount: match.valid_count,
          errorCount: match.error_count,
          message: 'Identical snapshot already processed; no database mutations performed.',
        };
      }
    }

    // 4. Register new batch as PROCESSING
    const batchRes = await client.query(
      `INSERT INTO ingestion_batches (
         source_uri, query_params, screening_scope, content_sha256,
         archive_file_path, http_etag, http_last_modified, captured_at,
         status, row_count, valid_count, error_count
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PROCESSING', 0, 0, 0)
       RETURNING id;`,
      [
        sourceUri,
        JSON.stringify(queryParams),
        screeningScope,
        contentHash,
        archivePath,
        httpEtag,
        httpLastModified,
        capturedAt,
      ],
    );

    const batchId = batchRes.rows[0].id;

    // 5. Parse and validate CSV rows
    const { validRows, errors, totalRows } = await parseSocratesCsv(content);

    // 6. Upsert Space Objects encountered in valid observations
    const spaceObjectsMap = new Map();
    for (const obs of validRows) {
      if (!spaceObjectsMap.has(obs.primaryNoradId)) {
        spaceObjectsMap.set(obs.primaryNoradId, {
          name: obs.primaryObjectName,
          status: obs.primaryOperationalStatus,
        });
      }
      if (!spaceObjectsMap.has(obs.secondaryNoradId)) {
        spaceObjectsMap.set(obs.secondaryNoradId, {
          name: obs.secondaryObjectName,
          status: obs.secondaryOperationalStatus,
        });
      }
    }

    for (const [noradId, meta] of spaceObjectsMap.entries()) {
      await client.query(
        `INSERT INTO space_objects (norad_cat_id, object_name, operational_status, last_seen_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (norad_cat_id) DO UPDATE SET
           object_name = EXCLUDED.object_name,
           operational_status = EXCLUDED.operational_status,
           last_seen_at = EXCLUDED.last_seen_at;`,
        [noradId, meta.name, meta.status, capturedAt],
      );
    }

    // 7. Insert Raw Observations
    for (const obs of validRows) {
      await client.query(
        `INSERT INTO raw_observations (
           batch_id, row_index, captured_at, primary_norad_id, secondary_norad_id,
           canonical_pair_key, tca, tca_range_km, relative_speed_kms, max_prob,
           dilution_km, dse_primary, dse_secondary, imported_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW());`,
        [
          batchId,
          obs.rowIndex,
          capturedAt,
          obs.primaryNoradId,
          obs.secondaryNoradId,
          obs.canonicalPairKey,
          obs.tca,
          obs.tcaRangeKm,
          obs.relativeSpeedKms,
          obs.maxProb,
          obs.dilutionKm,
          obs.dsePrimary,
          obs.dseSecondary,
        ],
      );
    }

    // 8. Insert Batch Errors for rejected rows
    for (const err of errors) {
      await client.query(
        `INSERT INTO batch_errors (
           batch_id, row_index, raw_data, error_code, error_message
         ) VALUES ($1, $2, $3, $4, $5);`,
        [batchId, err.rowIndex, JSON.stringify(err.rawRow), err.errorCode, err.errorMessage],
      );
    }

    // 9. Execute Event Correlation within the same transaction if valid observations exist
    let correlationStats = null;
    if (validRows.length > 0) {
      correlationStats = await correlateBatch(batchId, {
        client,
        policyConfig: options.policyConfig,
      });
    }

    // 10. Finalize batch status
    const finalStatus = validRows.length > 0 ? 'COMPLETED' : 'FAILED';
    const errorSummary =
      errors.length > 0
        ? `Encountered ${errors.length} validation errors out of ${totalRows} total rows`
        : null;

    await client.query(
      `UPDATE ingestion_batches SET
         status = $1,
         row_count = $2,
         valid_count = $3,
         error_count = $4,
         error_summary = $5
       WHERE id = $6;`,
      [finalStatus, totalRows, validRows.length, errors.length, errorSummary, batchId],
    );

    await client.query('COMMIT;');

    return {
      status: finalStatus,
      batchId,
      isDuplicate: false,
      rowCount: totalRows,
      validCount: validRows.length,
      errorCount: errors.length,
      correlation: correlationStats,
    };
  } catch (err) {
    await client.query('ROLLBACK;');
    throw new Error(`Ingestion transaction failed: ${err.message}`, { cause: err });
  } finally {
    client.release();
  }
}
