#!/usr/bin/env node
/**
 * @fileoverview CLI Migration Runner for Voidline
 */

import { applyMigrations, getMigrationStatus } from '../src/db/migrator.js';
import { closePool } from '../src/db/pool.js';

async function main() {
  console.log('--- Voidline Database Migration Runner ---');
  try {
    const { applied, alreadyApplied } = await applyMigrations();
    console.log(`Already applied (${alreadyApplied.length}):`, alreadyApplied.join(', ') || 'none');
    console.log(`Newly applied (${applied.length}):`, applied.join(', ') || 'none');

    const status = await getMigrationStatus();
    console.table(status);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await closePool();
  }
}

main();
