/**
 * @fileoverview Transactional SQL Migration Runner
 * Manages incremental, idempotent schema migrations with execution tracking.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool } from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/**
 * Ensures schema_migrations tracking table exists.
 * @param {import('pg').PoolClient} client
 */
async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

/**
 * Applies all pending SQL migrations in alphanumeric order.
 * Uses transactional advisory locking to prevent concurrent migration race conditions.
 *
 * @param {object} [options]
 * @param {string} [options.migrationsDir]
 * @param {string} [options.connectionString]
 * @returns {Promise<{ applied: string[], alreadyApplied: string[] }>}
 */
export async function applyMigrations(options = {}) {
  const migrationsDir = options.migrationsDir || DEFAULT_MIGRATIONS_DIR;
  const pool = getPool(options.connectionString);
  const client = await pool.connect();

  const applied = [];
  const alreadyApplied = [];

  try {
    // Acquire transaction-scoped advisory lock for migrations
    await client.query('BEGIN;');
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('voidline_schema_migrations_lock'));",
    );
    await ensureMigrationsTable(client);

    // Fetch applied migrations
    const res = await client.query('SELECT name FROM schema_migrations ORDER BY id ASC;');
    const appliedSet = new Set(res.rows.map(r => r.name));

    // Read migration files from disk
    const files = await fs.readdir(migrationsDir);
    const sqlFiles = files.filter(f => f.endsWith('.sql')).sort();

    for (const file of sqlFiles) {
      if (appliedSet.has(file)) {
        alreadyApplied.push(file);
        continue;
      }

      const filePath = path.join(migrationsDir, file);
      const sqlContent = await fs.readFile(filePath, 'utf-8');

      // Execute migration inside a SAVEPOINT so individual migration failures are cleanly isolated
      await client.query(`SAVEPOINT migration_${file.replace(/[^a-zA-Z0-9_]/g, '_')};`);
      try {
        await client.query(sqlContent);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1);', [file]);
        await client.query(`RELEASE SAVEPOINT migration_${file.replace(/[^a-zA-Z0-9_]/g, '_')};`);
        applied.push(file);
      } catch (err) {
        await client.query(
          `ROLLBACK TO SAVEPOINT migration_${file.replace(/[^a-zA-Z0-9_]/g, '_')};`,
        );
        throw new Error(`Migration ${file} failed: ${err.message}`, { cause: err });
      }
    }

    await client.query('COMMIT;');
    return { applied, alreadyApplied };
  } catch (err) {
    await client.query('ROLLBACK;');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Returns current migration status.
 * @param {object} [options]
 * @param {string} [options.migrationsDir]
 * @param {string} [options.connectionString]
 * @returns {Promise<{ name: string, applied: boolean, appliedAt: Date | null }[]>}
 */
export async function getMigrationStatus(options = {}) {
  const migrationsDir = options.migrationsDir || DEFAULT_MIGRATIONS_DIR;
  const pool = getPool(options.connectionString);
  const client = await pool.connect();

  try {
    await ensureMigrationsTable(client);
    const res = await client.query('SELECT name, applied_at FROM schema_migrations;');
    const appliedMap = new Map(res.rows.map(r => [r.name, r.applied_at]));

    const files = await fs.readdir(migrationsDir);
    const sqlFiles = files.filter(f => f.endsWith('.sql')).sort();

    return sqlFiles.map(file => ({
      name: file,
      applied: appliedMap.has(file),
      appliedAt: appliedMap.get(file) || null,
    }));
  } finally {
    client.release();
  }
}
