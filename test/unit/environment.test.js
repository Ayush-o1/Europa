import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/config/env.js';

describe('Environment Configuration Loader', () => {
  it('loads default values when environment is empty', () => {
    const config = loadConfig({});

    expect(config.port).toBe(3000);
    expect(config.nodeEnv).toBe('development');
    expect(config.logLevel).toBe('info');
    expect(config.storageDir).toBe('./storage/snapshots');
    expect(config.correlationStepToleranceMinutes).toBe(20);
    expect(config.correlationMaxCumulativeDriftMinutes).toBe(45);
    expect(config.isProduction).toBe(false);
    expect(config.isTest).toBe(false);
  });

  it('correctly applies custom environment overrides', () => {
    const customEnv = {
      PORT: '8080',
      NODE_ENV: 'production',
      LOG_LEVEL: 'warn',
      DATABASE_URL: 'postgresql://analyst:secret@remote-db:5432/europa_prod',
      STORAGE_DIR: '/var/europa/snapshots',
      CORRELATION_STEP_TOLERANCE_MINUTES: '30',
      CORRELATION_MAX_CUMULATIVE_DRIFT_MINUTES: '60',
      OPERATOR_API_KEY: 'prod-secure-operator-key-entropy-1234',
    };

    const config = loadConfig(customEnv);

    expect(config.port).toBe(8080);
    expect(config.nodeEnv).toBe('production');
    expect(config.logLevel).toBe('warn');
    expect(config.databaseUrl).toBe('postgresql://analyst:secret@remote-db:5432/europa_prod');
    expect(config.storageDir).toBe('/var/europa/snapshots');
    expect(config.correlationStepToleranceMinutes).toBe(30);
    expect(config.correlationMaxCumulativeDriftMinutes).toBe(60);
    expect(config.operatorApiKey).toBe('prod-secure-operator-key-entropy-1234');
    expect(config.isProduction).toBe(true);
    expect(config.isTest).toBe(false);
  });

  it('rejects production startup when required database configuration is missing', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        OPERATOR_API_KEY: 'prod-secure-operator-key-entropy-1234',
      }),
    ).toThrowError(/DATABASE_URL/);
  });

  it('rejects production startup when required operator secret is missing or insecure', () => {
    // Missing key
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://analyst:secret@remote-db:5432/europa_prod',
      }),
    ).toThrowError(/OPERATOR_API_KEY/);

    // Predictable development key
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://analyst:secret@remote-db:5432/europa_prod',
        OPERATOR_API_KEY: 'europa-dev-key',
      }),
    ).toThrowError(/Predictable development API keys cannot be used/);

    // Insufficient key entropy (< 16 chars)
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://analyst:secret@remote-db:5432/europa_prod',
        OPERATOR_API_KEY: 'short-key',
      }),
    ).toThrowError(/at least 16 characters/);
  });

  it('safely falls back to defaults when numeric environment variables are invalid', () => {
    const invalidEnv = {
      PORT: 'invalid_number',
      CORRELATION_STEP_TOLERANCE_MINUTES: 'not_a_number',
    };

    const config = loadConfig(invalidEnv);

    expect(config.port).toBe(3000);
    expect(config.correlationStepToleranceMinutes).toBe(20);
  });

  it('identifies test environment correctly and prevents silent fallback to dev database', () => {
    const testConfig = loadConfig({ NODE_ENV: 'test' });
    expect(testConfig.isTest).toBe(true);
    expect(testConfig.isProduction).toBe(false);
    expect(testConfig.databaseUrl).toContain('test');

    // When a dev database URL is supplied in test mode, loadConfig rejects it and targets a test database
    const unsafeConfig = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://localhost:5432/europa_dev',
    });
    expect(unsafeConfig.databaseUrl).not.toContain('europa_dev');
    expect(unsafeConfig.databaseUrl).toContain('europa_test');

    // When an explicit test database URL is provided, it is accepted
    const customTestConfig = loadConfig({
      NODE_ENV: 'test',
      TEST_DATABASE_URL: 'postgresql://ci-user:pass@db:5432/custom_ci_test',
    });
    expect(customTestConfig.databaseUrl).toBe('postgresql://ci-user:pass@db:5432/custom_ci_test');
  });
});
