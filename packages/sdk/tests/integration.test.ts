// Runs against a live LearnHouse API. Skipped automatically when nothing
// answers at LEARNHOUSE_SDK_IT_URL (default http://localhost:1338).
//   LEARNHOUSE_SDK_IT_URL              API origin
//   LEARNHOUSE_SDK_IT_ORG              org slug (default "default")
//   LEARNHOUSE_SDK_IT_ADMIN_EMAIL      an org admin: turns on the signed-in,
//   LEARNHOUSE_SDK_IT_ADMIN_PASSWORD   API token and embed session flows below
//
// The authenticated flows create their own course, learners and API token in
// that org, so point them at a throwaway database, never a real one.
import { beforeAll, describe, expect, it } from 'vitest'
import {
  ApiTokenInBrowserError,
  courseProgress,
  createClient,
  isLearnHouseError,
  LearnHouseError,
  type LearnHouseClient,
  type LoginSuccess,
} from '../src'

declare const process: { env: Record<string, string | undefined> }

const BASE = process.env.LEARNHOUSE_SDK_IT_URL || 'http://localhost:1338'
const ORG = process.env.LEARNHOUSE_SDK_IT_ORG || 'default'
const ADMIN_EMAIL = process.env.LEARNHOUSE_SDK_IT_ADMIN_EMAIL
const ADMIN_PASSWORD = process.env.LEARNHOUSE_SDK_IT_ADMIN_PASSWORD

async function reachable(): Promise<boolean> {
  try {
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), 1500)
    const res = await fetch(`${BASE}/api/v1/health`, { signal: ac.signal })
    clearTimeout(t)
    return res.ok
  } catch {
    return false
  }
}

/** A 1×1 PNG. */
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='),
  (ch) => ch.charCodeAt(0),
)

const up = await reachable()
const authFlows = up && !!ADMIN_EMAIL && !!ADMIN_PASSWORD
const run = Date.now().toString(36)

describe.skipIf(!up)(`integration against ${BASE}`, () => {
  const client = createClient({ baseUrl: BASE, timeoutMs: 15_000 })

  it('reads an org, its courses, a course structure and an activity anonymously', async () => {
    const org = await client.orgs.get(ORG)
    expect(org.slug).toBe(ORG)
    expect(org.org_uuid).toMatch(/^org_/)

    const courses = await client.courses.list(ORG, { limit: 5 })
    expect(Array.isArray(courses)).toBe(true)
    if (!courses.length) return

    const course = await client.courses.get(courses[0].course_uuid as string)
    expect(course.course_uuid).toBe(courses[0].course_uuid)

    const meta = await client.courses.getMeta(course.course_uuid as string, { slim: true })
    expect(Array.isArray(meta.chapters)).toBe(true)

    const firstActivityUuid = meta.chapters
      .flatMap((ch) => (Array.isArray(ch.activities) ? (ch.activities as unknown[]) : []))
      .map((a) => (a as { activity_uuid?: unknown } | null)?.activity_uuid)
      .find((u): u is string => typeof u === 'string')
    if (firstActivityUuid) {
      const activity = await client.activities.get(firstActivityUuid)
      expect(activity.activity_uuid).toBe(firstActivityUuid)
      expect(activity).toHaveProperty('content')
    }

    const thumb = client.media.getCourseThumbnailMediaDirectory(org.org_uuid as string, course.course_uuid as string, 'x.png')
    expect(thumb.startsWith(`${BASE}/content/orgs/`)).toBe(true)
  })

  it('maps a real 404 to LearnHouseError', async () => {
    const err = await client.courses.get('course_does-not-exist-sdk-test').catch((e) => e)
    expect(err).toBeInstanceOf(LearnHouseError)
    expect([403, 404]).toContain(err.status)
    expect(err.path).toBe('/api/v1/courses/{course_uuid}')
  })

  it('rejects an anonymous caller on a user-only route', async () => {
    const err = await client.trail.get().catch((e) => e)
    expect(err).toBeInstanceOf(LearnHouseError)
    expect(err.status).toBe(401)
  })

  it('reads public instance info', async () => {
    const info = await client.instance.info()
    expect(['single', 'multi']).toContain(info.tenancy)
    expect(typeof info.mode).toBe('string')
  })

  it('magic link and password reset requests answer the same for unknown addresses', async () => {
    const magic = await client.auth.requestMagicLink({ email: `nobody-${run}@sdkit.dev`, orgSlug: ORG })
    expect(typeof magic.detail).toBe('string')
    const resend = await client.auth.resendVerification({ email: `nobody-${run}@sdkit.dev` })
    expect(typeof resend.message).toBe('string')
  })
})

