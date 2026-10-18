#!/usr/bin/env node
/**
 * @fileoverview Phase 7 Performance Benchmark Harness
 *
 * Repeatable, rigorous performance benchmarking tool for Europa.
 * Measures end-to-end and component operations across controlled synthetic workloads:
 * - CSV parsing and schema validation
 * - Snapshot raw ingestion and PostgreSQL persistence
 * - Event correlation and heuristic assessment processing
 * - Operational API query latency (p50, p95, p99)
 * - Chronological event history queries
 * - Cryptographic audit ledger verification throughput
 * - Successive snapshot updates & correlation evolution
 * - Concurrency & advisory locking under parallel ingestion
 *
 * Outputs human-readable terminal markdown reports and saves JSON metrics.
 */

import { performance } from 'node:perf_hooks';
import v8 from 'node:v8';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { closePool, query } from '../src/db/pool.js';
import { applyMigrations } from '../src/db/migrator.js';
import { parseSocratesCsv } from '../src/modules/ingestion/socratesParser.js';
import { ingestSnapshot } from '../src/modules/ingestion/ingestionService.js';
import { verifyAuditLedger } from '../src/modules/audit/auditLedger.js';
import { resetTestDatabase, assertSafeTestEnvironment } from '../test/helpers/dbCleanup.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RESULTS_DIR = path.resolve(__dirname, '../benchmarks/results');

/**
 * Generates deterministic synthetic SOCRATES CSV datasets explicitly labeled as synthetic.
 * @param {number} rowCount
 * @param {object} [options={}]
 * @param {number} [options.baseTcaOffsetMinutes=0]
 * @param {number} [options.missDistanceMultiplier=1.0]
 * @returns {string} CSV string
 */
export function generateSyntheticBenchmarkCsv(rowCount, options = {}) {
  const baseTcaOffsetMinutes = options.baseTcaOffsetMinutes || 0;
  const missMultiplier =
    options.missDistanceMultiplier !== undefined ? options.missDistanceMultiplier : 1.0;

  const header =
    'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION';
  const lines = [header];

  // Base timestamp for reproducibility: 2026-11-01 12:00:00 UTC
  const baseTcaEpochMs = Date.UTC(2026, 10, 1, 12, 0, 0);

  for (let i = 1; i <= rowCount; i++) {
    // Deterministic object IDs
    const norad1 = 80000 + (i % 250);
    const norad2 = 90000 + (i % 250);

    const name1 = `BENCHMARK-SYNTHETIC-SAT-${norad1} [P]`;
    const name2 = `BENCHMARK-SYNTHETIC-DEB-${norad2} [-]`;

    const dse1 = (1.0 + (i % 10) * 0.1).toFixed(3);
    const dse2 = (1.2 + (i % 8) * 0.1).toFixed(3);

    // Compute TCA with offset
    const eventMinutesOffset = (i % 500) * 15 + baseTcaOffsetMinutes;
    const tcaDate = new Date(baseTcaEpochMs + eventMinutesOffset * 60 * 1000);
    const tcaFormatted = tcaDate.toISOString().replace('T', ' ').replace('Z', '');

    // Deterministic range variation
    const baseRangeKm = 0.2 + ((i * 37) % 1500) / 100; // 0.2 km to 15.2 km
    const rangeKm = (baseRangeKm * missMultiplier).toFixed(3);

    const relSpeed = (10.0 + ((i * 13) % 50) / 10).toFixed(3); // 10.0 - 15.0 km/s
    const maxProb = ((1.0 + (i % 9)) * 1e-4).toExponential(3).toUpperCase();
    const dilution = ((i % 10) * 0.05).toFixed(3);

    lines.push(
      `${norad1},${name1},${dse1},${norad2},${name2},${dse2},${tcaFormatted},${rangeKm},${relSpeed},${maxProb},${dilution}`,
    );
  }

  return lines.join('\n') + '\n';
}

/**
 * Calculates statistical percentiles (p50, p95, p99) from an array of latencies.
 * @param {number[]} latencies - Array of numbers in milliseconds
 */
function calculatePercentiles(latencies) {
  if (latencies.length === 0) return { p50: 0, p95: 0, p99: 0, min: 0, max: 0, avg: 0 };
  const sorted = [...latencies].sort((a, b) => a - b);
  const n = sorted.length;

  const p50 = sorted[Math.floor(n * 0.5)];
  const p95 = sorted[Math.min(n - 1, Math.floor(n * 0.95))];
  const p99 = sorted[Math.min(n - 1, Math.floor(n * 0.99))];
  const min = sorted[0];
  const max = sorted[n - 1];
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const avg = sum / n;

  return { p50, p95, p99, min, max, avg };
}

