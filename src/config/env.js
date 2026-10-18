/**
 * @fileoverview Europa Environment Configuration Loader
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
  const isTest = nodeEnv === 'test';

  const defaultUser =
    env.PGUSER ||
    process.env.PGUSER ||
    (process.env.GITHUB_ACTIONS === 'true' || process.env.CI === 'true'
      ? 'postgres'
      : env.USER || (env === process.env ? process.env.USER : undefined) || 'postgres');

  const defaultDevDb = `postgresql://${defaultUser}@localhost:5432/europa_dev`;
  const defaultTestDb = `postgresql://${defaultUser}@localhost:5432/europa_test`;

  let databaseUrl;
  if (isTest) {
    // In test environment, prioritize explicit test database URL and prevent silent fallbacks to dev or prod databases
    databaseUrl =
      env.TEST_DATABASE_URL ||
      (env.DATABASE_URL && env.DATABASE_URL.includes('test') ? env.DATABASE_URL : undefined) ||
      (env === process.env ? process.env.TEST_DATABASE_URL : undefined) ||
      (env === process.env && process.env.DATABASE_URL && process.env.DATABASE_URL.includes('test')
        ? process.env.DATABASE_URL
        : undefined) ||
      defaultTestDb;
  } else {
    databaseUrl = env.DATABASE_URL || defaultDevDb;
  }

  return Object.freeze({
    port: parseInteger(env.PORT, 3000),
    host: env.HOST || '0.0.0.0',
    nodeEnv,
    logLevel: env.LOG_LEVEL || 'info',
    databaseUrl,
    storageDir: env.STORAGE_DIR || './storage/snapshots',
    correlationStepToleranceMinutes: parseInteger(env.CORRELATION_STEP_TOLERANCE_MINUTES, 20),
    correlationMaxCumulativeDriftMinutes: parseInteger(
      env.CORRELATION_MAX_CUMULATIVE_DRIFT_MINUTES,
      45,
    ),
    operatorApiKey: env.OPERATOR_API_KEY || (isTest ? 'test-operator-key' : 'europa-dev-key'),
    isProduction: nodeEnv === 'production',
    isTest,
  });
}

export const config = loadConfig();