// ---------------------------------------------------------------------------

/**
 * The widest rights an org API token may get from this admin: a token can't
 * hold more than its creator's role, and the token-only buckets are capped by
 * a role bucket (certifications and search by courses, payments by
 * organizations).
 */
function tokenRightsFrom(roleRights: Record<string, unknown>): Record<string, Record<string, boolean>> {
  const flags = (bucket: unknown) =>
    Object.fromEntries(
      Object.entries((bucket ?? {}) as Record<string, unknown>).filter(
        ([k, v]) => k.startsWith('action_') && !k.endsWith('_own') && v === true,
      ),
    ) as Record<string, boolean>
  const caps: Record<string, string> = { certifications: 'courses', search: 'courses', payments: 'organizations' }
  const buckets = ['courses', 'activities', 'coursechapters', 'folders', 'media', 'usergroups', 'users', 'roles', 'assignments']
  const out: Record<string, Record<string, boolean>> = {}
  for (const b of buckets) out[b] = flags(roleRights[b])
  for (const [b, cap] of Object.entries(caps)) out[b] = flags(roleRights[cap])
  // Search is read-only.
  out.search = out.search.action_read ? { action_read: true } : {}
  return out
}

describe.skipIf(!authFlows)('authenticated flows', () => {
  const anon = createClient({ baseUrl: BASE, timeoutMs: 20_000 })
  let admin: LearnHouseClient
  let orgId: number
  let courseUuid: string
  let courseId: number
  let pageActivityUuid: string
  let pageActivityId: number
  let assignmentActivityUuid: string
  let assignmentUuid: string
  let textTaskUuid: string
  let fileTaskUuid: string
  let apiToken: string
  let communityUuid: string

  beforeAll(async () => {
    // Sign in as the org admin with the SDK itself.
    const res = await anon.auth.login({ email: ADMIN_EMAIL!, password: ADMIN_PASSWORD!, orgSlug: ORG })
    if (res.mfa_required) throw new Error('the integration admin must not have two-factor enabled')
    const adminToken = res.tokens.access_token
    admin = createClient({ baseUrl: BASE, token: adminToken, timeoutMs: 20_000 })

    const org = await admin.orgs.get(ORG)
    orgId = org.id as number

    // A published public course: one page, one assignment with two tasks.
    const form = new FormData()
    form.append('name', `SDK IT ${run}`)
    form.append('description', 'Created by the SDK integration suite')
    form.append('public', 'true')
    form.append('about', 'about')
    const course = await admin.POST('/api/v1/courses/', { params: { query: { org_id: orgId } }, body: form })
    courseUuid = course.course_uuid as string
    courseId = course.id as number
    await admin.PUT('/api/v1/courses/{course_uuid}', {
      params: { path: { course_uuid: courseUuid } },
      body: { published: true, public: true },
    })
    const chapter = await admin.POST('/api/v1/chapters/', {
      body: { name: 'Week 1', org_id: orgId, course_id: courseId },
    })
    const page = await admin.POST('/api/v1/activities/', {
      body: {
        name: 'Welcome',
        chapter_id: chapter.id as number,
        activity_type: 'TYPE_DYNAMIC',
        activity_sub_type: 'SUBTYPE_DYNAMIC_PAGE',
        published: true,
        content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }] },
      },
    })
    pageActivityUuid = page.activity_uuid as string
    pageActivityId = page.id as number
    const asgActivity = await admin.POST('/api/v1/activities/', {
      body: {
        name: 'Homework',
        chapter_id: chapter.id as number,
        activity_type: 'TYPE_ASSIGNMENT',
        activity_sub_type: 'SUBTYPE_ASSIGNMENT_ANY',
        published: true,
      },
    })
    assignmentActivityUuid = asgActivity.activity_uuid as string
    const assignment = await admin.POST('/api/v1/assignments/', {
      body: {
        title: 'Homework',
        description: 'Answer and upload',
        grading_type: 'PERCENTAGE',
        published: true,
        allow_retries: true,
        max_retries: 3,
        org_id: orgId,
        course_id: courseId,
        chapter_id: chapter.id as number,
        activity_id: asgActivity.id as number,
      },
    })
    assignmentUuid = assignment.assignment_uuid
    await admin.POST('/api/v1/assignments/{assignment_uuid}/tasks', {
      params: { path: { assignment_uuid: assignmentUuid } },
      body: { title: 'Your answer', description: 'Anything', hint: '', assignment_type: 'CUSTOM', contents: { prompt: 'Why?' } },
    })
    await admin.POST('/api/v1/assignments/{assignment_uuid}/tasks', {
      params: { path: { assignment_uuid: assignmentUuid } },
      body: { title: 'Upload', description: 'A file', hint: '', assignment_type: 'FILE_SUBMISSION' },
    })
    const tasks = await admin.assignments.listTasks(assignmentUuid)
    textTaskUuid = tasks.find((t) => t.assignment_type === 'CUSTOM')!.assignment_task_uuid
    fileTaskUuid = tasks.find((t) => t.assignment_type === 'FILE_SUBMISSION')!.assignment_task_uuid

    await admin.POST('/api/v1/certifications/', { body: { course_id: courseId, config: {} } })
    const community = await admin.POST('/api/v1/communities/', {
      params: { query: { org_id: orgId } },
      body: { name: `SDK IT ${run}`, public: true, course_id: courseId },
    })
    communityUuid = community.community_uuid

    await admin.POST('/api/v1/courses/{course_uuid}/updates', {
      params: { path: { course_uuid: courseUuid } },
      body: { title: 'Welcome aboard', content: 'First update', org_id: orgId },
    })

    const session = await admin.users.session()
    const role = (session.roles as Array<{ org?: { id?: number }; role?: { rights?: Record<string, unknown> } }>).find(
      (r) => r.org?.id === orgId,
    )
    const created = await admin.POST('/api/v1/orgs/{org_id}/api-tokens', {
      params: { path: { org_id: orgId } },
      body: { name: `sdk-it-${run}`, rights: tokenRightsFrom(role?.role?.rights ?? {}) as never },
    })
    apiToken = created.token
  }, 120_000)

  describe('signed-in learner: signup → login → enroll → learn → progress → assignment → logout', () => {
    const email = `learner-${run}@sdkit.dev`
    const password = `Learn-${run}-Pass!9`
    let learner: LearnHouseClient
    let tokens: LoginSuccess['tokens']
    let userId: number

    it('signs up into the org and signs in', async () => {
      const user = await anon.auth.signup({
        email,
        username: `learner_${run}`,
        password,
        firstName: 'Ada',
        lastName: 'Lovelace',
        orgId,
      })
      expect(user.email).toBe(email)
      userId = user.id

      const res = await anon.auth.login({ email, password, orgSlug: ORG })
      expect(res.mfa_required).toBeFalsy()
      if (res.mfa_required) return
      tokens = res.tokens
      expect(tokens.access_token).toBeTruthy()
      expect(tokens.refresh_token).toBeTruthy()
      learner = createClient({ baseUrl: BASE, getToken: () => tokens.access_token, timeoutMs: 20_000 })
    })

    it('reads who they are', async () => {
      const me = await learner.auth.me()
      expect(me.is_api_token).toBe(false)
      const session = await learner.users.session()
      expect(session.user.email).toBe(email)
      const profile = await learner.users.profile()
      expect(profile.id).toBe(userId)
      const mine = await learner.orgs.listMine()
      expect(mine.map((o) => o.slug)).toContain(ORG)
      const pub = await learner.users.getById(userId)
      expect(pub.user_uuid).toBe(profile.user_uuid)
      expect(await learner.users.getByUsername(profile.username)).toMatchObject({ id: userId })
    })

    it('updates their profile and preferences', async () => {
      const profile = await learner.users.profile()
      const updated = await learner.users.update(userId, {
        username: profile.username,
        email: profile.email,
        first_name: 'Augusta',
        bio: 'Learning with the SDK',
      })
      expect(updated.first_name).toBe('Augusta')
      const prefs = await learner.users.updatePreferences({ theme: 'dark' })
      expect(prefs.theme).toBe('dark')
      expect((await learner.users.getPreferences()).theme).toBe('dark')
    })

    it('uploads an avatar', async () => {
      const user = await learner.users.updateAvatar(userId, new Blob([PNG], { type: 'image/png' }), { filename: 'me.png' })
      expect(user.avatar_image).toBeTruthy()
    })

    it('browses the catalog and course announcements', async () => {
      const found = await learner.courses.search(ORG, `SDK IT ${run}`)
      expect(found.map((c) => c.course_uuid)).toContain(courseUuid)
      const updates = await learner.courses.listUpdates(courseUuid)
      expect(updates.map((u) => u.title)).toContain('Welcome aboard')
      expect((await learner.courses.getById(courseId)).course_uuid).toBe(courseUuid)
    })

    it('enrolls, completes an activity and reads progress', async () => {
      const afterEnroll = await learner.trail.startCourse(courseUuid)
      expect(courseProgress(afterEnroll, courseUuid).enrolled).toBe(true)
      const twice = await learner.trail.startCourse(courseUuid).catch((e) => e)
      expect(isLearnHouseError(twice) && twice.status).toBe(400)

      const afterComplete = await learner.trail.completeActivity(pageActivityUuid)
      expect(courseProgress(afterComplete, courseId).completedActivityIds).toContain(pageActivityId)

      const progress = await learner.trail.getCourseProgress(orgId, courseUuid)
      expect(progress).toMatchObject({ enrolled: true, completed: 1, total: 2, percent: 50 })

      const undone = await learner.trail.uncompleteActivity(pageActivityUuid)
      expect(courseProgress(undone, courseId).completed).toBe(0)
      await learner.trail.completeActivity(pageActivityUuid)
      expect((await learner.activities.getById(pageActivityId)).activity_uuid).toBe(pageActivityUuid)
    })

    it('does the assignment: answer, upload, submit, read back, retry', async () => {
      const assignment = await learner.assignments.getForActivity(assignmentActivityUuid)
      expect(assignment.assignment_uuid).toBe(assignmentUuid)
      const tasks = await learner.assignments.listTasks(assignmentUuid)
      expect(tasks).toHaveLength(2)
      expect((await learner.assignments.getTask(textTaskUuid)).title).toBe('Your answer')

      const before = await learner.assignments.getMyTaskSubmissions(assignmentUuid)
      expect(before[textTaskUuid]).toBeNull()
      const missing = await learner.assignments.getMyTaskSubmission(assignmentUuid, textTaskUuid).catch((e) => e)
      expect(isLearnHouseError(missing) && missing.status).toBe(404)

      const saved = await learner.assignments.saveTaskSubmission(assignmentUuid, textTaskUuid, {
        taskSubmission: { answer: 'Because it works' },
      })
      expect(saved.task_submission).toEqual({ answer: 'Because it works' })
      const again = await learner.assignments.saveTaskSubmission(assignmentUuid, textTaskUuid, {
        taskSubmission: { answer: 'Edited' },
        submissionUuid: saved.assignment_task_submission_uuid,
      })
      expect(again.assignment_task_submission_uuid).toBe(saved.assignment_task_submission_uuid)
      expect((await learner.assignments.getMyTaskSubmission(assignmentUuid, textTaskUuid)).task_submission).toEqual({
        answer: 'Edited',
      })

      // Submission files must be one of the allowed types (PDF, images, Office, zip, audio, video).
      const upload = await learner.assignments.uploadTaskFile(assignmentUuid, fileTaskUuid, new Blob([PNG], { type: 'image/png' }), {
        filename: 'answer.png',
      })
      expect(upload.file_uuid).toBeTruthy()
      await learner.assignments.saveTaskSubmission(assignmentUuid, fileTaskUuid, { taskSubmission: { fileUUID: upload.file_uuid } })

      const submitted = await learner.assignments.submit(assignmentUuid)
      expect(['SUBMITTED', 'GRADED', 'LATE']).toContain(submitted.submission_status)
      const mine = await learner.assignments.getMySubmission(assignmentUuid)
      expect(mine[0].user_id).toBe(userId)
      const listed = await learner.assignments.listMine(orgId)
      expect(listed.map((a) => a.assignment_uuid)).toContain(assignmentUuid)

      // The teacher grades it; the learner reads the grade and retries.
      await admin.PUT('/api/v1/assignments/{assignment_uuid}/submissions/{user_id}', {
        params: { path: { assignment_uuid: assignmentUuid, user_id: userId } },
        body: { assignment_id: assignment.id, grade: 80, submission_status: 'GRADED' },
      })
      const grade = await learner.assignments.getGrade(assignmentUuid, userId)
      expect(grade.grading_type).toBe('PERCENTAGE')
      expect(typeof grade.percentage).toBe('number')
      expect(grade.tasks).toHaveLength(2)
      const retry = await learner.assignments.retry(assignmentUuid)
      expect(retry.attempt_number).toBe(2)
    })

    it('keeps private notes on an activity', async () => {
      const note = await learner.notes.create(pageActivityUuid, {
        content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'remember this' }] }] },
      })
      expect(note.activity_uuid).toBe(pageActivityUuid)
      const list = await learner.notes.list(orgId, { courseUuid })
      expect(list.notes.map((n) => n.note_uuid)).toContain(note.note_uuid)
      await learner.notes.delete(note.note_uuid)
      expect(await learner.notes.listForActivity(pageActivityUuid)).toEqual([])
    })

    it('reads notifications, certificates, paths, groups and the calendar', async () => {
      const page = await learner.notifications.list({ limit: 5 })
      expect(Array.isArray(page.items)).toBe(true)
      const unread = await learner.notifications.unreadCount()
      expect(typeof unread.unread_count).toBe('number')
      await learner.notifications.markRead({ all: true })
      expect((await learner.notifications.unreadCount()).unread_count).toBe(0)
      expect(Array.isArray(await learner.certificates.listMine({ orgId }))).toBe(true)
      expect(await learner.certificates.listMineForCourse(courseUuid)).toEqual([])
      expect(Array.isArray(await learner.paths.list(orgId))).toBe(true)
      expect(Array.isArray(await learner.paths.listMine(orgId))).toBe(true)
      const groups = await learner.usergroups.listMine(orgId)
      expect(Array.isArray(groups.member_of)).toBe(true)
      const now = new Date()
      const events = await learner.calendar.events(orgId, { start: new Date(now.getTime() - 864e5), end: new Date(now.getTime() + 30 * 864e5) })
      expect(Array.isArray(events)).toBe(true)
      expect((await learner.auth.mfa.status()).enabled).toBe(false)
      expect(Array.isArray(await learner.communities.list(orgId))).toBe(true)
    })

    it('posts in the course community: discuss, reply, vote, react', async () => {
      expect((await learner.communities.getForCourse(courseUuid))?.community_uuid).toBe(communityUuid)
      const labels = await learner.discussions.labels()
      const discussion = await learner.communities.createDiscussion(communityUuid, {
        title: 'How do I start?',
        content: 'First question',
        label: labels[0]?.id,
      })
      const listed = await learner.communities.listDiscussions(communityUuid, { sortBy: 'recent' })
      expect(listed.map((d) => d.discussion_uuid)).toContain(discussion.discussion_uuid)
      const comment = await learner.discussions.reply(discussion.discussion_uuid, 'Answering myself')
      expect((await learner.discussions.listComments(discussion.discussion_uuid)).map((c) => c.comment_uuid)).toContain(comment.comment_uuid)
      expect((await learner.discussions.countComments(discussion.discussion_uuid)).count).toBe(1)
      const edited = await learner.discussions.updateComment(comment.comment_uuid, 'Edited answer')
      expect(edited.content).toBe('Edited answer')
      // The author's own upvote comes with the discussion.
      expect(discussion.upvote_count).toBe(1)
      const again = await learner.discussions.vote(discussion.discussion_uuid).catch((e) => e)
      expect(isLearnHouseError(again) && again.status).toBe(400)
      await learner.discussions.unvote(discussion.discussion_uuid)
      expect((await learner.discussions.get(discussion.discussion_uuid)).upvote_count).toBe(0)
      await learner.discussions.vote(discussion.discussion_uuid)
      expect((await learner.discussions.get(discussion.discussion_uuid)).upvote_count).toBe(1)
      const reacted = await learner.discussions.react(discussion.discussion_uuid, '👍')
      expect(reacted.action).toBe('added')
      expect((await learner.discussions.listReactions(discussion.discussion_uuid))[0]).toMatchObject({ emoji: '👍', count: 1 })
      await learner.discussions.deleteComment(comment.comment_uuid)
      await learner.discussions.delete(discussion.discussion_uuid)
    })

    it('changes the password, refreshes the session and signs out', async () => {
      const newPassword = `${password}-2`
      await learner.users.changePassword(userId, { oldPassword: password, newPassword })
      // Changing the password signs other sessions out: sign in again.
      const res = await anon.auth.login({ email, password: newPassword, orgSlug: ORG })
      if (res.mfa_required) throw new Error('unexpected 2FA')
      tokens = res.tokens

      const rotated = await anon.auth.refresh({ refreshToken: tokens.refresh_token })
      expect(rotated.access_token).toBeTruthy()
      expect(rotated.refresh_token).not.toBe(tokens.refresh_token)
      tokens = { ...tokens, ...rotated }
      expect((await learner.users.session()).user.id).toBe(userId)

      // Logout revokes tokens issued strictly before the current second; let
      // this one age past it (API timestamps are whole seconds).
      await new Promise((r) => setTimeout(r, 1100))
      await learner.auth.logout()
      const after = await learner.trail.get().catch((e) => e)
      expect(isLearnHouseError(after) && after.status).toBe(401)
    })
  })

  describe('server side with an org API token (Admin API)', () => {
    let server: LearnHouseClient
    let userId: number
    const email = `provisioned-${run}@sdkit.dev`

    beforeAll(() => {
      server = createClient({ baseUrl: BASE, token: apiToken, timeoutMs: 20_000 })
    })

    it('knows it is an API token and reads content', async () => {
      const me = await server.auth.me()
      expect(me.is_api_token).toBe(true)
      expect(me.org_slug).toBe(ORG)
      const courses = await server.courses.list(ORG, { limit: 100 })
      expect(courses.map((c) => c.course_uuid)).toContain(courseUuid)
      expect((await server.courses.getMeta(courseUuid)).chapters.length).toBe(1)
    })

    it('is refused on session-only routes', async () => {
      for (const call of [() => server.trail.get(), () => server.users.session(), () => server.notifications.list()]) {
        const err = await call().catch((e) => e)
        expect(isLearnHouseError(err)).toBe(true)
        expect([401, 403]).toContain(err.status)
      }
    })

    it('provisions, enrolls, completes, reads progress and certificates', async () => {
      const user = await server.admin.users.provision(ORG, {
        email,
        username: `provisioned_${run}`,
        first_name: 'Grace',
        last_name: 'Hopper',
      })
      userId = user.id
      expect((await server.admin.users.getByEmail(ORG, email)).id).toBe(userId)
      const updated = await server.admin.users.update(ORG, userId, { bio: 'Provisioned by the SDK' })
      expect(updated.bio).toBe('Provisioned by the SDK')

      const trail = await server.admin.enrollments.enroll(ORG, userId, courseUuid)
      expect(courseProgress(trail, courseUuid).enrolled).toBe(true)
      expect((await server.admin.enrollments.checkAccess(ORG, courseUuid, userId)).is_enrolled).toBe(true)
      const enrolled = await server.admin.enrollments.listForCourse(ORG, courseUuid)
      expect(enrolled.length).toBeGreaterThanOrEqual(1)

      const done = await server.admin.progress.completeActivity(ORG, userId, pageActivityUuid)
      expect(done.completed).toBe(true)
      const progress = await server.admin.progress.get(ORG, userId, courseUuid)
      expect(progress.completed_activities).toBe(1)
      expect(progress.total_activities).toBe(2)
      expect((await server.admin.progress.listForUser(ORG, userId)).map((p) => p.course_uuid)).toContain(courseUuid)
      expect((await server.admin.progress.getCourseTrail(ORG, userId, courseUuid)).courses).toHaveLength(1)
      expect(Array.isArray(await server.admin.certificates.listForUser(ORG, userId))).toBe(true)
      expect((await server.admin.courses.analytics(ORG, courseUuid)).enrollment_count).toBeGreaterThanOrEqual(1)

      const awarded = await server.admin.certificates.award(ORG, userId, courseUuid)
      const certs = await server.admin.certificates.listForUser(ORG, userId)
      expect(certs.map((c) => (c.certificate_user as { user_certification_uuid?: string }).user_certification_uuid)).toContain(
        awarded.user_certification_uuid,
      )
      // Anyone can verify a certificate id; an unknown id is null, not an error.
      const verified = await anon.certificates.verify(awarded.user_certification_uuid)
      expect(verified?.certificate_user.user_certification_uuid).toBe(awarded.user_certification_uuid)
      expect(await anon.certificates.verify('certificate_does-not-exist')).toBeNull()
      await server.admin.certificates.revoke(ORG, userId, awarded.user_certification_uuid)
      expect(await anon.certificates.verify(awarded.user_certification_uuid)).toBeNull()

      const reset = await server.admin.progress.reset(ORG, userId, courseUuid)
      expect(reset.steps_deleted).toBeGreaterThanOrEqual(1)
    })

    it('submits an assignment answer on behalf of a learner', async () => {
      const saved = await server.assignments.saveTaskSubmission(
        assignmentUuid,
        textTaskUuid,
        { taskSubmission: { answer: 'from the server' } },
        { onBehalfOfUserId: userId },
      )
      expect(saved.user_id).toBe(userId)
      const submission = await server.assignments.submit(assignmentUuid, { onBehalfOfUserId: userId })
      expect(submission.user_id).toBe(userId)
    })

    it('mints a magic link the learner redeems with the SDK', async () => {
      const link = await server.admin.auth.magicLink(ORG, { userId, redirectTo: `/course/${courseUuid.replace('course_', '')}` })
      expect(link.url).toContain(link.token)
      const res = await anon.auth.verifyMagicLink(link.token)
      expect(res.mfa_required).toBeFalsy()
      if (res.mfa_required) return
      const asLearner = createClient({ baseUrl: BASE, token: res.tokens.access_token })
      expect((await asLearner.users.session()).user.id).toBe(userId)
      const reused = await anon.auth.verifyMagicLink(link.token).catch((e) => e)
      expect(isLearnHouseError(reused) && reused.status).toBe(410)
    })

    it('issues a user token for server-side calls as the learner', async () => {
      const issued = await server.admin.auth.issueToken(ORG, userId)
      const asLearner = createClient({ baseUrl: BASE, token: issued.access_token })
      const trail = await asLearner.trail.getForOrg(orgId)
      expect(trail.user_id).toBe(userId)
    })

    it('bulk enrolls and unenrolls, then removes the member', async () => {
      const bulk = await server.admin.enrollments.bulkEnroll(ORG, courseUuid, [userId])
      expect([...bulk.enrolled, ...bulk.already_enrolled]).toContain(userId)
      const out = await server.admin.enrollments.bulkUnenroll(ORG, courseUuid, [userId])
      expect([...out.unenrolled, ...out.not_enrolled]).toContain(userId)
      await server.admin.users.remove(ORG, userId)
      const gone = await server.admin.users.getByEmail(ORG, email).catch((e) => e)
      expect(isLearnHouseError(gone) && gone.status).toBe(404)
    })

    it('a user session is refused by the Admin API', async () => {
      const err = await admin.admin.users.getByEmail(ORG, ADMIN_EMAIL!).catch((e) => e)
      expect(isLearnHouseError(err) && err.status).toBe(403)
    })
  })

  describe('embed session (server mints, browser uses)', () => {
    let learnerId: number

    beforeAll(async () => {
      const server = createClient({ baseUrl: BASE, token: apiToken })
      const user = await server.admin.users.provision(ORG, { email: `embed-${run}@sdkit.dev`, username: `embed_${run}` })
      learnerId = user.id
    })

    it('mints a session and uses it like the embed components do', async () => {
      const server = createClient({ baseUrl: BASE, token: apiToken })
      const session = await server.embed.createSession({ orgSlug: ORG, userId: learnerId, ttlSeconds: 300 })
      expect(session.user_id).toBe(learnerId)
      expect(session.expires_in).toBe(300)

      let asked = 0
      const browser = createClient({
        baseUrl: BASE,
        getSession: () => {
          asked++
          return session
        },
      })
      expect((await browser.users.session()).user.id).toBe(learnerId)
      expect((await browser.activities.get(pageActivityUuid)).activity_uuid).toBe(pageActivityUuid)
      const trail = await browser.trail.completeActivity(pageActivityUuid)
      expect(courseProgress(trail, courseUuid).completedActivityIds).toContain(pageActivityId)
      expect((await browser.trail.getCourseProgress(orgId, courseUuid)).completed).toBe(1)
      expect((await browser.assignments.getForActivity(assignmentActivityUuid)).assignment_uuid).toBe(assignmentUuid)
      expect(asked).toBe(1)
    })

    it('is refused outside the embed routes', async () => {
      const server = createClient({ baseUrl: BASE, token: apiToken })
      const session = await server.embed.createSession({ orgSlug: ORG, userId: learnerId })
      const browser = createClient({ baseUrl: BASE, session })
      for (const call of [() => browser.notifications.list(), () => browser.trail.startCourse(courseUuid), () => browser.auth.mfa.status()]) {
        const err = await call().catch((e) => e)
        expect(isLearnHouseError(err)).toBe(true)
        expect(err.status).toBe(403)
      }
    })

    it('never takes an API token as a browser session', () => {
      expect(() => createClient({ baseUrl: BASE, session: apiToken })).toThrow(ApiTokenInBrowserError)
    })
  })
})
