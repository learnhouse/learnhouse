/**
 * Who sees what, and what a learner earns:
 *  - a course linked to a user group is visible to members only;
 *  - a drip-scheduled chapter shows as locked;
 *  - completing every activity awards the certificate, which the public
 *    verify page confirms.
 */
import { test, expect } from '../fixtures'
import { expectNoRawI18nKeys } from '../../../core/guard'
import { ADMIN_EMAIL, ADMIN_PASSWORD } from '../../../core/instance'
import { STUDENT_STATE, sharedStudent } from '../../../core/sharedAuth'
import * as api from '../api'

test.use({ storageState: STUDENT_STATE })

test('member-only course: hidden until the learner joins the group', async ({ page, guard }) => {
  const admin = await api.login(ADMIN_EMAIL, ADMIN_PASSWORD)
  const org = await api.getOrg()
  const { course, pages } = await api.seedShortCourse(admin, org, { name: `Members ${Date.now()}`, public: false })
  const group = await api.createUsergroup(admin, org, `Cohort ${Date.now()}`)
  await api.linkResourceToGroup(admin, group.id, course.course_uuid)

  await page.goto(api.activityPath(course.course_uuid, pages[0].activity_uuid))
  await expect(page.getByText('Body of Page 1.')).toHaveCount(0)

  await api.addUsersToGroup(admin, group.id, [sharedStudent().id])
  await page.goto(api.activityPath(course.course_uuid, pages[0].activity_uuid))
  await expect(page.getByText('Body of Page 1.')).toBeVisible()
  await guard.check()
})

test('drip: a scheduled chapter is locked for a new enrollee', async ({ page, guard }) => {
  const admin = await api.login(ADMIN_EMAIL, ADMIN_PASSWORD)
  const org = await api.getOrg()
  const course = await api.createCourse(admin, org, { name: `Drip ${Date.now()}` })
  const open = await api.createChapter(admin, org, course.id, 'Open now')
  const later = await api.createChapter(admin, org, course.id, 'Opens later')
  await api.createDynamicActivity(admin, org, open.id, 'Open page', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Open body.' }] }] })
  const locked = await api.createDynamicActivity(admin, org, later.id, 'Locked page', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Locked body.' }] }] })
  await api.setDrip(admin, course.course_uuid, later.chapter_uuid)
  await api.enroll(await api.login(sharedStudent().email, sharedStudent().password), course.course_uuid)

  await page.goto(api.coursePath(course.course_uuid))
  await expect(page.getByText('Opens later').filter({ visible: true }).first()).toBeVisible()
  await expectNoRawI18nKeys(page, 'drip course page')
  await page.goto(api.activityPath(course.course_uuid, locked.activity_uuid))
  await expect(page.getByText('Locked body.')).toHaveCount(0)
  await expect(page.getByText(/locked|unlocks|available (on|in)|opens/i).filter({ visible: true }).first()).toBeVisible()
  await expectNoRawI18nKeys(page, 'drip locked activity')
  await guard.check()
})

test('completing a course awards a certificate the verify page confirms', async ({ page, browser, guard }) => {
  const admin = await api.login(ADMIN_EMAIL, ADMIN_PASSWORD)
  const org = await api.getOrg()
  const { course, pages } = await api.seedShortCourse(admin, org, { name: `Cert ${Date.now()}`, pages: 2 })
  await api.createCertification(admin, course.id, `Certified ${course.name}`)
  const stu = await api.login(sharedStudent().email, sharedStudent().password)
  await api.enroll(stu, course.course_uuid)
  await api.completeActivity(stu, pages[0].activity_uuid)

  // The last activity is completed from the player, like a learner would.
  await page.goto(api.activityPath(course.course_uuid, pages[1].activity_uuid))
  await page.getByRole('checkbox', { name: /mark as complete/i }).first().click()
  await expect
    .poll(async () => (await api.myCertificates(stu, org)).find((c: any) => JSON.stringify(c).includes(course.course_uuid)), { timeout: 20_000 })
    .toBeTruthy()
  const cert = (await api.myCertificates(stu, org)).find((c: any) => JSON.stringify(c).includes(course.course_uuid))
  const certUuid: string = cert?.certificate_user?.user_certification_uuid ?? cert?.user_certification_uuid

  // The course page marks the course as done, and the trail lists the
  // certificate with a link to its verify page.
  await page.goto(api.coursePath(course.course_uuid))
  await expect(page.getByText(/course completed/i).filter({ visible: true }).first()).toBeVisible()
  await page.goto('/trail')
  await expect(page.locator(`a[href*="/certificates/${certUuid}/verify"]`).first()).toBeVisible()

  // Anyone can verify it.
  const anon = await browser.newContext()
  const p2 = await anon.newPage()
  await p2.goto(`/certificates/${certUuid}/verify`)
  await expect(p2.getByText(course.name).filter({ visible: true }).first()).toBeVisible()
  await expect(p2.getByText(/valid|verified|authentic/i).filter({ visible: true }).first()).toBeVisible()
  await expectNoRawI18nKeys(p2, 'certificate verify')
  await anon.close()
  await guard.check()
})
