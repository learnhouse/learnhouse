// Compile-time checks that the resources return the right types and refuse
// wrong input. They run under `tsc --noEmit` (bun run typecheck); vitest only
// executes the body.
import { describe, expectTypeOf, it } from 'vitest'
import {
  createClient,
  type AdminCourseProgress,
  type AdminOrgMember,
  type AdminTrail,
  type AdminUser,
  type Assignment,
  type AssignmentGrade,
  type AssignmentRetry,
  type AssignmentSubmission,
  type AssignmentTask,
  type AssignmentTaskSubmission,
  type CalendarEvent,
  type Certificate,
  type Community,
  type Course,
  type CourseProgress,
  type CourseUpdate,
  type Discussion,
  type DiscussionComment,
  type EmbedSession,
  type LearningPath,
  type LoginResult,
  type MagicLinkResult,
  type MfaEnabled,
  type MfaSetup,
  type MfaStatus,
  type MyAssignment,
  type Note,
  type NotificationPage,
  type Organization,
  type PodcastEpisode,
  type PublicUserProfile,
  type Trail,
  type UploadFile,
  type User,
  type UserGroupJoinResult,
  type UserPreferences,
  type UserSignup,
  type VerifyEmailResult,
} from '../src'

const lh = createClient({ baseUrl: 'http://x', fetch: async () => new Response('{}') })

