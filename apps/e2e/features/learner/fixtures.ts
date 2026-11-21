/**
 * Learner-module fixtures: the core onboarding-suppressed `test`, plus a
 * `guard` that records page errors and API 5xx for the whole test and fails
 * it at the end if anything slipped through.
 */
import { test as base, expect } from '../../core/fixtures'
import { PageGuard } from '../../core/guard'

export const test = base.extend<{ guard: PageGuard }>({
  guard: async ({ page }, use, testInfo) => {
    const guard = new PageGuard(page)
    await use(guard)
    // A test that already failed keeps its own (more specific) error.
    if (testInfo.status === testInfo.expectedStatus) await guard.check('end of test')
  },
})

export { expect }

/** True on the phone-sized projects (bottom tab bar, no sidebar). */
export function isPhone(projectName: string): boolean {
  return projectName === 'iphone' || projectName === 'android'
}
