import { defineConfig, devices } from '@playwright/test'
import { BASE_URL } from './core/instance'

/**
 * E2E config for the LearnHouse UI acceptance suite.
 *
 * Specs live under feature modules (apps/e2e/features/<area>/tests) and drive a
 * real self-host (booted in global-setup) like a human would. They run serially
 * (workers: 1) because they share one instance/org and create courses + users
 * that would otherwise race. `testDir: './features'` auto-discovers every
 * feature module's specs.
 *
 * Every module runs in desktop Chromium. The learner module (features/learner)
 * also runs across the browser/device matrix below, since learners show up on
 * every engine and screen size. Those extra projects only exist when
 * E2E_BROWSERS=all (CI installs Chromium only); pick one with
 * `E2E_BROWSERS=all bunx playwright test --project=<name>`.
 */
const LEARNER = /features\/learner\/.*\.spec\.ts$/
const MATRIX = process.env.E2E_BROWSERS === 'all'

export default defineConfig({
  testDir: './features',
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
    // Recording every run is wasteful in CI; E2E_VIDEO=1 turns it on for a
    // local run when the point IS the recording (a feature walkthrough).
    video: process.env.E2E_VIDEO === '1' ? 'on' : 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    ...(MATRIX
      ? [
          {
            name: 'firefox',
            testMatch: LEARNER,
            use: { ...devices['Desktop Firefox'] },
          },
          {
            name: 'webkit',
            testMatch: LEARNER,
            use: { ...devices['Desktop Safari'] },
          },
          {
            name: 'iphone',
            testMatch: LEARNER,
            use: { ...devices['iPhone 15'] },
          },
          {
            name: 'android',
            testMatch: LEARNER,
            use: { ...devices['Pixel 7'] },
          },
          {
            name: 'tablet',
            testMatch: LEARNER,
            use: { ...devices['iPad (gen 7)'] },
          },
        ]
      : []),
  ],
})
