/**
 * @fileoverview Safe Test Database Configuration and Cleanup Utility
 *
 * Provides safe test configuration resolution, database cleanup, and strict safeguards
 * preventing accidental execution against development or production databases.
 */

import { query } from '../../src/db/pool.js';
import { loadConfig, config as defaultConfig } from '../../src/config/env.js';

/**
 * Validates that the current environment is safely isolated for destructive test resets.
 * Throws a fatal Error if production or unsafe database target is detected.
 *
 * @param {string} [connectionString=defaultConfig.databaseUrl]
 */
export function assertSafeTestEnvironment(connectionString = defaultConfig.databaseUrl) {
  if (
    process.env.NODE_ENV === 'production' ||
    (connectionString && connectionString.includes('prod'))
  ) {
    throw new Error(
      '[Security Guard] Database cleanup aborted: Refusing to run destructive cleanup against PRODUCTION environment.',
    );
  }

  const isTestDb =
    (connectionString && connectionString.includes('test')) ||
    process.env.ALLOW_DEV_RESET === 'true';

  if (!isTestDb) {
    throw new Error(
      `[Security Guard] Database cleanup aborted: Target database URL does not contain 'test'. URL: ${connectionString}`,
    );
  }
}

/**
 * Resolves safe, unified configuration for integration and end-to-end test suites.
 * Guarantees tests target an authorized test database and carry test environment flags.
 *
 * @param {Record<string, string | undefined>} [overrides={}]
 * @returns {ReturnType<typeof loadConfig>}
 */
export function getTestConfig(overrides = {}) {
  // Ensure NODE_ENV is set to test in the current process
  process.env.NODE_ENV = 'test';

  const baseConfig = loadConfig();

  // Explicitly check for candidate test database URL
  const testDbCandidate =
    overrides.TEST_DATABASE_URL ||
    (overrides.DATABASE_URL && overrides.DATABASE_URL.includes('test')
      ? overrides.DATABASE_URL
      : null) ||
    process.env.TEST_DATABASE_URL ||
    (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('test')
      ? process.env.DATABASE_URL
      : null) ||
    baseConfig.databaseUrl;

  assertSafeTestEnvironment(testDbCandidate);

  return loadConfig({
    ...process.env,
    ...overrides,
    NODE_ENV: 'test',
    DATABASE_URL: testDbCandidate,
    TEST_DATABASE_URL: testDbCandidate,
  });
}

/**
 * Resets all application tables in the test database in dependency order.
 * Uses TRUNCATE on audit_ledger to satisfy its immutability triggers.
 *
 * @param {string} [connectionString=defaultConfig.databaseUrl]
 * @returns {Promise<void>}
 */
export async function resetTestDatabase(connectionString = defaultConfig.databaseUrl) {
  assertSafeTestEnvironment(connectionString);

  await query('TRUNCATE audit_ledger CASCADE;');
  await query('DELETE FROM orbital_screenings;');
  await query('DELETE FROM event_reviews;');
  await query('DELETE FROM event_assessments;');
  await query('DELETE FROM correlation_decisions;');
  await query('DELETE FROM event_observations;');
  await query('DELETE FROM conjunction_events;');
  await query('DELETE FROM batch_errors;');
  await query('DELETE FROM raw_observations;');
  await query('DELETE FROM space_objects;');
  await query('DELETE FROM ingestion_batches;');
}
