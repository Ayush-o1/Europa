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
 * Closes the connection pool (used during graceful shutdown and tests).
 * @returns {Promise<void>}
 */
export async function closePool() {
  if (poolInstance) {
    await poolInstance.end();
    poolInstance = null;
  }
}
