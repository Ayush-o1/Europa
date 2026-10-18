/**
 * @fileoverview Safe Test Database Cleanup Utility
 *
 * Provides safe truncation and cleanup for tests with strict safeguards
 * preventing accidental execution against development or production databases.
 */

import { query } from '../../src/db/pool.js';
import { config } from '../../src/config/env.js';

/**
 * Validates that the current environment is safely isolated for destructive test resets.
 * Throws a fatal Error if production or unsafe database target is detected.
 *
 * @param {string} [connectionString]
 */
export function assertSafeTestEnvironment(connectionString = config.databaseUrl) {
  if (
    config.isProduction ||
    process.env.NODE_ENV === 'production' ||
    connectionString.includes('prod')
  ) {
    throw new Error(
      '[Security Guard] Database cleanup aborted: Refusing to run destructive cleanup against PRODUCTION environment.',
    );
  }

  const isTestDb = connectionString.includes('test') || process.env.ALLOW_DEV_RESET === 'true';
  if (!isTestDb) {
    throw new Error(
      `[Security Guard] Database cleanup aborted: Target database URL does not contain 'test'. URL: ${connectionString}`,
    );
  }
}

/**
 * Resets all application tables in the test database in dependency order.
 * Uses TRUNCATE on audit_ledger to satisfy its immutability triggers.
 *
 * @param {string} [connectionString]
 * @returns {Promise<void>}
 */
export async function resetTestDatabase(connectionString = config.databaseUrl) {
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
