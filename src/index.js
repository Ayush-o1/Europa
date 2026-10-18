/**
 * @fileoverview Voidline Server Startup Entrypoint
 *
 * Imports the configured Express application and initiates the HTTP server.
 * Manages graceful shutdown on termination signals.
 */

import { createApp } from './app.js';
import { config } from './config/env.js';
import { closePool } from './db/pool.js';

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`[Voidline Server] Listening on port ${config.port} (${config.nodeEnv})`);
});

/**
 * Handles graceful server and database shutdown.
 * @param {string} signal
 */
async function handleShutdown(signal) {
  console.log(`\n[Voidline Server] Received ${signal}. Initiating graceful shutdown...`);

  server.close(async () => {
    try {
      await closePool();
      console.log('[Voidline Server] Database connections closed. Exiting process.');
      process.exit(0);
    } catch (err) {
      console.error('[Voidline Server] Error during database shutdown:', err);
      process.exit(1);
    }
  });

  // Force close after 10 seconds if graceful shutdown hangs
  setTimeout(() => {
    console.error('[Voidline Server] Forced shutdown after timeout.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
