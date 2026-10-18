/**
 * @fileoverview Voidline Environment Configuration Loader
 * Loads and validates core configuration variables with safe fallback defaults.
 */

/**
 * Parses an integer with a fallback value.
 * @param {string | undefined} val
 * @param {number} fallback
 * @returns {number}
 */
function parseInteger(val, fallback) {
  if (val === undefined || val === null || val === '') {
    return fallback;
  }
  const parsed = parseInt(val, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/**
 * Retrieves normalized application configuration.
 * @param {Record<string, string | undefined>} [env=process.env]
 * @returns {Readonly<{
 *   port: number,
 *   nodeEnv: string,
 *   logLevel: string,
 *   databaseUrl: string,
 *   storageDir: string,
 *   correlationStepToleranceMinutes: number,
 *   correlationMaxCumulativeDriftMinutes: number,
 *   isProduction: boolean,
 *   isTest: boolean
 * }>}
 */
export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || (env === process.env ? 'development' : 'development');
  const defaultUser =
    env.PGUSER || env.USER || process.env.PGUSER || process.env.USER || 'postgres';
  const defaultDevDb = `postgresql://${defaultUser}@localhost:5432/voidline_dev`;
  const defaultTestDb = `postgresql://${defaultUser}@localhost:5432/voidline_test`;

  return Object.freeze({
    port: parseInteger(env.PORT, 3000),
    nodeEnv,
    logLevel: env.LOG_LEVEL || 'info',
    databaseUrl:
      env.DATABASE_URL ||
      (nodeEnv === 'test' ? env.TEST_DATABASE_URL || defaultTestDb : defaultDevDb),
    storageDir: env.STORAGE_DIR || './storage/snapshots',
    correlationStepToleranceMinutes: parseInteger(env.CORRELATION_STEP_TOLERANCE_MINUTES, 20),
    correlationMaxCumulativeDriftMinutes: parseInteger(
      env.CORRELATION_MAX_CUMULATIVE_DRIFT_MINUTES,
      45,
    ),
    operatorApiKey:
      env.OPERATOR_API_KEY || (nodeEnv === 'test' ? 'test-operator-key' : 'voidline-dev-key'),
    isProduction: nodeEnv === 'production',
    isTest: nodeEnv === 'test',
  });
}

export const config = loadConfig();
