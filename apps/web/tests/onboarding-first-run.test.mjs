import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// The first run teaches the product: the welcome tour sits on the dashboard
// (not a modal wall), every launch-plan step has its guide video, and nothing
// in onboarding nudges toward a plan or payments.
const root = join(import.meta.dir, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const dir = (p) => readdirSync(join(root, p)).filter((f) => /\.tsx?$/.test(f)).map((f) => `${p}/${f}`)

const onboardingFiles = [
  ...dir('components/Dashboard/Onboarding'),
  ...dir('components/Onboarding').filter((f) => !f.endsWith('PlanPicker.tsx')),
  'app/(hub)/new/page.tsx',
]

describe('first run', () => {
  test('the dashboard opens on the welcome tour, then the launch plan', () => {
    const home = read('components/Dashboard/Home/DashboardHome.tsx')
    expect(home.indexOf('<WelcomeTourCard />')).toBeGreaterThan(-1)
    expect(home.indexOf('<WelcomeTourCard />')).toBeLessThan(home.indexOf('<OnboardingHomeCard />'))
    expect(read('app/orgs/[orgslug]/dash/ClientAdminLayout.tsx')).not.toContain('WelcomeModal')
    const tour = read('components/Dashboard/Onboarding/WelcomeTourCard.tsx')
    expect(tour).toContain('WELCOME_VIDEO')
    expect(tour).toContain('autoPlayMuted')
  })

  test('/new no longer skips the tour', () => {
    expect(read('app/(hub)/new/page.tsx')).not.toContain('welcome_seen')
  })

  test('the launch plan card offers Watch and Do it with the step video', () => {
    const card = read('components/Dashboard/Onboarding/OnboardingHomeCard.tsx')
    for (const s of ["onb2.checklist.watch", "onb2.checklist.do_it", 'onboardingVideo(', 'OnboardingVideo', 'LaunchFinale']) expect(card).toContain(s)
  })

  test('every setup step has a guide video', () => {
    const hook = read('components/Hooks/useOnboarding.ts')
    const media = read('components/Dashboard/Onboarding/onboardingMedia.ts')
    const ids = [...hook.matchAll(/video: '(ob\d)'/g)].map((m) => m[1])
    expect(ids.length).toBeGreaterThanOrEqual(9)
    for (const id of ids) expect(media).toContain(`${id}:`)
  })

  test('no plan picker, upgrade or plan badges anywhere in onboarding', () => {
    for (const f of onboardingFiles) {
      const src = read(f)
      // /new keeps one getUpgradeUrl: a plan already chosen on the pricing page
      // (?plan=) goes to checkout after the org exists. Nothing is offered there.
      const banned = ['PlanPicker', 'openPlanPicker', 'billing.catalog', 'requiredPlan', 'see_plans', ...(f.endsWith('new/page.tsx') ? [] : ['getUpgradeUrl'])]
      for (const bad of banned) {
        expect(`${f}: ${src.includes(bad) ? bad : ''}`).toBe(`${f}: `)
      }
    }
  })

  test('the plan picker lives on Settings → Overview', () => {
    expect(read('components/Dashboard/Pages/Org/OrgEditPlanUsage/OrgEditPlanUsage.tsx')).toContain('ComparePlansButton')
  })
})
