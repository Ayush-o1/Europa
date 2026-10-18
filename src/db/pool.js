/**
 * @fileoverview PostgreSQL Connection Pool & Query Interface
 */

import pg from 'pg';
import { loadConfig } from '../config/env.js';

const { Pool } = pg;

let poolInstance = null;

/**
 * Initializes or retrieves the singleton PostgreSQL pool.
 * @param {string} [connectionString]
 * @returns {pg.Pool}
 */
export function getPool(connectionString) {
  if (!poolInstance) {
    const config = loadConfig();
    const connStr = connectionString || config.databaseUrl;

    poolInstance = new Pool({
      connectionString: connStr,
      max: config.isTest ? 5 : 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    poolInstance.on('error', err => {
      // Unhandled idle client error logging
      console.error('Unexpected error on idle PostgreSQL client:', err);
    });
  }
  return poolInstance;
}

/**
 * Executes a parameterized SQL query using the pool.
 * @param {string} text
 * @param {any[]} [params]
 * @returns {Promise<pg.QueryResult>}
 */
export async function query(text, params) {
  const pool = getPool();
  return pool.query(text, params);
}

/**
 * Tests connection to the database.
 * @returns {Promise<{ ok: boolean, version: string }>}
 */
export async function testConnection() {
  const res = await query('SELECT version();');
  return {
    ok: true,
    version: res.rows[0].version,
  };
}

/**
 * Executes a callback within a managed database transaction with automatic
 * BEGIN, COMMIT, and safe ROLLBACK. Ensures client is released in all cases.
 *
 * @template T
 * @param {(client: pg.PoolClient) => Promise<T>} callback
 * @param {object} [options={}]
 * @param {string} [options.isolationLevel] - e.g. 'READ COMMITTED', 'SERIALIZABLE'
 * @param {string} [options.connectionString]
 * @returns {Promise<T>}
 */
export async function withTransaction(callback, options = {}) {
  const pool = getPool(options.connectionString);
  const client = await pool.connect();

  try {
    const beginSql = options.isolationLevel
      ? `BEGIN TRANSACTION ISOLATION LEVEL ${options.isolationLevel};`
      : 'BEGIN;';
    await client.query(beginSql);

    const result = await callback(client);

    await client.query('COMMIT;');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK;');
    } catch (rbErr) {
      console.error('[Database Transaction] Rollback encountered error:', rbErr.message);
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Closes the connection pool (used during graceful shutdown and tests).
 * @returns {Promise<void>}
 */
export async function closePool() {
  if (poolInstance) {
    await poolInstance.end();
    poolInstance = null;
  }
}