describe('resource return types', () => {
  it('auth and accounts', () => {
    expectTypeOf(lh.auth.login).returns.resolves.toEqualTypeOf<LoginResult>()
    expectTypeOf(lh.auth.signup).returns.resolves.toEqualTypeOf<UserSignup | User>()
    expectTypeOf(lh.auth.verifyMagicLink).returns.resolves.toEqualTypeOf<MagicLinkResult>()
    expectTypeOf(lh.auth.verifyEmail).returns.resolves.toEqualTypeOf<VerifyEmailResult>()
    expectTypeOf(lh.auth.mfa.status).returns.resolves.toEqualTypeOf<MfaStatus>()
    expectTypeOf(lh.auth.mfa.setup).returns.resolves.toEqualTypeOf<MfaSetup>()
    expectTypeOf(lh.auth.mfa.confirm).returns.resolves.toEqualTypeOf<MfaEnabled>()
    expectTypeOf(lh.users.profile).returns.resolves.toEqualTypeOf<User>()
    expectTypeOf(lh.users.update).returns.resolves.toEqualTypeOf<User>()
    expectTypeOf(lh.users.getByUsername).returns.resolves.toEqualTypeOf<PublicUserProfile>()
    expectTypeOf(lh.users.getPreferences).returns.resolves.toEqualTypeOf<UserPreferences>()
    expectTypeOf(lh.orgs.listMine).returns.resolves.toEqualTypeOf<Organization[]>()
  })

  it('learning', () => {
    expectTypeOf(lh.courses.search).returns.resolves.toEqualTypeOf<Course[]>()
    expectTypeOf(lh.courses.listUpdates).returns.resolves.toEqualTypeOf<CourseUpdate[]>()
    expectTypeOf(lh.trail.startCourse).returns.resolves.toEqualTypeOf<Trail>()
    expectTypeOf(lh.trail.getCourseProgress).returns.resolves.toEqualTypeOf<CourseProgress>()
    expectTypeOf(lh.assignments.listMine).returns.resolves.toEqualTypeOf<MyAssignment[]>()
    expectTypeOf(lh.assignments.get).returns.resolves.toEqualTypeOf<Assignment>()
    expectTypeOf(lh.assignments.listTasks).returns.resolves.toEqualTypeOf<AssignmentTask[]>()
    expectTypeOf(lh.assignments.getMyTaskSubmissions).returns.resolves.toEqualTypeOf<Record<string, AssignmentTaskSubmission | null>>()
    expectTypeOf(lh.assignments.saveTaskSubmission).returns.resolves.toEqualTypeOf<AssignmentTaskSubmission>()
    expectTypeOf(lh.assignments.uploadTaskFile).returns.resolves.toEqualTypeOf<{ file_uuid: string }>()
    expectTypeOf(lh.assignments.submit).returns.resolves.toEqualTypeOf<AssignmentSubmission>()
    expectTypeOf(lh.assignments.getMySubmission).returns.resolves.toEqualTypeOf<AssignmentSubmission[]>()
    expectTypeOf(lh.assignments.getGrade).returns.resolves.toEqualTypeOf<AssignmentGrade>()
    expectTypeOf(lh.assignments.retry).returns.resolves.toEqualTypeOf<AssignmentRetry>()
    expectTypeOf(lh.certificates.listMine).returns.resolves.toEqualTypeOf<Certificate[]>()
    expectTypeOf(lh.certificates.verify).returns.resolves.toEqualTypeOf<Certificate | null>()
    expectTypeOf(lh.paths.enroll).returns.resolves.toEqualTypeOf<LearningPath>()
    expectTypeOf(lh.notes.create).returns.resolves.toEqualTypeOf<Note>()
    expectTypeOf(lh.calendar.events).returns.resolves.toEqualTypeOf<CalendarEvent[]>()
    expectTypeOf(lh.podcasts.listEpisodes).returns.resolves.toEqualTypeOf<PodcastEpisode[]>()
    expectTypeOf(lh.podcasts.count).returns.resolves.toEqualTypeOf<number>()
  })

  it('community and notifications', () => {
    expectTypeOf(lh.communities.getForCourse).returns.resolves.toEqualTypeOf<Community | null>()
    expectTypeOf(lh.communities.listDiscussions).returns.resolves.toEqualTypeOf<Discussion[]>()
    expectTypeOf(lh.discussions.reply).returns.resolves.toEqualTypeOf<DiscussionComment>()
    expectTypeOf(lh.notifications.list).returns.resolves.toEqualTypeOf<NotificationPage>()
    expectTypeOf(lh.usergroups.join).returns.resolves.toEqualTypeOf<UserGroupJoinResult>()
  })

  it('server side', () => {
    expectTypeOf(lh.embed.createSession).returns.resolves.toEqualTypeOf<EmbedSession>()
    expectTypeOf(lh.admin.users.provision).returns.resolves.toEqualTypeOf<AdminUser>()
    expectTypeOf(lh.admin.users.getByEmail).returns.resolves.toEqualTypeOf<AdminOrgMember>()
    expectTypeOf(lh.admin.enrollments.enroll).returns.resolves.toEqualTypeOf<AdminTrail>()
    expectTypeOf(lh.admin.progress.get).returns.resolves.toEqualTypeOf<AdminCourseProgress>()
    // Generated from the API: field names are checked, not hand-written.
    expectTypeOf<AdminCourseProgress['completion_percentage']>().toEqualTypeOf<number>()
  })

  it('uploads accept Blob, File and React Native files', () => {
    expectTypeOf<Blob>().toMatchTypeOf<UploadFile>()
    expectTypeOf<{ uri: string; name: string; type: string }>().toMatchTypeOf<UploadFile>()
  })

  it('refuses wrong input at compile time', () => {
    if (false as boolean) {
      // @ts-expect-error orgId is a number
      void lh.paths.list('1')
      // @ts-expect-error email is required
      void lh.auth.signup({ username: 'u', password: 'p' })
      // @ts-expect-error only google is accepted
      void lh.auth.loginWithOAuth({ provider: 'github', email: 'a', accessToken: 't' })
      // @ts-expect-error theme is light | dark
      void lh.users.updatePreferences({ theme: 'blue' })
      // @ts-expect-error username and email are required by the API
      void lh.users.update(1, { first_name: 'x' })
      // @ts-expect-error unknown notification category
      void lh.notifications.list({ category: 'nope' })
      // @ts-expect-error platform is ios | android
      void lh.notifications.registerDevice({ token: 't', platform: 'web' })
      // @ts-expect-error sort is recent | upvotes | hot
      void lh.communities.listDiscussions('c', { sortBy: 'oldest' })
      // @ts-expect-error provision needs a username
      void lh.admin.users.provision('acme', { email: 'a@x.io' })
      // @ts-expect-error user ids are numbers
      void lh.admin.enrollments.enroll('acme', '42', 'course_1')
      // @ts-expect-error a string is not a file
      void lh.users.updateAvatar(1, 'file.png')
    }
  })
})
