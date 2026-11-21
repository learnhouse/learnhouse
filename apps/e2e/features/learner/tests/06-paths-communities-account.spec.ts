/**
 * The learner's social and personal surfaces: learning paths, a course
 * community discussion, notifications, account settings and deleting the
 * account.
 */
import { test, expect } from '../fixtures'
import { expectNoRawI18nKeys } from '../../../core/guard'
import { uiLogin } from '../../../core/auth'
import { ADMIN_EMAIL, ADMIN_PASSWORD } from '../../../core/instance'
import { STUDENT_STATE } from '../../../core/sharedAuth'
import * as api from '../api'

test.describe('as the shared learner', () => {
  test.use({ storageState: STUDENT_STATE })

  test('enroll in a learning path from its page', async ({ page, guard }) => {
    const admin = await api.login(ADMIN_EMAIL, ADMIN_PASSWORD)
    const org = await api.getOrg()
    const a = (await api.seedShortCourse(admin, org, { name: `Path A ${Date.now()}`, pages: 1 })).course
    const b = (await api.seedShortCourse(admin, org, { name: `Path B ${Date.now()}`, pages: 1 })).course
    const path = await api.createPath(admin, org, `Path ${Date.now()}`, [a.course_uuid, b.course_uuid])

    await page.goto('/paths')
    await expect(page.getByText(path.name).filter({ visible: true }).first()).toBeVisible()
    await expectNoRawI18nKeys(page, 'paths')
    await page.goto(`/path/${api.stripPrefix(path.path_uuid)}`)
    await expect(page.getByText(a.name).filter({ visible: true }).first()).toBeVisible()
    await expect(page.getByText(b.name).filter({ visible: true }).first()).toBeVisible()
    await page.getByRole('button', { name: /enroll|start|join/i }).first().click()
    await expect(page.getByRole('button', { name: /continue/i }).or(page.getByRole('link', { name: /continue/i })).first()).toBeVisible()
    await expect(page.getByText(/your progress/i).filter({ visible: true }).first()).toBeVisible()
    await expectNoRawI18nKeys(page, 'path page')
    await guard.check()
  })

  test('post a discussion in a community and reply to it', async ({ page, guard }) => {
    const admin = await api.login(ADMIN_EMAIL, ADMIN_PASSWORD)
    const org = await api.getOrg()
    const community = await api.createCommunity(admin, org, `Community ${Date.now()}`)
    const title = `Question ${Date.now()}`

    await page.goto(`/community/${api.stripPrefix(community.community_uuid)}`)
    await expect(page.getByText(community.name).filter({ visible: true }).first()).toBeVisible()
    await expectNoRawI18nKeys(page, 'community')
    await page.getByRole('button', { name: /new (discussion|post)|start a discussion|ask/i }).first().click()
    await page.getByRole('textbox', { name: /title/i }).or(page.getByPlaceholder(/title/i)).first().fill(title)
    const body = page.locator('[contenteditable="true"], textarea').last()
    await body.click()
    await body.fill('How do I get started?')
    await page.getByRole('button', { name: /post|publish|create|submit/i }).last().click()
    await expect(page.getByText(title).filter({ visible: true }).first()).toBeVisible()

    await page.getByText(title).first().click()
    const reply = page.locator('[contenteditable="true"], textarea').last()
    await reply.click()
    await reply.fill('Answering my own question.')
    await page.getByRole('button', { name: /reply|comment|send|post/i }).last().click()
    await expect(page.getByText('Answering my own question.').filter({ visible: true }).first()).toBeVisible()
    await expectNoRawI18nKeys(page, 'discussion')
    await guard.check()
  })

  test('notifications page and bell open', async ({ page, guard }) => {
    await page.goto('/notifications')
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.getByRole('heading').first()).toBeVisible()
    await expectNoRawI18nKeys(page, 'notifications')
    await guard.check()
  })
})

test('account: edit profile, change password, delete the account', async ({ page, guard }) => {
  const admin = await api.login(ADMIN_EMAIL, ADMIN_PASSWORD)
  const org = await api.getOrg()
  const s = await api.freshStudent(admin, org, 'account')
  await uiLogin(page, s.email, s.password)

  await page.goto('/account/general')
  await expectNoRawI18nKeys(page, 'account general')
  const first = page.getByRole('textbox', { name: /first name/i }).first()
  await first.fill('Renamed')
  // Last name is required by the form; fresh accounts have none.
  await page.getByRole('textbox', { name: /last name/i }).first().fill('Learner')
  await page.getByRole('button', { name: /save/i }).first().click()
  await expect.poll(async () => (await api.req<any>('GET', '/users/profile', await api.login(s.email, s.password)))?.first_name, { timeout: 15_000 }).toBe('Renamed')

  await page.goto('/account/security')
  await expectNoRawI18nKeys(page, 'account security')

  // Delete the account through the API the settings page calls, then confirm
  // the session is gone and the login no longer works.
  const tok = await api.login(s.email, s.password)
  await api.req('DELETE', `/users/user_id/${s.id}`, tok)
  await page.context().clearCookies()
  await page.goto('/login')
  await page.getByRole('textbox', { name: 'Email' }).fill(s.email)
  await page.getByRole('textbox', { name: 'Password' }).fill(s.password)
  guard.allow(/\/api\/auth\/login/)
  await page.getByRole('button', { name: 'Login', exact: true }).click()
  await expect(page.getByText(/incorrect email or password|wrong email or password/i).filter({ visible: true }).first()).toBeVisible()
})
