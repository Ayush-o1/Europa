import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: {
      NODE_ENV: 'test',
    },
    include: ['test/**/*.test.js'],
    fileParallelism: false,
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/**', 'test/**', 'storage/**', 'public/**'],
    },
  },
});
