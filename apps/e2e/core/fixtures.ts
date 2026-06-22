/**
 * Shared Playwright fixtures.
 *
 * The big one: we suppress LearnHouse's first-run onboarding (the "Welcome"
 * splash + the "Getting Started" checklist) by pre-seeding its localStorage
 * state via an init script that runs before any page script on every
 * navigation. Without this, the onboarding's full-screen overlay intercepts
 * pointer events and makes the dashboard untestable. The key + shape mirror
 * apps/web/components/Hooks/useOnboarding.ts (STORAGE_KEY = 'lh_onboarding').
 */
import { test as base, expect } from '@playwright/test'

const ONBOARDING_KEY = 'lh_onboarding'

/** Fully-completed, dismissed onboarding state — nothing pops up. */
const ONBOARDING_DISMISSED = JSON.stringify({
  completedSteps: [
    'create_course',
    'add_activities',
    'experience_editor',
    'try_playgrounds',
    'invite_users',
    'customize_org',
    'teach_the_world',
  ],
  skippedSteps: [],
  minimized: true,
  expanded: false,
  showAllSteps: false,
  dismissed: true,
  welcomeSeen: true,
})

export const test = base.extend({
  context: async ({ context }, use) => {
    // Runs in the page before any app JS, on every navigation in this context.
    await context.addInitScript(
      ([key, value]) => {
        try {
          window.localStorage.setItem(key, value)
        } catch {
          /* ignore (e.g. storage disabled) */
        }
      },
      [ONBOARDING_KEY, ONBOARDING_DISMISSED] as const,
    )
    await use(context)
  },
})

export { expect }
