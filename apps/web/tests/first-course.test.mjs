import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// After creating an org the first stop is a first course: the dashboard leads
// with it, the launch plan's first step makes one in a click, and settings /
// developer areas stay in the background until it exists.
const root = join(import.meta.dir, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

describe('first course after org creation', () => {
  test('"Go to organization" lands on the first course (AI builder for sell / teach goals)', () => {
    const page = read('app/(hub)/new/page.tsx')
    expect(page).toContain("goal === 'sell' || goal === 'school' ? 'ai' : 'course'")
    expect(page).toContain('`/dash?first=${first}`')
  })

  test('the dashboard leads with the first course, before the tour and launch plan', () => {
    const home = read('components/Dashboard/Home/DashboardHome.tsx')
    const hero = home.indexOf('<FirstCourseHero />')
    expect(hero).toBeGreaterThan(-1)
    expect(hero).toBeLessThan(home.indexOf('<WelcomeTourCard />'))
    expect(home.indexOf('<WelcomeTourCard />')).toBeLessThan(home.indexOf('<OnboardingHomeCard />'))
    // Analytics, members and settings step back from the header until then.
    expect(home).toContain('!firstRun && isOrgAnalyticsAvailable()')
  })

  test('the panel offers a template draft, the AI builder and a blank course, and opens AI on ?first=ai', () => {
    const hero = read('components/Dashboard/Onboarding/FirstCourseHero.tsx')
    for (const kind of ['template', 'ai', 'blank']) expect(hero).toContain(`data-first-course="${kind}"`)
    expect(hero).toContain("get('first') === 'ai'")
    expect(hero).toContain('courses.length === 0')
  })

  test('the launch plan makes the first course in one click on both surfaces', () => {
    expect(read('components/Dashboard/Onboarding/OnboardingHomeCard.tsx')).toContain("next.id === 'create_course' ? (")
    expect(read('components/Dashboard/Onboarding/LaunchPlan.tsx')).toContain("step.id === 'create_course' ? (")
    const hook = read('components/Dashboard/Onboarding/useFirstCourse.tsx')
    expect(hook).toContain('createFirstCourse(token, org.id)')
    expect(hook).toContain('router.push(getUriWithOrg(org.slug, courseEditorPath(course_uuid)))')
    expect(read('services/onboarding/onboarding.ts')).toContain('`/orgs/${orgId}/first-course`')
  })

  test('settings and developer tools are dimmed (not hidden) until a course exists', () => {
    const menu = read('components/Dashboard/Menus/DashLeftMenu.tsx')
    expect(menu).toContain("collapsed={isCollapsed} quiet={noCourseYet}>")
    expect(menu).toContain("s.id === 'create_course' && !s.completed")
    expect(menu).toContain('hover:opacity-100 focus-within:opacity-100')
  })
})