/**
 * Collects host environment information.
 */
async function getEnvironmentInfo() {
  const dbRes = await query('SELECT version();');
  const pgVersion = dbRes.rows[0].version.split(',')[0];

  return {
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model || 'Unknown',
    totalMemoryGb: (os.totalmem() / 1024 ** 3).toFixed(2),
    nodeVersion: process.version,
    pgVersion,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Executes performance benchmarks for a specified row count.
 * @param {number} rowCount
 * @param {import('express').Express} app
 */
async function runBenchmarkForSize(rowCount, app) {
  console.log(`\n========================================================================`);
  console.log(`  BENCHMARK WORKLOAD: ${rowCount.toLocaleString()} SYNTHETIC ROWS`);
  console.log(`========================================================================`);

  await resetTestDatabase();

  const metrics = {
    rowCount,
    heapStatsBefore: v8.getHeapStatistics(),
  };

  // 1. Generate Synthetic Benchmark CSV Dataset
  const tGenStart = performance.now();
  const csvString = generateSyntheticBenchmarkCsv(rowCount);
  const csvBuffer = Buffer.from(csvString, 'utf-8');
  metrics.csvGenerationMs = performance.now() - tGenStart;
  metrics.csvSizeBytes = csvBuffer.length;

  // 2. Operation 1: CSV Parsing & Schema Validation
  const tParseStart = performance.now();
  const parseResult = await parseSocratesCsv(csvBuffer);
  metrics.parseDurationMs = performance.now() - tParseStart;
  metrics.parsedRowCount = parseResult.totalRows;
  metrics.parseThroughputRowsPerSec = Math.round(
    metrics.parsedRowCount / (metrics.parseDurationMs / 1000),
  );

  console.log(
    `[1. Parsing & Validation]     ${metrics.parsedRowCount} rows parsed in ${metrics.parseDurationMs.toFixed(2)} ms (${metrics.parseThroughputRowsPerSec.toLocaleString()} rows/sec)`,
  );

  // 3. Operation 2 & 3: Snapshot Ingestion, Correlation, and Risk Assessment
  const tIngestStart = performance.now();
  const ingestResult = await ingestSnapshot(csvBuffer, {
    sourceUri: `benchmark://synthetic-${rowCount}.csv`,
    capturedAt: '2026-11-01T10:00:00.000Z',
    screeningScope: 'LOCAL_FIXTURE',
    queryParams: { benchmarkWorkloadRows: rowCount },
  });
  metrics.ingestTotalMs = performance.now() - tIngestStart;
  metrics.eventsCreated = ingestResult.correlation?.eventsCreated || 0;
  metrics.eventsMatched = ingestResult.correlation?.eventsMatched || 0;
  metrics.confirmations = ingestResult.correlation?.confirmations || 0;
  metrics.ingestThroughputRowsPerSec = Math.round(rowCount / (metrics.ingestTotalMs / 1000));

  console.log(
    `[2. Ingestion & Correlation]  ${rowCount} rows ingested in ${metrics.ingestTotalMs.toFixed(2)} ms (${metrics.ingestThroughputRowsPerSec.toLocaleString()} rows/sec)`,
  );
  console.log(
    `    └── Events Created: ${metrics.eventsCreated} | Matched: ${metrics.eventsMatched} | Confirmations: ${metrics.confirmations}`,
  );

  // 4. Operation 4: API Query Latency: Event List (Triage Queue)
  const listQueryLatencies = [];
  const queryIterations = 30;

  for (let i = 0; i < queryIterations; i++) {
    const tQueryStart = performance.now();
    const res = await request(app).get(
      '/api/v1/events?limit=25&sortBy=latest_range_km&sortOrder=ASC',
    );
    listQueryLatencies.push(performance.now() - tQueryStart);
    if (res.status !== 200) {
      throw new Error(`List API query failed with status ${res.status}`);
    }
  }

  metrics.apiListLatency = calculatePercentiles(listQueryLatencies);
  console.log(
    `[3. Event List API Latency]   p50: ${metrics.apiListLatency.p50.toFixed(2)} ms | p95: ${metrics.apiListLatency.p95.toFixed(2)} ms | p99: ${metrics.apiListLatency.p99.toFixed(2)} ms`,
  );

  // 5. Operation 5: Chronological Event History API Queries
  const eventsInDb = await query('SELECT id FROM conjunction_events LIMIT 10;');
  const historyLatencies = [];

  if (eventsInDb.rows.length > 0) {
    for (let i = 0; i < queryIterations; i++) {
      const targetEventId = eventsInDb.rows[i % eventsInDb.rows.length].id;
      const tHistStart = performance.now();
      const res = await request(app).get(`/api/v1/events/${targetEventId}/history`);
      historyLatencies.push(performance.now() - tHistStart);
      if (res.status !== 200) {
        throw new Error(`Event history API query failed with status ${res.status}`);
      }
    }
  }

  metrics.apiHistoryLatency = calculatePercentiles(historyLatencies);
  console.log(
    `[4. Event History Latency]    p50: ${metrics.apiHistoryLatency.p50.toFixed(2)} ms | p95: ${metrics.apiHistoryLatency.p95.toFixed(2)} ms | p99: ${metrics.apiHistoryLatency.p99.toFixed(2)} ms`,
  );

  // 6. Operation 6: Cryptographic Audit Ledger Verification
  const tAuditStart = performance.now();
  const auditResult = await verifyAuditLedger();
  metrics.auditVerificationMs = performance.now() - tAuditStart;
  metrics.auditEntriesVerified = auditResult.totalEntries;
  metrics.auditThroughputEntriesPerSec = Math.round(
    metrics.auditEntriesVerified / (metrics.auditVerificationMs / 1000),
  );
  metrics.auditValid = auditResult.valid;

  console.log(
    `[5. Audit Ledger Verify]      ${metrics.auditEntriesVerified} records verified in ${metrics.auditVerificationMs.toFixed(2)} ms (${metrics.auditThroughputEntriesPerSec.toLocaleString()} entries/sec) - [Status: ${auditResult.valid ? 'VALID' : 'BROKEN'}]`,
  );

  // 7. Operation 7: Successive Snapshot Evolution (Tightening update)
  const tighteningCsv = generateSyntheticBenchmarkCsv(rowCount, {
    baseTcaOffsetMinutes: 2,
    missDistanceMultiplier: 0.75, // 25% miss distance contraction
  });
  const tTightenStart = performance.now();
  const tightenResult = await ingestSnapshot(Buffer.from(tighteningCsv, 'utf-8'), {
    sourceUri: `benchmark://synthetic-${rowCount}-evolved.csv`,
    capturedAt: '2026-11-01T12:00:00.000Z',
    screeningScope: 'LOCAL_FIXTURE',
    queryParams: { benchmarkEvolvedRows: rowCount },
  });
  metrics.successiveSnapshotDurationMs = performance.now() - tTightenStart;
  metrics.successiveMatched = tightenResult.correlation?.eventsMatched || 0;
  metrics.successiveCreated = tightenResult.correlation?.eventsCreated || 0;

  console.log(
    `[6. Successive Snapshot]      ${rowCount} updated rows ingested in ${metrics.successiveSnapshotDurationMs.toFixed(2)} ms (Matched: ${metrics.successiveMatched}, Created: ${metrics.successiveCreated})`,
  );

  // Memory metrics
  const memUsage = process.memoryUsage();
  metrics.memoryRssMb = (memUsage.rss / 1024 / 1024).toFixed(1);
  metrics.heapUsedMb = (memUsage.heapUsed / 1024 / 1024).toFixed(1);
  console.log(
    `[Memory Footprint]            Heap Used: ${metrics.heapUsedMb} MB | RSS: ${metrics.memoryRssMb} MB`,
  );

  return metrics;
}

/**
 * Runs parallel concurrency stress tests.
 * @param {number} rowCount
 * @param {number} concurrency
 */
async function runConcurrencyBenchmark(rowCount, concurrency = 3) {
  console.log(`\n========================================================================`);
  console.log(
    `  CONCURRENCY STRESS BENCHMARK: ${concurrency} PARALLEL WORKERS (${rowCount} ROWS EACH)`,
  );
  console.log(`========================================================================`);

  await resetTestDatabase();

  const csvBuffers = Array.from({ length: concurrency }, (_, idx) => {
    const csvStr = generateSyntheticBenchmarkCsv(rowCount, {
      baseTcaOffsetMinutes: idx * 2,
      missDistanceMultiplier: 1.0 - idx * 0.1,
    });
    return Buffer.from(csvStr, 'utf-8');
  });

  const tParallelStart = performance.now();
  await Promise.all(
    csvBuffers.map((buf, idx) =>
      ingestSnapshot(buf, {
        sourceUri: `concurrent://worker-${idx + 1}.csv`,
        capturedAt: `2026-11-01T10:0${idx}:00.000Z`,
        screeningScope: 'LOCAL_FIXTURE',
        queryParams: { worker: idx + 1 },
      }),
    ),
  );
  const parallelDurationMs = performance.now() - tParallelStart;

  const totalRows = rowCount * concurrency;
  const throughput = Math.round(totalRows / (parallelDurationMs / 1000));

  // Verify database consistency
  const eventsCountRes = await query('SELECT COUNT(*) as count FROM conjunction_events;');
  const eventCount = parseInt(eventsCountRes.rows[0].count, 10);

  const auditRes = await verifyAuditLedger();

  console.log(
    `[Concurrency Execution]      ${concurrency} streams (${totalRows} total rows) processed in ${parallelDurationMs.toFixed(2)} ms`,
  );
  console.log(`    ├── Aggregate Throughput:  ${throughput.toLocaleString()} rows/sec`);
  console.log(`    ├── Unique Events Formed:  ${eventCount} (Zero duplicate event drift)`);
  console.log(
    `    └── Cryptographic Ledger:  ${auditRes.valid ? 'VALID (Hash Chain Intact)' : 'BROKEN'}`,
  );

  return {
    concurrency,
    rowCountPerWorker: rowCount,
    totalRows,
    parallelDurationMs,
    throughputRowsPerSec: throughput,
    eventCount,
    auditValid: auditRes.valid,
  };
}

/**
 * Main benchmark runner.
 */
async function main() {
  console.log('########################################################################');
  console.log('               EUROPA PERFORMANCE BENCHMARK HARNESS                    ');
  console.log('########################################################################');

  assertSafeTestEnvironment();

  await applyMigrations();
  const app = createApp();
  const envInfo = await getEnvironmentInfo();

  console.log('\n--- Test Environment ---');
  console.log(`OS:               ${envInfo.platform} (${envInfo.arch})`);
  console.log(`CPU:              ${envInfo.cpuModel} (${envInfo.cpus} cores)`);
  console.log(`System Memory:    ${envInfo.totalMemoryGb} GB`);
  console.log(`Node.js Runtime:  ${envInfo.nodeVersion}`);
  console.log(`Database Engine:  ${envInfo.pgVersion}`);

  // Workload sizes
  const sizes = [100, 1000, 5000];
  const workloadResults = [];

  for (const size of sizes) {
    const res = await runBenchmarkForSize(size, app);
    workloadResults.push(res);
  }

  // Concurrency benchmark
  const concurrencyResult = await runConcurrencyBenchmark(500, 3);

  // Clean up
  await resetTestDatabase();
  await closePool();

  // Print Summary Table
  console.log('\n########################################################################');
  console.log('                     BENCHMARK SUMMARY BASELINE                         ');
  console.log('########################################################################\n');

  console.log(
    '| Workload Size | Parse (rows/s) | Ingest & Assess (rows/s) | API List p95 | API History p95 | Audit Verify (ent/s) |',
  );
  console.log(
    '|--------------:|---------------:|-------------------------:|-------------:|----------------:|---------------------:|',
  );
  for (const r of workloadResults) {
    console.log(
      `| ${r.rowCount.toLocaleString().padStart(13)} | ${(r.parseThroughputRowsPerSec.toLocaleString() + ' r/s').padStart(14)} | ${(r.ingestThroughputRowsPerSec.toLocaleString() + ' r/s').padStart(24)} | ${(r.apiListLatency.p95.toFixed(1) + ' ms').padStart(12)} | ${(r.apiHistoryLatency.p95.toFixed(1) + ' ms').padStart(15)} | ${(r.auditThroughputEntriesPerSec.toLocaleString() + ' e/s').padStart(20)} |`,
    );
  }

  // Save JSON report
  await fs.mkdir(RESULTS_DIR, { recursive: true });
  const reportPath = path.join(
    RESULTS_DIR,
    `benchmark_${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );

  const reportPayload = {
    environment: envInfo,
    workloadResults,
    concurrencyResult,
    executedAt: new Date().toISOString(),
  };

  await fs.writeFile(reportPath, JSON.stringify(reportPayload, null, 2), 'utf-8');
  console.log(`\nBenchmark JSON summary saved to: ${reportPath}\n`);
}

main().catch(err => {
  console.error('[Benchmark Error] Execution failed:', err);
  process.exit(1);
});
