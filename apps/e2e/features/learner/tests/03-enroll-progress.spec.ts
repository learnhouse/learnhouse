/**
 * Enrollment → progress → resume, the core learner loop:
 * start a free course from its page, complete activities from the player,
 * see progress on the course page and the trail, resume where you left off,
 * then leave the course.
 */
import { test, expect } from '../fixtures'
import { ADMIN_EMAIL, ADMIN_PASSWORD } from '../../../core/instance'
import { STUDENT_STATE, sharedStudent } from '../../../core/sharedAuth'
import * as api from '../api'

test.use({ storageState: STUDENT_STATE })

test('start a course, complete activities, resume, leave', async ({ page, guard }) => {
  const admin = await api.login(ADMIN_EMAIL, ADMIN_PASSWORD)
  const org = await api.getOrg()
  const { course, pages } = await api.seedShortCourse(admin, org, { name: `Progress ${Date.now()}`, pages: 3 })
  const stu = await api.login(sharedStudent().email, sharedStudent().password)

  // Course page: not enrolled yet → Start Course.
  await page.goto(api.coursePath(course.course_uuid))
  await expect(page.getByRole('heading', { name: course.name }).first()).toBeVisible()
  const start = page.getByRole('button', { name: /start course/i }).first()
  await expect(start).toBeVisible()
  await start.click()
  await expect.poll(async () => Boolean(await api.getRun(stu, course.course_uuid)), { timeout: 15_000 }).toBe(true)

  // Open the first activity and complete it from the player.
  await page.goto(api.activityPath(course.course_uuid, pages[0].activity_uuid))
  await expect(page.getByText('Body of Page 1.')).toBeVisible()
  await page.getByRole('checkbox', { name: /mark as complete/i }).first().click()
  await expect
    .poll(async () => {
      const run = await api.getRun(stu, course.course_uuid)
      return (run?.steps ?? []).filter((s: any) => s.complete !== false).length
    }, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(1)

  // Completing a page moves the learner on to the next one.
  await expect(page.getByText('Body of Page 2.')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(api.stripPrefix(pages[1].activity_uuid)))
  // Going back shows page 1 as done.
  await page.getByRole('navigation', { name: /activity navigation/i }).getByRole('button', { name: /page 1/i }).click()
  await expect(page.getByText('Body of Page 1.')).toBeVisible()
  await expect(page.getByRole('checkbox', { name: /mark as complete/i }).first()).toHaveAttribute('aria-checked', 'true')

  // Course page now offers to continue, and resumes at the first incomplete page.
  await page.goto(api.coursePath(course.course_uuid))
  const cont = page.getByRole('link', { name: /continue/i }).or(page.getByRole('button', { name: /continue/i })).first()
  await expect(cont).toBeVisible()
  await cont.click()
  await expect(page).toHaveURL(new RegExp(api.stripPrefix(pages[1].activity_uuid)))

  // Trail lists the course.
  await page.goto('/trail')
  await expect(page.getByText(course.name).filter({ visible: true }).first()).toBeVisible()

  // Leave the course.
  await page.goto(api.coursePath(course.course_uuid))
  const leave = page.getByRole('button', { name: /leave course/i }).first()
  await expect(leave).toBeVisible()
  await leave.click()
  const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog')).first()
  if (await dialog.isVisible({ timeout: 2000 }).catch(() => false)) {
    await dialog.getByRole('button', { name: /leave|confirm|yes/i }).last().click()
  }
  await expect(page.getByRole('button', { name: /start course/i }).first()).toBeVisible()
  await expect.poll(async () => Boolean(await api.getRun(stu, course.course_uuid)), { timeout: 15_000 }).toBe(false)
  await guard.check()
})
