import { defineConfig, devices } from '@playwright/test';
import { E2E_PORT, TEST_SESSION_SECRET, testDatabaseUrl } from './tests/test-env.js';

// Browser tests run the real app against the separate test database only.
export default defineConfig({
  testDir: './tests/e2e',
  // Separate output folders let two test runs happen side by side.
  outputDir: process.env.PW_OUTPUT_DIR ?? 'test-results',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 4,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Steadier timing: the app turns off smooth scrolling when motion is reduced.
    contextOptions: { reducedMotion: 'reduce' },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'tsx server/index.ts',
    url: `http://localhost:${E2E_PORT}/api/me`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      PORT: String(E2E_PORT),
      DATABASE_URL: testDatabaseUrl(),
      SESSION_SECRET: TEST_SESSION_SECRET,
    },
  },
});
