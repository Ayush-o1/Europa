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
    };

    const config = loadConfig(customEnv);

    expect(config.port).toBe(8080);
    expect(config.nodeEnv).toBe('production');
    expect(config.logLevel).toBe('warn');
    expect(config.databaseUrl).toBe('postgresql://analyst:secret@remote-db:5432/europa_prod');
    expect(config.storageDir).toBe('/var/europa/snapshots');
    expect(config.correlationStepToleranceMinutes).toBe(30);
    expect(config.correlationMaxCumulativeDriftMinutes).toBe(60);
    expect(config.isProduction).toBe(true);
    expect(config.isTest).toBe(false);
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

  it('identifies test environment correctly', () => {
    const testConfig = loadConfig({ NODE_ENV: 'test' });
    expect(testConfig.isTest).toBe(true);
    expect(testConfig.isProduction).toBe(false);
  });
});
