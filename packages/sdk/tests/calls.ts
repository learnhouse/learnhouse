// One entry per resource method (and per branch of a method that picks its
// endpoint from its input). Shared by resources-all.test.ts, which checks the
// exact request each one sends, and contract.test.ts, which checks every
// endpoint exists in the API's OpenAPI snapshot.
import type { LearnHouseClient } from '../src'

export interface CallCase {
  /** `resource.method`, or `resource.method (variant)`. */
  name: string
  run: (c: LearnHouseClient) => Promise<unknown>
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** Path and query, after the base URL. */
  url: string
  /** The path template the SDK asked for (what the contract test looks up). */
  template: string
  /** Expected JSON body, `form:<urlencoded>` for form bodies, or a FormData field map. */
  body?: unknown
  formData?: Record<string, string>
  /** Whether the client's bearer token is sent. Default true. */
  auth?: boolean
  /** Response body the mock answers with. Default `{}`. */
  response?: unknown
}

const file = () => new Blob(['hello'], { type: 'text/plain' })

export const CALLS: CallCase[] = [
  // ── orgs
  { name: 'orgs.get', run: (c) => c.orgs.get('acme'), method: 'GET', url: '/api/v1/orgs/slug/acme', template: '/api/v1/orgs/slug/{org_slug}' },
  { name: 'orgs.getByUuid', run: (c) => c.orgs.getByUuid('org_1'), method: 'GET', url: '/api/v1/orgs/uuid/org_1', template: '/api/v1/orgs/uuid/{org_uuid}' },
  { name: 'orgs.listMine', run: (c) => c.orgs.listMine(), method: 'GET', url: '/api/v1/orgs/user/page/1/limit/20', template: '/api/v1/orgs/user/page/{page}/limit/{limit}', response: [] },
  { name: 'orgs.listMine (page)', run: (c) => c.orgs.listMine({ page: 2, limit: 5 }), method: 'GET', url: '/api/v1/orgs/user/page/2/limit/5', template: '/api/v1/orgs/user/page/{page}/limit/{limit}', response: [] },
  {
    name: 'orgs.join',
    run: (c) => c.orgs.join({ orgId: 3, userId: 9, inviteCode: 'abc' }),
    method: 'POST',
    url: '/api/v1/orgs/join',
    template: '/api/v1/orgs/join',
    body: { org_id: 3, user_id: 9, invite_code: 'abc' },
  },
  { name: 'orgs.join (no code)', run: (c) => c.orgs.join({ orgId: 3, userId: 9 }), method: 'POST', url: '/api/v1/orgs/join', template: '/api/v1/orgs/join', body: { org_id: 3, user_id: 9, invite_code: null } },
  { name: 'orgs.leave', run: (c) => c.orgs.leave(3), method: 'DELETE', url: '/api/v1/orgs/3/leave', template: '/api/v1/orgs/{org_id}/leave' },
  { name: 'orgs.resolveDomain', run: (c) => c.orgs.resolveDomain('learn.acme.com'), method: 'GET', url: '/api/v1/orgs/resolve/domain/learn.acme.com', template: '/api/v1/orgs/resolve/domain/{domain}' },

  // ── courses
  { name: 'courses.list', run: (c) => c.courses.list('acme'), method: 'GET', url: '/api/v1/courses/org_slug/acme/page/1/limit/20', template: '/api/v1/courses/org_slug/{org_slug}/page/{page}/limit/{limit}', response: [] },
  { name: 'courses.count', run: (c) => c.courses.count('acme'), method: 'GET', url: '/api/v1/courses/org_slug/acme/count', template: '/api/v1/courses/org_slug/{org_slug}/count', response: 3 },
  { name: 'courses.get', run: (c) => c.courses.get('course_1'), method: 'GET', url: '/api/v1/courses/course_1', template: '/api/v1/courses/{course_uuid}' },
  { name: 'courses.getById', run: (c) => c.courses.getById(12), method: 'GET', url: '/api/v1/courses/id/12', template: '/api/v1/courses/id/{course_id}' },
  { name: 'courses.getMeta', run: (c) => c.courses.getMeta('course_1', { slim: true }), method: 'GET', url: '/api/v1/courses/course_1/meta?slim=true', template: '/api/v1/courses/{course_uuid}/meta' },
  {
    name: 'courses.search',
    run: (c) => c.courses.search('acme', 'intro & basics', { page: 2, limit: 5 }),
    method: 'GET',
    url: '/api/v1/courses/org_slug/acme/search?query=intro%20%26%20basics&page=2&limit=5',
    template: '/api/v1/courses/org_slug/{org_slug}/search',
    response: [],
  },
  { name: 'courses.listUpdates', run: (c) => c.courses.listUpdates('course_1'), method: 'GET', url: '/api/v1/courses/course_1/updates', template: '/api/v1/courses/{course_uuid}/updates', response: [] },

  // ── chapters / activities
  { name: 'chapters.get', run: (c) => c.chapters.get(4), method: 'GET', url: '/api/v1/chapters/4', template: '/api/v1/chapters/{chapter_id}' },
  {
    name: 'chapters.listForCourse',
    run: (c) => c.chapters.listForCourse('course_1'),
    method: 'GET',
    url: '/api/v1/courses/course_1/meta?slim=true',
    template: '/api/v1/courses/{course_uuid}/meta',
    response: { chapters: [] },
  },
  { name: 'activities.get', run: (c) => c.activities.get('activity_1'), method: 'GET', url: '/api/v1/activities/activity_1', template: '/api/v1/activities/{activity_uuid}' },
  { name: 'activities.getById', run: (c) => c.activities.getById(77), method: 'GET', url: '/api/v1/activities/id/77', template: '/api/v1/activities/id/{activity_id}' },
  { name: 'activities.listForChapter', run: (c) => c.activities.listForChapter(4), method: 'GET', url: '/api/v1/activities/chapter/4', template: '/api/v1/activities/chapter/{chapter_id}', response: [] },
  { name: 'activities.resolve', run: (c) => c.activities.resolve({ activityId: '1' }), method: 'GET', url: '/api/v1/activities/activity_1', template: '/api/v1/activities/{activity_uuid}' },

  // ── search
  { name: 'search.org', run: (c) => c.search.org('acme', 'react'), method: 'GET', url: '/api/v1/search/org_slug/acme?query=react', template: '/api/v1/search/org_slug/{org_slug}' },

  // ── trail
  { name: 'trail.get', run: (c) => c.trail.get(), method: 'GET', url: '/api/v1/trail/', template: '/api/v1/trail/' },
  { name: 'trail.getForOrg', run: (c) => c.trail.getForOrg(1), method: 'GET', url: '/api/v1/trail/org/1/trail', template: '/api/v1/trail/org/{org_id}/trail' },
  { name: 'trail.startCourse', run: (c) => c.trail.startCourse('course_1'), method: 'POST', url: '/api/v1/trail/add_course/course_1', template: '/api/v1/trail/add_course/{course_uuid}' },
  { name: 'trail.leaveCourse', run: (c) => c.trail.leaveCourse('course_1'), method: 'DELETE', url: '/api/v1/trail/remove_course/course_1', template: '/api/v1/trail/remove_course/{course_uuid}' },
  { name: 'trail.completeActivity', run: (c) => c.trail.completeActivity('activity_1'), method: 'POST', url: '/api/v1/trail/add_activity/activity_1', template: '/api/v1/trail/add_activity/{activity_uuid}' },
  { name: 'trail.uncompleteActivity', run: (c) => c.trail.uncompleteActivity('activity_1'), method: 'DELETE', url: '/api/v1/trail/remove_activity/activity_1', template: '/api/v1/trail/remove_activity/{activity_uuid}' },
  {
    name: 'trail.getCourseProgress',
    run: (c) => c.trail.getCourseProgress(1, 'course_1'),
    method: 'GET',
    url: '/api/v1/trail/org/1/trail',
    template: '/api/v1/trail/org/{org_id}/trail',
    response: { runs: [] },
  },

  // ── users
  { name: 'users.session', run: (c) => c.users.session(), method: 'GET', url: '/api/v1/users/session', template: '/api/v1/users/session' },
  { name: 'users.profile', run: (c) => c.users.profile(), method: 'GET', url: '/api/v1/users/profile', template: '/api/v1/users/profile' },
  { name: 'users.getByUuid', run: (c) => c.users.getByUuid('user_1'), method: 'GET', url: '/api/v1/users/uuid/user_1', template: '/api/v1/users/uuid/{user_uuid}' },
  { name: 'users.getById', run: (c) => c.users.getById(5), method: 'GET', url: '/api/v1/users/id/5', template: '/api/v1/users/id/{user_id}' },
  { name: 'users.getByUsername', run: (c) => c.users.getByUsername('ada l'), method: 'GET', url: '/api/v1/users/username/ada%20l', template: '/api/v1/users/username/{username}' },
  {
    name: 'users.listCourses',
    run: (c) => c.users.listCourses(5, { page: 2, limit: 10 }),
    method: 'GET',
    url: '/api/v1/users/5/courses?page=2&limit=10',
    template: '/api/v1/users/{user_id}/courses',
    response: [],
  },
  {
    name: 'users.update',
    run: (c) => c.users.update(5, { username: 'ada', email: 'ada@x.io', first_name: 'Ada' }),
    method: 'PUT',
    url: '/api/v1/users/5',
    template: '/api/v1/users/{user_id}',
    body: { username: 'ada', email: 'ada@x.io', first_name: 'Ada' },
  },
  {
    name: 'users.updateAvatar',
    run: (c) => c.users.updateAvatar(5, file()),
    method: 'PUT',
    url: '/api/v1/users/update_avatar/5',
    template: '/api/v1/users/update_avatar/{user_id}',
    formData: { avatar_file: 'avatar.png' },
  },
  {
    name: 'users.changePassword',
    run: (c) => c.users.changePassword(5, { oldPassword: 'a', newPassword: 'b' }),
    method: 'PUT',
    url: '/api/v1/users/change_password/5',
    template: '/api/v1/users/change_password/{user_id}',
    body: { old_password: 'a', new_password: 'b' },
  },
  { name: 'users.getPreferences', run: (c) => c.users.getPreferences(), method: 'GET', url: '/api/v1/users/me/preferences', template: '/api/v1/users/me/preferences' },
  {
    name: 'users.updatePreferences',
    run: (c) => c.users.updatePreferences({ theme: 'dark' }),
    method: 'PUT',
    url: '/api/v1/users/me/preferences',
    template: '/api/v1/users/me/preferences',
    body: { theme: 'dark' },
  },
  { name: 'users.deleteAccount', run: (c) => c.users.deleteAccount(5), method: 'DELETE', url: '/api/v1/users/user_id/5', template: '/api/v1/users/user_id/{user_id}' },

  // ── auth
  {
    name: 'auth.login',
    run: (c) => c.auth.login({ email: 'a@x.io', password: 'p' }),
    method: 'POST',
    url: '/api/v1/auth/login',
    template: '/api/v1/auth/login',
    body: 'form:username=a%40x.io&password=p',
    auth: false,
  },
  {
    name: 'auth.loginMfa',
    run: (c) => c.auth.loginMfa({ mfaToken: 'm', code: '123456', isBackupCode: true }),
    method: 'POST',
    url: '/api/v1/auth/login/mfa',
    template: '/api/v1/auth/login/mfa',
    body: { mfa_token: 'm', code: '123456', is_backup_code: true },
    auth: false,
  },
  {
    name: 'auth.loginWithOAuth',
    run: (c) => c.auth.loginWithOAuth({ provider: 'google', email: 'a@x.io', accessToken: 'g', orgId: 2, inviteCode: 'inv' }),
    method: 'POST',
    url: '/api/v1/auth/oauth?org_id=2&invite_code=inv',
    template: '/api/v1/auth/oauth',
    body: { email: 'a@x.io', provider: 'google', access_token: 'g' },
    auth: false,
  },
  { name: 'auth.refresh', run: (c) => c.auth.refresh(), method: 'GET', url: '/api/v1/auth/refresh', template: '/api/v1/auth/refresh', auth: false },
  { name: 'auth.logout', run: (c) => c.auth.logout(), method: 'DELETE', url: '/api/v1/auth/logout', template: '/api/v1/auth/logout' },
  { name: 'auth.me', run: (c) => c.auth.me(), method: 'GET', url: '/api/v1/auth/me', template: '/api/v1/auth/me' },
  {
    name: 'auth.signup (platform)',
    run: (c) => c.auth.signup({ email: 'a@x.io', username: 'ada', password: 'Secret-123', firstName: 'Ada' }),
    method: 'POST',
    url: '/api/v1/users/',
    template: '/api/v1/users/',
    body: { email: 'a@x.io', username: 'ada', password: 'Secret-123', first_name: 'Ada' },
    auth: false,
  },
  {
    name: 'auth.signup (org)',
    run: (c) =>
      c.auth.signup({
        email: 'a@x.io',
        username: 'ada',
        password: 'Secret-123',
        orgId: 2,
        lastName: 'L',
        bio: 'hi',
        customFields: { team: 'x' },
        next: '/course/1',
      }),
    method: 'POST',
    url: '/api/v1/users/2?next=%2Fcourse%2F1',
    template: '/api/v1/users/{org_id}',
    body: { email: 'a@x.io', username: 'ada', password: 'Secret-123', last_name: 'L', bio: 'hi', custom_fields: { team: 'x' } },
    auth: false,
  },
  {
    name: 'auth.signup (invite code)',
    run: (c) => c.auth.signup({ email: 'a@x.io', username: 'ada', password: 'Secret-123', orgId: 2, inviteCode: 'CODE1' }),
    method: 'POST',
    url: '/api/v1/users/2/invite/CODE1',
    template: '/api/v1/users/{org_id}/invite/{invite_code}',
    body: { email: 'a@x.io', username: 'ada', password: 'Secret-123' },
    auth: false,
  },
  {
    name: 'auth.requestMagicLink',
    run: (c) => c.auth.requestMagicLink({ email: 'a@x.io', orgSlug: 'acme', next: '/x' }),
    method: 'POST',
    url: '/api/v1/auth/magic-link/request',
    template: '/api/v1/auth/magic-link/request',
    body: { email: 'a@x.io', org_slug: 'acme', next: '/x' },
    auth: false,
  },
  {
    name: 'auth.verifyMagicLink',
    run: (c) => c.auth.verifyMagicLink('tok'),
    method: 'POST',
    url: '/api/v1/auth/magic-link/verify',
    template: '/api/v1/auth/magic-link/verify',
    body: { token: 'tok' },
    auth: false,
  },
  {
    name: 'auth.verifyEmail',
    run: (c) => c.auth.verifyEmail({ token: 't', userUuid: 'user_1', orgUuid: 'org_1' }),
    method: 'POST',
    url: '/api/v1/auth/verify-email',
    template: '/api/v1/auth/verify-email',
    body: { token: 't', user_uuid: 'user_1', org_uuid: 'org_1', email: null },
    auth: false,
  },
  {
    name: 'auth.resendVerification',
    run: (c) => c.auth.resendVerification({ email: 'a@x.io', orgId: 2 }),
    method: 'POST',
    url: '/api/v1/auth/resend-verification',
    template: '/api/v1/auth/resend-verification',
    body: { email: 'a@x.io', org_id: 2, next: null },
    auth: false,
  },
  {
    name: 'auth.requestPasswordReset (org)',
    run: (c) => c.auth.requestPasswordReset({ email: 'a@x.io', orgId: 2 }),
    method: 'POST',
    url: '/api/v1/users/reset_password/send_reset_code',
    template: '/api/v1/users/reset_password/send_reset_code',
    body: { email: 'a@x.io', org_id: 2 },
    auth: false,
  },
  {
    name: 'auth.requestPasswordReset (platform)',
    run: (c) => c.auth.requestPasswordReset({ email: 'a@x.io', next: '/home' }),
    method: 'POST',
    url: '/api/v1/users/reset_password/platform/send_reset_code',
    template: '/api/v1/users/reset_password/platform/send_reset_code',
    body: { email: 'a@x.io', next: '/home' },
    auth: false,
  },
  {
    name: 'auth.resetPassword (org)',
    run: (c) => c.auth.resetPassword({ email: 'a@x.io', code: '9999', newPassword: 'N3w-pass!', orgId: 2 }),
    method: 'POST',
    url: '/api/v1/users/reset_password/change_password',
    template: '/api/v1/users/reset_password/change_password',
    body: { email: 'a@x.io', reset_code: '9999', new_password: 'N3w-pass!', org_id: 2 },
    auth: false,
  },
  {
    name: 'auth.resetPassword (platform)',
    run: (c) => c.auth.resetPassword({ email: 'a@x.io', code: '9999', newPassword: 'N3w-pass!' }),
    method: 'POST',
    url: '/api/v1/users/reset_password/platform/change_password',
    template: '/api/v1/users/reset_password/platform/change_password',
    body: { email: 'a@x.io', reset_code: '9999', new_password: 'N3w-pass!' },
    auth: false,
  },
  { name: 'auth.mfa.status', run: (c) => c.auth.mfa.status(), method: 'GET', url: '/api/v1/auth/mfa/status', template: '/api/v1/auth/mfa/status' },
  { name: 'auth.mfa.setup', run: (c) => c.auth.mfa.setup({ password: 'p' }), method: 'POST', url: '/api/v1/auth/mfa/setup', template: '/api/v1/auth/mfa/setup', body: { password: 'p' } },
  { name: 'auth.mfa.setup (no password)', run: (c) => c.auth.mfa.setup(), method: 'POST', url: '/api/v1/auth/mfa/setup', template: '/api/v1/auth/mfa/setup', body: { password: null } },
  { name: 'auth.mfa.confirm', run: (c) => c.auth.mfa.confirm('123456'), method: 'POST', url: '/api/v1/auth/mfa/confirm', template: '/api/v1/auth/mfa/confirm', body: { code: '123456' } },
  { name: 'auth.mfa.disable', run: (c) => c.auth.mfa.disable({ code: '123456' }), method: 'POST', url: '/api/v1/auth/mfa/disable', template: '/api/v1/auth/mfa/disable', body: { code: '123456', password: null } },
  {
    name: 'auth.mfa.regenerateBackupCodes',
    run: (c) => c.auth.mfa.regenerateBackupCodes('123456'),
    method: 'POST',
    url: '/api/v1/auth/mfa/backup-codes/regenerate',
    template: '/api/v1/auth/mfa/backup-codes/regenerate',
    body: { code: '123456' },
  },

  // ── assignments
  { name: 'assignments.listMine', run: (c) => c.assignments.listMine(1, { gradedLimit: 5 }), method: 'GET', url: '/api/v1/assignments/me?org_id=1&graded_limit=5', template: '/api/v1/assignments/me', response: [] },
  { name: 'assignments.listForCourse', run: (c) => c.assignments.listForCourse('course_1'), method: 'GET', url: '/api/v1/assignments/course/course_1', template: '/api/v1/assignments/course/{course_uuid}', response: [] },
  { name: 'assignments.get', run: (c) => c.assignments.get('assignment_1', { lang: 'fr' }), method: 'GET', url: '/api/v1/assignments/assignment_1?lang=fr', template: '/api/v1/assignments/{assignment_uuid}' },
  { name: 'assignments.getForActivity', run: (c) => c.assignments.getForActivity('activity_1'), method: 'GET', url: '/api/v1/assignments/activity/activity_1', template: '/api/v1/assignments/activity/{activity_uuid}' },
  { name: 'assignments.listTasks', run: (c) => c.assignments.listTasks('assignment_1'), method: 'GET', url: '/api/v1/assignments/assignment_1/tasks', template: '/api/v1/assignments/{assignment_uuid}/tasks', response: [] },
  { name: 'assignments.getTask', run: (c) => c.assignments.getTask('assignmenttask_1'), method: 'GET', url: '/api/v1/assignments/task/assignmenttask_1', template: '/api/v1/assignments/task/{assignment_task_uuid}' },
  {
    name: 'assignments.getMyTaskSubmissions',
    run: (c) => c.assignments.getMyTaskSubmissions('assignment_1'),
    method: 'GET',
    url: '/api/v1/assignments/assignment_1/tasks/submissions/me',
    template: '/api/v1/assignments/{assignment_uuid}/tasks/submissions/me',
  },
  {
    name: 'assignments.getMyTaskSubmission',
    run: (c) => c.assignments.getMyTaskSubmission('assignment_1', 'assignmenttask_1'),
    method: 'GET',
    url: '/api/v1/assignments/assignment_1/tasks/assignmenttask_1/submissions/me',
    template: '/api/v1/assignments/{assignment_uuid}/tasks/{assignment_task_uuid}/submissions/me',
  },
  {
    name: 'assignments.saveTaskSubmission',
    run: (c) => c.assignments.saveTaskSubmission('assignment_1', 'assignmenttask_1', { taskSubmission: { answer: 42 } }),
    method: 'PUT',
    url: '/api/v1/assignments/assignment_1/tasks/assignmenttask_1/submissions',
    template: '/api/v1/assignments/{assignment_uuid}/tasks/{assignment_task_uuid}/submissions',
    body: { task_submission: { answer: 42 } },
  },
  {
    name: 'assignments.saveTaskSubmission (update, on behalf)',
    run: (c) =>
      c.assignments.saveTaskSubmission(
        'assignment_1',
        'assignmenttask_1',
        { taskSubmission: { fileUUID: 'f1' }, submissionUuid: 'assignmenttasksubmission_1' },
        { onBehalfOfUserId: 42 },
      ),
    method: 'PUT',
    url: '/api/v1/assignments/assignment_1/tasks/assignmenttask_1/submissions?on_behalf_of_user_id=42',
    template: '/api/v1/assignments/{assignment_uuid}/tasks/{assignment_task_uuid}/submissions',
    body: { task_submission: { fileUUID: 'f1' }, assignment_task_submission_uuid: 'assignmenttasksubmission_1' },
  },
  {
    name: 'assignments.uploadTaskFile',
    run: (c) => c.assignments.uploadTaskFile('assignment_1', 'assignmenttask_1', file()),
    method: 'POST',
    url: '/api/v1/assignments/assignment_1/tasks/assignmenttask_1/sub_file',
    template: '/api/v1/assignments/{assignment_uuid}/tasks/{assignment_task_uuid}/sub_file',
    formData: { sub_file: 'submission' },
  },
  { name: 'assignments.submit', run: (c) => c.assignments.submit('assignment_1'), method: 'POST', url: '/api/v1/assignments/assignment_1/submissions', template: '/api/v1/assignments/{assignment_uuid}/submissions' },
  {
    name: 'assignments.submit (on behalf)',
    run: (c) => c.assignments.submit('assignment_1', { onBehalfOfUserId: 42 }),
    method: 'POST',
    url: '/api/v1/assignments/assignment_1/submissions?on_behalf_of_user_id=42',
    template: '/api/v1/assignments/{assignment_uuid}/submissions',
  },
  { name: 'assignments.getMySubmission', run: (c) => c.assignments.getMySubmission('assignment_1'), method: 'GET', url: '/api/v1/assignments/assignment_1/submissions/me', template: '/api/v1/assignments/{assignment_uuid}/submissions/me', response: [] },
  { name: 'assignments.getGrade', run: (c) => c.assignments.getGrade('assignment_1', 42), method: 'GET', url: '/api/v1/assignments/assignment_1/submissions/42/grade', template: '/api/v1/assignments/{assignment_uuid}/submissions/{user_id}/grade' },
  { name: 'assignments.retry', run: (c) => c.assignments.retry('assignment_1'), method: 'POST', url: '/api/v1/assignments/assignment_1/submissions/me/retry', template: '/api/v1/assignments/{assignment_uuid}/submissions/me/retry' },

  // ── certificates
  { name: 'certificates.listMine', run: (c) => c.certificates.listMine({ orgId: 1, lang: 'fr' }), method: 'GET', url: '/api/v1/certifications/user/all?lang=fr&org_id=1', template: '/api/v1/certifications/user/all', response: [] },
  { name: 'certificates.listMineForCourse', run: (c) => c.certificates.listMineForCourse('course_1'), method: 'GET', url: '/api/v1/certifications/user/course/course_1', template: '/api/v1/certifications/user/course/{course_uuid}', response: [] },
  { name: 'certificates.get', run: (c) => c.certificates.get('cert_1'), method: 'GET', url: '/api/v1/certifications/certificate/cert_1', template: '/api/v1/certifications/certificate/{user_certification_uuid}' },
  { name: 'certificates.verify', run: (c) => c.certificates.verify('cert_1', { lang: 'de' }), method: 'GET', url: '/api/v1/certifications/certificate/cert_1?lang=de', template: '/api/v1/certifications/certificate/{user_certification_uuid}' },
  { name: 'certificates.getForCourse', run: (c) => c.certificates.getForCourse('course_1'), method: 'GET', url: '/api/v1/certifications/course/course_1', template: '/api/v1/certifications/course/{course_uuid}', response: [] },

  // ── paths
  { name: 'paths.list', run: (c) => c.paths.list(1), method: 'GET', url: '/api/v1/paths/org/1', template: '/api/v1/paths/org/{org_id}', response: [] },
  { name: 'paths.listMine', run: (c) => c.paths.listMine(1), method: 'GET', url: '/api/v1/paths/me/org/1', template: '/api/v1/paths/me/org/{org_id}', response: [] },
  { name: 'paths.listForCourse', run: (c) => c.paths.listForCourse('course_1'), method: 'GET', url: '/api/v1/paths/course/course_1', template: '/api/v1/paths/course/{course_uuid}', response: [] },
  { name: 'paths.get', run: (c) => c.paths.get('path_1'), method: 'GET', url: '/api/v1/paths/path_1', template: '/api/v1/paths/{path_uuid}' },
  { name: 'paths.enroll', run: (c) => c.paths.enroll('path_1'), method: 'POST', url: '/api/v1/paths/path_1/enroll', template: '/api/v1/paths/{path_uuid}/enroll' },
  { name: 'paths.leave', run: (c) => c.paths.leave('path_1'), method: 'DELETE', url: '/api/v1/paths/path_1/enroll', template: '/api/v1/paths/{path_uuid}/enroll' },
  { name: 'paths.listMyCertificates', run: (c) => c.paths.listMyCertificates(), method: 'GET', url: '/api/v1/paths/certificates/me', template: '/api/v1/paths/certificates/me', response: [] },
  { name: 'paths.getCertificate', run: (c) => c.paths.getCertificate('pathcert_1'), method: 'GET', url: '/api/v1/paths/certificates/pathcert_1', template: '/api/v1/paths/certificates/{certificate_uuid}' },

  // ── communities / discussions
  { name: 'communities.list', run: (c) => c.communities.list(1), method: 'GET', url: '/api/v1/communities/org/1/page/1/limit/20', template: '/api/v1/communities/org/{org_id}/page/{page}/limit/{limit}', response: [] },
  { name: 'communities.get', run: (c) => c.communities.get('community_1'), method: 'GET', url: '/api/v1/communities/community_1', template: '/api/v1/communities/{community_uuid}' },
  { name: 'communities.getForCourse', run: (c) => c.communities.getForCourse('course_1'), method: 'GET', url: '/api/v1/communities/course/course_1', template: '/api/v1/communities/course/{course_uuid}', response: null },
  { name: 'communities.summary', run: (c) => c.communities.summary(1), method: 'GET', url: '/api/v1/communities/org/1/summary', template: '/api/v1/communities/org/{org_id}/summary', response: [] },
  { name: 'communities.activity', run: (c) => c.communities.activity(1), method: 'GET', url: '/api/v1/communities/org/1/activity', template: '/api/v1/communities/org/{org_id}/activity', response: [] },
  {
    name: 'communities.listDiscussions',
    run: (c) => c.communities.listDiscussions('community_1', { sortBy: 'hot', page: 2, limit: 5, label: 'question' }),
    method: 'GET',
    url: '/api/v1/communities/community_1/discussions?page=2&limit=5&sort_by=hot&label=question',
    template: '/api/v1/communities/{community_uuid}/discussions',
    response: [],
  },
  {
    name: 'communities.createDiscussion',
    run: (c) => c.communities.createDiscussion('community_1', { title: 'Hi', content: 'Body', label: 'question' }),
    method: 'POST',
    url: '/api/v1/communities/community_1/discussions',
    template: '/api/v1/communities/{community_uuid}/discussions',
    body: { title: 'Hi', content: 'Body', label: 'question' },
  },
  { name: 'discussions.labels', run: (c) => c.discussions.labels(), method: 'GET', url: '/api/v1/discussions/labels', template: '/api/v1/discussions/labels', response: [] },
  { name: 'discussions.get', run: (c) => c.discussions.get('discussion_1'), method: 'GET', url: '/api/v1/discussions/discussion_1', template: '/api/v1/discussions/{discussion_uuid}' },
  {
    name: 'discussions.update',
    run: (c) => c.discussions.update('discussion_1', { title: 'New' }),
    method: 'PUT',
    url: '/api/v1/discussions/discussion_1',
    template: '/api/v1/discussions/{discussion_uuid}',
    body: { title: 'New' },
  },
  { name: 'discussions.delete', run: (c) => c.discussions.delete('discussion_1'), method: 'DELETE', url: '/api/v1/discussions/discussion_1', template: '/api/v1/discussions/{discussion_uuid}' },
  {
    name: 'discussions.listComments',
    run: (c) => c.discussions.listComments('discussion_1', { page: 3 }),
    method: 'GET',
    url: '/api/v1/discussions/discussion_1/comments?page=3',
    template: '/api/v1/discussions/{discussion_uuid}/comments',
    response: [],
  },
  { name: 'discussions.countComments', run: (c) => c.discussions.countComments('discussion_1'), method: 'GET', url: '/api/v1/discussions/discussion_1/comments/count', template: '/api/v1/discussions/{discussion_uuid}/comments/count' },
  { name: 'discussions.reply', run: (c) => c.discussions.reply('discussion_1', 'Thanks!'), method: 'POST', url: '/api/v1/discussions/discussion_1/comments', template: '/api/v1/discussions/{discussion_uuid}/comments', body: { content: 'Thanks!' } },
  { name: 'discussions.updateComment', run: (c) => c.discussions.updateComment('comment_1', 'Edited'), method: 'PUT', url: '/api/v1/comments/comment_1', template: '/api/v1/comments/{comment_uuid}', body: { content: 'Edited' } },
  { name: 'discussions.deleteComment', run: (c) => c.discussions.deleteComment('comment_1'), method: 'DELETE', url: '/api/v1/comments/comment_1', template: '/api/v1/comments/{comment_uuid}' },
  { name: 'discussions.vote', run: (c) => c.discussions.vote('discussion_1'), method: 'POST', url: '/api/v1/discussions/discussion_1/vote', template: '/api/v1/discussions/{discussion_uuid}/vote' },
  { name: 'discussions.unvote', run: (c) => c.discussions.unvote('discussion_1'), method: 'DELETE', url: '/api/v1/discussions/discussion_1/vote', template: '/api/v1/discussions/{discussion_uuid}/vote' },
  { name: 'discussions.voteComment', run: (c) => c.discussions.voteComment('comment_1'), method: 'POST', url: '/api/v1/comments/comment_1/vote', template: '/api/v1/comments/{comment_uuid}/vote' },
  { name: 'discussions.unvoteComment', run: (c) => c.discussions.unvoteComment('comment_1'), method: 'DELETE', url: '/api/v1/comments/comment_1/vote', template: '/api/v1/comments/{comment_uuid}/vote' },
  { name: 'discussions.listReactions', run: (c) => c.discussions.listReactions('discussion_1'), method: 'GET', url: '/api/v1/discussions/discussion_1/reactions', template: '/api/v1/discussions/{discussion_uuid}/reactions', response: [] },
  { name: 'discussions.react', run: (c) => c.discussions.react('discussion_1', '🎉'), method: 'POST', url: '/api/v1/discussions/discussion_1/reactions', template: '/api/v1/discussions/{discussion_uuid}/reactions', body: { emoji: '🎉', active: null } },
  {
    name: 'discussions.react (set)',
    run: (c) => c.discussions.react('discussion_1', '👍', { active: false }),
    method: 'POST',
    url: '/api/v1/discussions/discussion_1/reactions',
    template: '/api/v1/discussions/{discussion_uuid}/reactions',
    body: { emoji: '👍', active: false },
  },

  // ── notifications
  {
    name: 'notifications.list',
    run: (c) => c.notifications.list({ orgId: 1, unreadOnly: true, category: 'assignments', limit: 10, cursor: '99', q: 'due' }),
    method: 'GET',
    url: '/api/v1/notifications?org_id=1&unread_only=true&category=assignments&q=due&cursor=99&limit=10',
    template: '/api/v1/notifications',
    response: { items: [], next_cursor: null },
  },
  { name: 'notifications.unreadCount', run: (c) => c.notifications.unreadCount({ orgId: 1 }), method: 'GET', url: '/api/v1/notifications/unread_count?org_id=1', template: '/api/v1/notifications/unread_count' },
  { name: 'notifications.counts', run: (c) => c.notifications.counts(), method: 'GET', url: '/api/v1/notifications/counts', template: '/api/v1/notifications/counts' },
  {
    name: 'notifications.markRead',
    run: (c) => c.notifications.markRead({ uuids: ['n1', 'n2'] }),
    method: 'POST',
    url: '/api/v1/notifications/read',
    template: '/api/v1/notifications/read',
    body: { notification_uuids: ['n1', 'n2'], all: false, org_id: null, category: null, audience: 'personal' },
  },
  {
    name: 'notifications.markRead (all)',
    run: (c) => c.notifications.markRead({ all: true, orgId: 1, category: 'courses', audience: 'all' }),
    method: 'POST',
    url: '/api/v1/notifications/read',
    template: '/api/v1/notifications/read',
    body: { notification_uuids: [], all: true, org_id: 1, category: 'courses', audience: 'all' },
  },
  { name: 'notifications.markOneRead', run: (c) => c.notifications.markOneRead('n1'), method: 'POST', url: '/api/v1/notifications/n1/read', template: '/api/v1/notifications/{notification_uuid}/read' },
  { name: 'notifications.markOneUnread', run: (c) => c.notifications.markOneUnread('n1'), method: 'POST', url: '/api/v1/notifications/n1/unread', template: '/api/v1/notifications/{notification_uuid}/unread' },
  { name: 'notifications.archive', run: (c) => c.notifications.archive('n1'), method: 'POST', url: '/api/v1/notifications/n1/archive', template: '/api/v1/notifications/{notification_uuid}/archive' },
  { name: 'notifications.unarchive', run: (c) => c.notifications.unarchive('n1'), method: 'POST', url: '/api/v1/notifications/n1/unarchive', template: '/api/v1/notifications/{notification_uuid}/unarchive' },
  { name: 'notifications.delete', run: (c) => c.notifications.delete('n1'), method: 'DELETE', url: '/api/v1/notifications/n1', template: '/api/v1/notifications/{notification_uuid}' },
  { name: 'notifications.getPreferences', run: (c) => c.notifications.getPreferences(), method: 'GET', url: '/api/v1/notifications/preferences', template: '/api/v1/notifications/preferences' },
  {
    name: 'notifications.updatePreferences',
    run: (c) => c.notifications.updatePreferences({ push_enabled: false, email_digest: 'weekly' }),
    method: 'PUT',
    url: '/api/v1/notifications/preferences',
    template: '/api/v1/notifications/preferences',
    body: { push_enabled: false, email_digest: 'weekly' },
  },
  { name: 'notifications.listDevices', run: (c) => c.notifications.listDevices(), method: 'GET', url: '/api/v1/notifications/devices', template: '/api/v1/notifications/devices' },
  {
    name: 'notifications.registerDevice',
    run: (c) => c.notifications.registerDevice({ token: 'ExponentPushToken[x]', platform: 'ios', deviceName: 'iPhone', appVersion: '1.0.0' }),
    method: 'POST',
    url: '/api/v1/notifications/devices',
    template: '/api/v1/notifications/devices',
    body: { token: 'ExponentPushToken[x]', platform: 'ios', org_id: null, device_name: 'iPhone', app_version: '1.0.0' },
  },
  {
    name: 'notifications.unregisterDevice',
    run: (c) => c.notifications.unregisterDevice('ExponentPushToken[x]'),
    method: 'POST',
    url: '/api/v1/notifications/devices/unregister',
    template: '/api/v1/notifications/devices/unregister',
    body: { token: 'ExponentPushToken[x]' },
  },

  // ── podcasts
  {
    name: 'podcasts.list',
    run: (c) => c.podcasts.list('acme', { includeUnpublished: true }),
    method: 'GET',
    url: '/api/v1/podcasts/org_slug/acme/page/1/limit/20?include_unpublished=true',
    template: '/api/v1/podcasts/org_slug/{org_slug}/page/{page}/limit/{limit}',
    response: [],
  },
  { name: 'podcasts.count', run: (c) => c.podcasts.count('acme'), method: 'GET', url: '/api/v1/podcasts/org_slug/acme/count', template: '/api/v1/podcasts/org_slug/{org_slug}/count', response: { count: 2 } },
  { name: 'podcasts.get', run: (c) => c.podcasts.get('podcast_1'), method: 'GET', url: '/api/v1/podcasts/podcast_1', template: '/api/v1/podcasts/{podcast_uuid}' },
  { name: 'podcasts.getMeta', run: (c) => c.podcasts.getMeta('podcast_1'), method: 'GET', url: '/api/v1/podcasts/podcast_1/meta', template: '/api/v1/podcasts/{podcast_uuid}/meta' },
  { name: 'podcasts.listEpisodes', run: (c) => c.podcasts.listEpisodes('podcast_1'), method: 'GET', url: '/api/v1/podcasts/podcast_1/episodes', template: '/api/v1/podcasts/{podcast_uuid}/episodes', response: [] },
  { name: 'podcasts.getEpisode', run: (c) => c.podcasts.getEpisode('episode_1'), method: 'GET', url: '/api/v1/podcasts/episodes/episode_1', template: '/api/v1/podcasts/episodes/{episode_uuid}' },

  // ── usergroups / notes / calendar / instance
  { name: 'usergroups.listMine', run: (c) => c.usergroups.listMine(1), method: 'GET', url: '/api/v1/usergroups/org/1/mine', template: '/api/v1/usergroups/org/{org_id}/mine' },
  { name: 'usergroups.join', run: (c) => c.usergroups.join('JOIN-42'), method: 'POST', url: '/api/v1/usergroups/join', template: '/api/v1/usergroups/join', body: { code: 'JOIN-42' } },
  {
    name: 'notes.list',
    run: (c) => c.notes.list(1, { courseUuid: 'course_1', q: 'loops', limit: 5 }),
    method: 'GET',
    url: '/api/v1/notes?org_id=1&course_uuid=course_1&q=loops&limit=5',
    template: '/api/v1/notes',
  },
  { name: 'notes.listForActivity', run: (c) => c.notes.listForActivity('activity_1'), method: 'GET', url: '/api/v1/notes/activity/activity_1', template: '/api/v1/notes/activity/{activity_uuid}', response: [] },
  {
    name: 'notes.create',
    run: (c) => c.notes.create('activity_1', { content: { type: 'doc' }, anchor: { kind: 'video', seconds: 12 } }),
    method: 'POST',
    url: '/api/v1/notes/activity/activity_1',
    template: '/api/v1/notes/activity/{activity_uuid}',
    body: { content: { type: 'doc' }, anchor: { kind: 'video', seconds: 12 } },
  },
  {
    name: 'notes.update',
    run: (c) => c.notes.update('note_1', { content: { type: 'doc' }, clearAnchor: true }),
    method: 'PATCH',
    url: '/api/v1/notes/note_1',
    template: '/api/v1/notes/{note_uuid}',
    body: { content: { type: 'doc' }, clear_anchor: true },
  },
  { name: 'notes.delete', run: (c) => c.notes.delete('note_1'), method: 'DELETE', url: '/api/v1/notes/note_1', template: '/api/v1/notes/{note_uuid}' },
  {
    name: 'calendar.events',
    run: (c) => c.calendar.events(1, { start: new Date('2026-01-01T00:00:00Z'), end: '2026-02-01T00:00:00Z' }),
    method: 'GET',
    url: '/api/v1/calendar/org/1/events?start=2026-01-01T00%3A00%3A00.000Z&end=2026-02-01T00%3A00%3A00Z',
    template: '/api/v1/calendar/org/{org_id}/events',
    response: [],
  },
  { name: 'instance.info', run: (c) => c.instance.info(), method: 'GET', url: '/api/v1/instance/info', template: '/api/v1/instance/info' },

  // ── embed + admin (Admin API snapshot)
  {
    name: 'embed.createSession',
    run: (c) => c.embed.createSession({ orgSlug: 'acme', userId: 42, ttlSeconds: 600 }),
    method: 'POST',
    url: '/api/v1/admin/acme/auth/embed-session',
    template: '/api/v1/admin/{org_slug}/auth/embed-session',
    body: { user_id: 42, ttl_seconds: 600 },
  },
  {
    name: 'admin.users.provision',
    run: (c) => c.admin.users.provision('acme', { email: 'a@x.io', username: 'ada', first_name: 'Ada' }),
    method: 'POST',
    url: '/api/v1/admin/acme/users',
    template: '/api/v1/admin/{org_slug}/users',
    body: { email: 'a@x.io', username: 'ada', first_name: 'Ada' },
  },
  { name: 'admin.users.getByEmail', run: (c) => c.admin.users.getByEmail('acme', 'a+b@x.io'), method: 'GET', url: '/api/v1/admin/acme/users/by-email/a%2Bb%40x.io', template: '/api/v1/admin/{org_slug}/users/by-email/{email}' },
  { name: 'admin.users.update', run: (c) => c.admin.users.update('acme', 42, { bio: 'hi' }), method: 'PATCH', url: '/api/v1/admin/acme/users/42', template: '/api/v1/admin/{org_slug}/users/{user_id}', body: { bio: 'hi' } },
  { name: 'admin.users.changeRole', run: (c) => c.admin.users.changeRole('acme', 42, 3), method: 'PATCH', url: '/api/v1/admin/acme/users/42/role', template: '/api/v1/admin/{org_slug}/users/{user_id}/role', body: { role_id: 3 } },
  { name: 'admin.users.remove', run: (c) => c.admin.users.remove('acme', 42), method: 'DELETE', url: '/api/v1/admin/acme/users/42', template: '/api/v1/admin/{org_slug}/users/{user_id}' },
  { name: 'admin.users.listGroups', run: (c) => c.admin.users.listGroups('acme', 42), method: 'GET', url: '/api/v1/admin/acme/users/42/groups', template: '/api/v1/admin/{org_slug}/users/{user_id}/groups', response: [] },
  { name: 'admin.users.export', run: (c) => c.admin.users.export('acme', 42), method: 'GET', url: '/api/v1/admin/acme/users/42/export', template: '/api/v1/admin/{org_slug}/users/{user_id}/export' },
  { name: 'admin.users.anonymize', run: (c) => c.admin.users.anonymize('acme', 42), method: 'POST', url: '/api/v1/admin/acme/users/42/anonymize', template: '/api/v1/admin/{org_slug}/users/{user_id}/anonymize' },
  { name: 'admin.enrollments.enroll', run: (c) => c.admin.enrollments.enroll('acme', 42, 'course_1'), method: 'POST', url: '/api/v1/admin/acme/enrollments/42/course_1', template: '/api/v1/admin/{org_slug}/enrollments/{user_id}/{course_uuid}' },
  { name: 'admin.enrollments.unenroll', run: (c) => c.admin.enrollments.unenroll('acme', 42, 'course_1'), method: 'DELETE', url: '/api/v1/admin/acme/enrollments/42/course_1', template: '/api/v1/admin/{org_slug}/enrollments/{user_id}/{course_uuid}' },
  { name: 'admin.enrollments.listForUser', run: (c) => c.admin.enrollments.listForUser('acme', 42), method: 'GET', url: '/api/v1/admin/acme/enrollments/42', template: '/api/v1/admin/{org_slug}/enrollments/{user_id}' },
  {
    name: 'admin.enrollments.listForCourse',
    run: (c) => c.admin.enrollments.listForCourse('acme', 'course_1', { page: 2, limit: 50 }),
    method: 'GET',
    url: '/api/v1/admin/acme/courses/course_1/enrollments?page=2&limit=50',
    template: '/api/v1/admin/{org_slug}/courses/{course_uuid}/enrollments',
    response: [],
  },
  {
    name: 'admin.enrollments.bulkEnroll',
    run: (c) => c.admin.enrollments.bulkEnroll('acme', 'course_1', [1, 2]),
    method: 'POST',
    url: '/api/v1/admin/acme/enrollments/bulk',
    template: '/api/v1/admin/{org_slug}/enrollments/bulk',
    body: { course_uuid: 'course_1', user_ids: [1, 2] },
  },
  {
    name: 'admin.enrollments.bulkUnenroll',
    run: (c) => c.admin.enrollments.bulkUnenroll('acme', 'course_1', [1, 2]),
    method: 'POST',
    url: '/api/v1/admin/acme/enrollments/bulk/unenroll',
    template: '/api/v1/admin/{org_slug}/enrollments/bulk/unenroll',
    body: { course_uuid: 'course_1', user_ids: [1, 2] },
  },
  {
    name: 'admin.enrollments.checkAccess',
    run: (c) => c.admin.enrollments.checkAccess('acme', 'course_1', 42),
    method: 'GET',
    url: '/api/v1/admin/acme/courses/course_1/access/42',
    template: '/api/v1/admin/{org_slug}/courses/{course_uuid}/access/{user_id}',
  },
  { name: 'admin.progress.get', run: (c) => c.admin.progress.get('acme', 42, 'course_1'), method: 'GET', url: '/api/v1/admin/acme/progress/42/course_1', template: '/api/v1/admin/{org_slug}/progress/{user_id}/{course_uuid}' },
  { name: 'admin.progress.listForUser', run: (c) => c.admin.progress.listForUser('acme', 42), method: 'GET', url: '/api/v1/admin/acme/progress/42', template: '/api/v1/admin/{org_slug}/progress/{user_id}', response: [] },
  { name: 'admin.progress.getTrail', run: (c) => c.admin.progress.getTrail('acme', 42), method: 'GET', url: '/api/v1/admin/acme/trails/42', template: '/api/v1/admin/{org_slug}/trails/{user_id}' },
  {
    name: 'admin.progress.getCourseTrail',
    run: (c) => c.admin.progress.getCourseTrail('acme', 42, 'course_1'),
    method: 'GET',
    url: '/api/v1/admin/acme/trails/42/courses/course_1',
    template: '/api/v1/admin/{org_slug}/trails/{user_id}/courses/{course_uuid}',
  },
  {
    name: 'admin.progress.completeActivity',
    run: (c) => c.admin.progress.completeActivity('acme', 42, 'activity_1'),
    method: 'POST',
    url: '/api/v1/admin/acme/progress/42/activities/activity_1/complete',
    template: '/api/v1/admin/{org_slug}/progress/{user_id}/activities/{activity_uuid}/complete',
  },
  {
    name: 'admin.progress.uncompleteActivity',
    run: (c) => c.admin.progress.uncompleteActivity('acme', 42, 'activity_1'),
    method: 'DELETE',
    url: '/api/v1/admin/acme/progress/42/activities/activity_1/complete',
    template: '/api/v1/admin/{org_slug}/progress/{user_id}/activities/{activity_uuid}/complete',
  },
  {
    name: 'admin.progress.completeCourse',
    run: (c) => c.admin.progress.completeCourse('acme', 42, 'course_1'),
    method: 'POST',
    url: '/api/v1/admin/acme/progress/42/course_1/complete',
    template: '/api/v1/admin/{org_slug}/progress/{user_id}/{course_uuid}/complete',
  },
  {
    name: 'admin.progress.reset',
    run: (c) => c.admin.progress.reset('acme', 42, 'course_1'),
    method: 'POST',
    url: '/api/v1/admin/acme/progress/42/course_1/reset',
    template: '/api/v1/admin/{org_slug}/progress/{user_id}/{course_uuid}/reset',
  },
  { name: 'admin.certificates.listForUser', run: (c) => c.admin.certificates.listForUser('acme', 42), method: 'GET', url: '/api/v1/admin/acme/certifications/42', template: '/api/v1/admin/{org_slug}/certifications/{user_id}', response: [] },
  {
    name: 'admin.certificates.award',
    run: (c) => c.admin.certificates.award('acme', 42, 'course_1'),
    method: 'POST',
    url: '/api/v1/admin/acme/certifications/42/course_1/award',
    template: '/api/v1/admin/{org_slug}/certifications/{user_id}/{course_uuid}/award',
  },
  {
    name: 'admin.certificates.revoke',
    run: (c) => c.admin.certificates.revoke('acme', 42, 'cert_1'),
    method: 'DELETE',
    url: '/api/v1/admin/acme/certifications/42/cert_1',
    template: '/api/v1/admin/{org_slug}/certifications/{user_id}/{user_certification_uuid}',
  },
  {
    name: 'admin.usergroups.create',
    run: (c) => c.admin.usergroups.create('acme', { name: 'Cohort A', description: 'Spring' }),
    method: 'POST',
    url: '/api/v1/admin/acme/usergroups',
    template: '/api/v1/admin/{org_slug}/usergroups',
    body: { name: 'Cohort A', description: 'Spring' },
  },
  { name: 'admin.usergroups.delete', run: (c) => c.admin.usergroups.delete('acme', 'usergroup_1'), method: 'DELETE', url: '/api/v1/admin/acme/usergroups/usergroup_1', template: '/api/v1/admin/{org_slug}/usergroups/{usergroup_uuid}' },
  {
    name: 'admin.usergroups.listMembers',
    run: (c) => c.admin.usergroups.listMembers('acme', 'usergroup_1', { limit: 100 }),
    method: 'GET',
    url: '/api/v1/admin/acme/usergroups/usergroup_1/members?limit=100',
    template: '/api/v1/admin/{org_slug}/usergroups/{usergroup_uuid}/members',
    response: [],
  },
  {
    name: 'admin.usergroups.addMember',
    run: (c) => c.admin.usergroups.addMember('acme', 'usergroup_1', 42),
    method: 'POST',
    url: '/api/v1/admin/acme/usergroups/usergroup_1/members/42',
    template: '/api/v1/admin/{org_slug}/usergroups/{usergroup_uuid}/members/{user_id}',
  },
  {
    name: 'admin.usergroups.removeMember',
    run: (c) => c.admin.usergroups.removeMember('acme', 'usergroup_1', 42),
    method: 'DELETE',
    url: '/api/v1/admin/acme/usergroups/usergroup_1/members/42',
    template: '/api/v1/admin/{org_slug}/usergroups/{usergroup_uuid}/members/{user_id}',
  },
  {
    name: 'admin.usergroups.addCourse',
    run: (c) => c.admin.usergroups.addCourse('acme', 'usergroup_1', 'course_1'),
    method: 'POST',
    url: '/api/v1/admin/acme/usergroups/usergroup_1/courses/course_1',
    template: '/api/v1/admin/{org_slug}/usergroups/{usergroup_uuid}/courses/{course_uuid}',
  },
  {
    name: 'admin.usergroups.removeCourse',
    run: (c) => c.admin.usergroups.removeCourse('acme', 'usergroup_1', 'course_1'),
    method: 'DELETE',
    url: '/api/v1/admin/acme/usergroups/usergroup_1/courses/course_1',
    template: '/api/v1/admin/{org_slug}/usergroups/{usergroup_uuid}/courses/{course_uuid}',
  },
  { name: 'admin.courses.analytics', run: (c) => c.admin.courses.analytics('acme', 'course_1'), method: 'GET', url: '/api/v1/admin/acme/courses/course_1/analytics', template: '/api/v1/admin/{org_slug}/courses/{course_uuid}/analytics' },
  {
    name: 'admin.auth.magicLink',
    run: (c) => c.admin.auth.magicLink('acme', { userId: 42, redirectTo: '/course/1', ttlSeconds: 120 }),
    method: 'POST',
    url: '/api/v1/admin/acme/auth/magic-link',
    template: '/api/v1/admin/{org_slug}/auth/magic-link',
    body: { user_id: 42, redirect_to: '/course/1', ttl_seconds: 120 },
  },
  {
    name: 'admin.auth.magicLink (host)',
    run: (c) => c.admin.auth.magicLink('acme', { userId: 42, host: 'learn.acme.com' }),
    method: 'POST',
    url: '/api/v1/admin/acme/auth/magic-link',
    template: '/api/v1/admin/{org_slug}/auth/magic-link',
    body: { user_id: 42, host: 'learn.acme.com' },
  },
  { name: 'admin.auth.issueToken', run: (c) => c.admin.auth.issueToken('acme', 42), method: 'POST', url: '/api/v1/admin/acme/auth/token', template: '/api/v1/admin/{org_slug}/auth/token', body: { user_id: 42 } },
]

/**
 * Methods that are not one request to a fixed endpoint: iterators (tested on
 * their own), and the Agent API, whose routes are EE and not in the snapshot.
 */
export const NOT_IN_TABLE = new Set([
  'courses.listAll',
  'search.orgPages',
  'communities.listAll',
  'podcasts.listAll',
  'notifications.listAll',
])

/** `resource.method` names of every function reachable from a client's resources. */
export function resourceMethodNames(client: LearnHouseClient): string[] {
  const skip = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'request', 'baseUrl', 'media', 'agent', 'session'])
  const out: string[] = []
  const walk = (obj: Record<string, unknown>, prefix: string) => {
    for (const [key, value] of Object.entries(obj)) {
      if (!prefix && skip.has(key)) continue
      const name = prefix ? `${prefix}.${key}` : key
      if (typeof value === 'function') out.push(name)
      else if (value && typeof value === 'object') walk(value as Record<string, unknown>, name)
    }
  }
  walk(client as unknown as Record<string, unknown>, '')
  return out
}
