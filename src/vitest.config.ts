import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'api',
          include: ['tests/api/**/*.test.ts'],
          globalSetup: ['tests/api/global-setup.ts'],
          // All API tests share one test database, so they run one file at a time.
          fileParallelism: false,
          testTimeout: 20_000,
        },
      },
    ],
  },
});
