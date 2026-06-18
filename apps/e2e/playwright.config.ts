import { defineConfig, devices } from '@playwright/test'
import { BASE_URL } from './helpers/instance'

/**
 * E2E config for the LearnHouse assignments acceptance suite.
 *
 * Tests drive a real self-host (booted in global-setup) like a human would.
 * Specs run serially (workers: 1) because they share one instance/org and
 * create courses + users that would otherwise race.
 */
export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  // Multi-user UI flows are slow; give each test room and only one at a time.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
