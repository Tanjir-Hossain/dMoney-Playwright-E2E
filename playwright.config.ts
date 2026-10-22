import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for the DMoney portal E2E suite.
 * Docs: https://playwright.dev/docs/test-configuration
 *
 * The suite drives the live practice portal, so runs are headed and
 * every run captures video + screenshots as submission evidence.
 */
export default defineConfig({
  testDir: './tests',

  // A single regression journey can take several minutes end to end
  // (registration, approval, OTP wait, password reset, statement paging).
  timeout: 5 * 60 * 1000,

  // Keep ordering deterministic — the regression flow is stateful.
  fullyParallel: false,

  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,

  reporter: 'html',

  use: {
    baseURL: 'https://dmoneyportal.roadtocareer.net',

  // Headed locally so you can watch it; headless on GitHub (no display there).
    headless: !!process.env.CI,

    screenshot: 'on',
    video: 'on',
    trace: 'on-first-retry',

    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
