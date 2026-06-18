/**
 * Goal: prove the assignments LIST dashboard (/dash/assignments) works — search
 * narrows by title, the Published/Drafts status filters segment assignments,
 * and each card exposes Editor + Submissions links. Uses the shared admin
 * session (storageState) so it adds no logins.
 */
import { test, expect } from '../helpers/fixtures'
import { ADMIN_STATE } from '../helpers/sharedAuth'
import { login, getOrg, seedAssignment, setPublished, TaskContents, Org } from '../helpers/api'
import { ADMIN_EMAIL, ADMIN_PASSWORD, BASE_URL, uniqueSuffix } from '../helpers/instance'

test.use({ storageState: ADMIN_STATE })

const suffix = uniqueSuffix()
const PUBLISHED_TITLE = `E2E List Published ${suffix}`
const DRAFT_TITLE = `E2E List Draft ${suffix}`

test.beforeAll(async () => {
  const token = await login(ADMIN_EMAIL, ADMIN_PASSWORD)
  const org: Org = await getOrg()
  const shortTask = {
    title: 'Q',
    assignment_type: 'SHORT_ANSWER' as const,
    contents: TaskContents.shortAnswer(['x'], 'exact'),
  }
  // One published, one draft — distinct unique titles so the list is deterministic
  // even though the org already contains many assignments from other specs.
  await seedAssignment(token, org, {
    courseName: `E2E List Course ${suffix}`,
    assignmentTitle: PUBLISHED_TITLE,
    tasks: [shortTask],
  })
  const draft = await seedAssignment(token, org, {
    courseName: `E2E List Course ${suffix}`,
    assignmentTitle: DRAFT_TITLE,
    tasks: [shortTask],
  })
  await setPublished(token, draft.assignmentUuid, false)
})

test('assignments list supports search, status filters, and per-card links', async ({ page }) => {
  await page.goto(`${BASE_URL}/dash/assignments`)
  await expect(page.getByPlaceholder('Search assignments by name or description...')).toBeVisible({
    timeout: 20_000,
  })

  // Search narrows to just our two seeded assignments (shared unique suffix).
  await page.getByPlaceholder('Search assignments by name or description...').fill(suffix)
  await expect(page.getByRole('link', { name: PUBLISHED_TITLE })).toBeVisible()
  await expect(page.getByRole('link', { name: DRAFT_TITLE })).toBeVisible()

  // Each card exposes Editor + Submissions links.
  await expect(page.getByRole('link', { name: 'Editor' }).first()).toBeVisible()
  await expect(page.getByRole('link', { name: 'Submissions' }).first()).toBeVisible()

  // Published filter → only the published one (within our search scope).
  await page.getByRole('button', { name: 'Published', exact: true }).click()
  await page.waitForTimeout(400)
  await expect(page.getByRole('link', { name: PUBLISHED_TITLE })).toBeVisible()
  await expect(page.getByRole('link', { name: DRAFT_TITLE })).toHaveCount(0)

  // Drafts filter → only the draft one.
  await page.getByRole('button', { name: 'Drafts', exact: true }).click()
  await page.waitForTimeout(400)
  await expect(page.getByRole('link', { name: DRAFT_TITLE })).toBeVisible()
  await expect(page.getByRole('link', { name: PUBLISHED_TITLE })).toHaveCount(0)
})
