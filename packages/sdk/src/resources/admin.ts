// The headless Admin API: `/api/v1/admin/{org_slug}/...`, org API tokens only.
// Types come from the Admin API snapshot (src/generated/admin-schema.ts),
// which scripts/generate.mjs writes next to the main one.
import type { HttpCore } from '../core/http'
import type { BaseRequestOptions, OperationResponse } from '../core/types'
import type { components, paths as AdminPaths } from '../generated/admin-schema'

type AdminSchemas = components['schemas']
type Method = 'get' | 'post' | 'patch' | 'delete'
/** Response type of one Admin API operation. */
export type AdminResponse<P extends keyof AdminPaths, M extends Method> = OperationResponse<NonNullable<AdminPaths[P][M]>>

export type AdminUser = AdminSchemas['UserRead']
export type AdminOrgMember = AdminSchemas['OrgMemberUserRead']
export type AdminTrail = AdminSchemas['TrailRead']
export type AdminCourseProgress = AdminSchemas['ProgressResponse']
export type AdminProgressSummary = AdminSchemas['ProgressSummaryItem']
export type AdminTrailDetail = AdminSchemas['UserTrailDetail']
export type AdminCertificate = AdminSchemas['CertificateItem']
export type AdminCourseEnrollment = AdminSchemas['CourseEnrollmentItem']
export type AdminCourseAccess = AdminSchemas['CourseAccessResponse']
export type AdminCourseAnalytics = AdminSchemas['CourseAnalyticsResponse']
export type AdminUserGroup = AdminSchemas['UserGroupResponse']
export type AdminUserGroupMember = AdminSchemas['UserGroupMemberListItem']
export type AdminUserGroupOfUser = AdminSchemas['UserUserGroupItem']
export type AdminUserToken = AdminSchemas['TokenResponse']
export type AdminMagicLink = AdminSchemas['MagicLinkResponse']
export type AdminUserExport = AdminSchemas['UserDataExportResponse']
export type ProvisionUserInput = AdminSchemas['ProvisionUserRequest']
export type AdminUserUpdateInput = AdminSchemas['UpdateUserRequest']

export interface AdminPageOptions extends BaseRequestOptions {
  /** 1-based. Default 1 (server side). */
  page?: number
  /** Default 20, at most 100 (server side). */
  limit?: number
}

export interface MagicLinkInput {
  userId: number
  /** Same-origin path to land on after sign-in, e.g. `/course/abc`. */
  redirectTo?: string
  /** 60 to 900 seconds. Default 300 (server side). */
  ttlSeconds?: number
  /** One of the org's verified custom domains, to issue the link on. */
  host?: string
}

const ADMIN = '/api/v1/admin/{org_slug}'

/**
 * Server-side management of an organization's learners with an org API token
 * (`lh_…`): provision users, enroll them, read and set their progress, award
 * certificates, manage group membership, mint sign-in links and embed
 * sessions. User sessions are refused (403). Every method takes the org slug
 * the token belongs to first; another org's slug is refused.
 */
export function createAdminResource(http: HttpCore) {
  function call<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    orgSlug: string,
    pathParams: Record<string, string | number>,
    options: BaseRequestOptions & { query?: Record<string, unknown>; body?: unknown } = {},
  ): Promise<T> {
    const { query, body, ...rest } = options
    return http.request<T>(method, `${ADMIN}${path}`, {
      ...rest,
      params: { path: { org_slug: orgSlug, ...pathParams }, query },
      body,
    })
  }

  return {
    users: {
      /**
       * Create an account and add it to the org in one call (SSO / JIT
       * provisioning: no email verification step). An email that already has
       * an account answers 409; a taken username 400. Without `password` the
       * user signs in by magic link or SSO. `POST /admin/{org_slug}/users`
       */
      provision(orgSlug: string, input: ProvisionUserInput, options?: BaseRequestOptions): Promise<AdminUser> {
        return call('POST', '/users', orgSlug, {}, { ...options, body: input })
      },
      /** Look a member up by email. `GET /admin/{org_slug}/users/by-email/{email}` */
      getByEmail(orgSlug: string, email: string, options?: BaseRequestOptions): Promise<AdminOrgMember> {
        return call('GET', '/users/by-email/{email}', orgSlug, { email }, options)
      },
      /** Change profile fields; only the ones given. `PATCH /admin/{org_slug}/users/{user_id}` */
      update(orgSlug: string, userId: number, input: AdminUserUpdateInput, options?: BaseRequestOptions): Promise<AdminOrgMember> {
        return call('PATCH', '/users/{user_id}', orgSlug, { user_id: userId }, { ...options, body: input })
      },
      /** Give the member another org role. `PATCH /admin/{org_slug}/users/{user_id}/role` */
      changeRole(
        orgSlug: string,
        userId: number,
        roleId: number,
        options?: BaseRequestOptions,
      ): Promise<AdminResponse<'/api/v1/admin/{org_slug}/users/{user_id}/role', 'patch'>> {
        return call('PATCH', '/users/{user_id}/role', orgSlug, { user_id: userId }, { ...options, body: { role_id: roleId } })
      },
      /** Remove the member from the org (the account stays). `DELETE /admin/{org_slug}/users/{user_id}` */
      remove(orgSlug: string, userId: number, options?: BaseRequestOptions): Promise<{ detail: string }> {
        return call('DELETE', '/users/{user_id}', orgSlug, { user_id: userId }, options)
      },
      /** The groups the member is in. `GET /admin/{org_slug}/users/{user_id}/groups` */
      listGroups(orgSlug: string, userId: number, options?: BaseRequestOptions): Promise<AdminUserGroupOfUser[]> {
        return call('GET', '/users/{user_id}/groups', orgSlug, { user_id: userId }, options)
      },
      /** Everything stored about the member in this org (data export). `GET /admin/{org_slug}/users/{user_id}/export` */
      export(orgSlug: string, userId: number, options?: BaseRequestOptions): Promise<AdminUserExport> {
        return call('GET', '/users/{user_id}/export', orgSlug, { user_id: userId }, options)
      },
      /**
       * Irreversibly anonymize the account (right to erasure).
       * `POST /admin/{org_slug}/users/{user_id}/anonymize`
       */
      anonymize(
        orgSlug: string,
        userId: number,
        options?: BaseRequestOptions,
      ): Promise<AdminResponse<'/api/v1/admin/{org_slug}/users/{user_id}/anonymize', 'post'>> {
        return call('POST', '/users/{user_id}/anonymize', orgSlug, { user_id: userId }, options)
      },
    },
    enrollments: {
      /** Enroll a member in a course. Idempotent. `POST /admin/{org_slug}/enrollments/{user_id}/{course_uuid}` */
      enroll(orgSlug: string, userId: number, courseUuid: string, options?: BaseRequestOptions): Promise<AdminTrail> {
        return call('POST', '/enrollments/{user_id}/{course_uuid}', orgSlug, { user_id: userId, course_uuid: courseUuid }, options)
      },
      /** `DELETE /admin/{org_slug}/enrollments/{user_id}/{course_uuid}` */
      unenroll(orgSlug: string, userId: number, courseUuid: string, options?: BaseRequestOptions): Promise<{ detail: string }> {
        return call('DELETE', '/enrollments/{user_id}/{course_uuid}', orgSlug, { user_id: userId, course_uuid: courseUuid }, options)
      },
      /** A member's enrollments (their trail). `GET /admin/{org_slug}/enrollments/{user_id}` */
      listForUser(orgSlug: string, userId: number, options?: BaseRequestOptions): Promise<AdminTrail> {
        return call('GET', '/enrollments/{user_id}', orgSlug, { user_id: userId }, options)
      },
      /** Enrolled learners of a course. `GET /admin/{org_slug}/courses/{course_uuid}/enrollments` */
      listForCourse(orgSlug: string, courseUuid: string, options: AdminPageOptions = {}): Promise<AdminCourseEnrollment[]> {
        const { page, limit, ...rest } = options
        return call('GET', '/courses/{course_uuid}/enrollments', orgSlug, { course_uuid: courseUuid }, { ...rest, query: { page, limit } })
      },
      /** `POST /admin/{org_slug}/enrollments/bulk` */
      bulkEnroll(
        orgSlug: string,
        courseUuid: string,
        userIds: number[],
        options?: BaseRequestOptions,
      ): Promise<AdminResponse<'/api/v1/admin/{org_slug}/enrollments/bulk', 'post'>> {
        return call('POST', '/enrollments/bulk', orgSlug, {}, { ...options, body: { course_uuid: courseUuid, user_ids: userIds } })
      },
      /** `POST /admin/{org_slug}/enrollments/bulk/unenroll` */
      bulkUnenroll(
        orgSlug: string,
        courseUuid: string,
        userIds: number[],
        options?: BaseRequestOptions,
      ): Promise<AdminResponse<'/api/v1/admin/{org_slug}/enrollments/bulk/unenroll', 'post'>> {
        return call('POST', '/enrollments/bulk/unenroll', orgSlug, {}, {
          ...options,
          body: { course_uuid: courseUuid, user_ids: userIds },
        })
      },
      /** Whether a member can open a course, and why. `GET /admin/{org_slug}/courses/{course_uuid}/access/{user_id}` */
      checkAccess(orgSlug: string, courseUuid: string, userId: number, options?: BaseRequestOptions): Promise<AdminCourseAccess> {
        return call('GET', '/courses/{course_uuid}/access/{user_id}', orgSlug, { course_uuid: courseUuid, user_id: userId }, options)
      },
    },
    progress: {
      /** One course's progress. `GET /admin/{org_slug}/progress/{user_id}/{course_uuid}` */
      get(orgSlug: string, userId: number, courseUuid: string, options?: BaseRequestOptions): Promise<AdminCourseProgress> {
        return call('GET', '/progress/{user_id}/{course_uuid}', orgSlug, { user_id: userId, course_uuid: courseUuid }, options)
      },
      /** Progress in every enrolled course. `GET /admin/{org_slug}/progress/{user_id}` */
      listForUser(orgSlug: string, userId: number, options?: BaseRequestOptions): Promise<AdminProgressSummary[]> {
        return call('GET', '/progress/{user_id}', orgSlug, { user_id: userId }, options)
      },
      /** Chapter-by-chapter detail of every course. `GET /admin/{org_slug}/trails/{user_id}` */
      getTrail(orgSlug: string, userId: number, options?: BaseRequestOptions): Promise<AdminTrailDetail> {
        return call('GET', '/trails/{user_id}', orgSlug, { user_id: userId }, options)
      },
      /** Chapter-by-chapter detail of one course. `GET /admin/{org_slug}/trails/{user_id}/courses/{course_uuid}` */
      getCourseTrail(orgSlug: string, userId: number, courseUuid: string, options?: BaseRequestOptions): Promise<AdminTrailDetail> {
        return call('GET', '/trails/{user_id}/courses/{course_uuid}', orgSlug, { user_id: userId, course_uuid: courseUuid }, options)
      },
      /**
       * Mark an activity complete for a member (enrolls them if needed).
       * `POST /admin/{org_slug}/progress/{user_id}/activities/{activity_uuid}/complete`
       */
      completeActivity(
        orgSlug: string,
        userId: number,
        activityUuid: string,
        options?: BaseRequestOptions,
      ): Promise<AdminResponse<'/api/v1/admin/{org_slug}/progress/{user_id}/activities/{activity_uuid}/complete', 'post'>> {
        return call('POST', '/progress/{user_id}/activities/{activity_uuid}/complete', orgSlug, {
          user_id: userId,
          activity_uuid: activityUuid,
        }, options)
      },
      /** `DELETE /admin/{org_slug}/progress/{user_id}/activities/{activity_uuid}/complete` */
      uncompleteActivity(
        orgSlug: string,
        userId: number,
        activityUuid: string,
        options?: BaseRequestOptions,
      ): Promise<AdminResponse<'/api/v1/admin/{org_slug}/progress/{user_id}/activities/{activity_uuid}/complete', 'delete'>> {
        return call('DELETE', '/progress/{user_id}/activities/{activity_uuid}/complete', orgSlug, {
          user_id: userId,
          activity_uuid: activityUuid,
        }, options)
      },
      /** Complete every activity of a course. `POST /admin/{org_slug}/progress/{user_id}/{course_uuid}/complete` */
      completeCourse(
        orgSlug: string,
        userId: number,
        courseUuid: string,
        options?: BaseRequestOptions,
      ): Promise<AdminResponse<'/api/v1/admin/{org_slug}/progress/{user_id}/{course_uuid}/complete', 'post'>> {
        return call('POST', '/progress/{user_id}/{course_uuid}/complete', orgSlug, { user_id: userId, course_uuid: courseUuid }, options)
      },
      /** Delete every completion in a course. `POST /admin/{org_slug}/progress/{user_id}/{course_uuid}/reset` */
      reset(
        orgSlug: string,
        userId: number,
        courseUuid: string,
        options?: BaseRequestOptions,
      ): Promise<AdminResponse<'/api/v1/admin/{org_slug}/progress/{user_id}/{course_uuid}/reset', 'post'>> {
        return call('POST', '/progress/{user_id}/{course_uuid}/reset', orgSlug, { user_id: userId, course_uuid: courseUuid }, options)
      },
    },
    certificates: {
      /** `GET /admin/{org_slug}/certifications/{user_id}` */
      listForUser(orgSlug: string, userId: number, options?: BaseRequestOptions): Promise<AdminCertificate[]> {
        return call('GET', '/certifications/{user_id}', orgSlug, { user_id: userId }, options)
      },
      /** Issue a course's certificate now. `POST /admin/{org_slug}/certifications/{user_id}/{course_uuid}/award` */
      award(
        orgSlug: string,
        userId: number,
        courseUuid: string,
        options?: BaseRequestOptions,
      ): Promise<AdminResponse<'/api/v1/admin/{org_slug}/certifications/{user_id}/{course_uuid}/award', 'post'>> {
        return call('POST', '/certifications/{user_id}/{course_uuid}/award', orgSlug, { user_id: userId, course_uuid: courseUuid }, options)
      },
      /** `DELETE /admin/{org_slug}/certifications/{user_id}/{user_certification_uuid}` */
      revoke(
        orgSlug: string,
        userId: number,
        userCertificationUuid: string,
        options?: BaseRequestOptions,
      ): Promise<AdminResponse<'/api/v1/admin/{org_slug}/certifications/{user_id}/{user_certification_uuid}', 'delete'>> {
        return call('DELETE', '/certifications/{user_id}/{user_certification_uuid}', orgSlug, {
          user_id: userId,
          user_certification_uuid: userCertificationUuid,
        }, options)
      },
    },
    usergroups: {
      /** `POST /admin/{org_slug}/usergroups` */
      create(orgSlug: string, input: { name: string; description?: string }, options?: BaseRequestOptions): Promise<AdminUserGroup> {
        return call('POST', '/usergroups', orgSlug, {}, { ...options, body: input })
      },
      /** `DELETE /admin/{org_slug}/usergroups/{usergroup_uuid}` */
      delete(
        orgSlug: string,
        usergroupUuid: string,
        options?: BaseRequestOptions,
      ): Promise<AdminResponse<'/api/v1/admin/{org_slug}/usergroups/{usergroup_uuid}', 'delete'>> {
        return call('DELETE', '/usergroups/{usergroup_uuid}', orgSlug, { usergroup_uuid: usergroupUuid }, options)
      },
      /** `GET /admin/{org_slug}/usergroups/{usergroup_uuid}/members` */
      listMembers(orgSlug: string, usergroupUuid: string, options: AdminPageOptions = {}): Promise<AdminUserGroupMember[]> {
        const { page, limit, ...rest } = options
        return call('GET', '/usergroups/{usergroup_uuid}/members', orgSlug, { usergroup_uuid: usergroupUuid }, {
          ...rest,
          query: { page, limit },
        })
      },
      /** `POST /admin/{org_slug}/usergroups/{usergroup_uuid}/members/{user_id}` */
      addMember(
        orgSlug: string,
        usergroupUuid: string,
        userId: number,
        options?: BaseRequestOptions,
      ): Promise<AdminResponse<'/api/v1/admin/{org_slug}/usergroups/{usergroup_uuid}/members/{user_id}', 'post'>> {
        return call('POST', '/usergroups/{usergroup_uuid}/members/{user_id}', orgSlug, { usergroup_uuid: usergroupUuid, user_id: userId }, options)
      },
      /** `DELETE /admin/{org_slug}/usergroups/{usergroup_uuid}/members/{user_id}` */
      removeMember(
        orgSlug: string,
        usergroupUuid: string,
        userId: number,
        options?: BaseRequestOptions,
      ): Promise<AdminResponse<'/api/v1/admin/{org_slug}/usergroups/{usergroup_uuid}/members/{user_id}', 'delete'>> {
        return call('DELETE', '/usergroups/{usergroup_uuid}/members/{user_id}', orgSlug, { usergroup_uuid: usergroupUuid, user_id: userId }, options)
      },
      /** Give the group access to a course. `POST /admin/{org_slug}/usergroups/{usergroup_uuid}/courses/{course_uuid}` */
      addCourse(
        orgSlug: string,
        usergroupUuid: string,
        courseUuid: string,
        options?: BaseRequestOptions,
      ): Promise<AdminResponse<'/api/v1/admin/{org_slug}/usergroups/{usergroup_uuid}/courses/{course_uuid}', 'post'>> {
        return call('POST', '/usergroups/{usergroup_uuid}/courses/{course_uuid}', orgSlug, { usergroup_uuid: usergroupUuid, course_uuid: courseUuid }, options)
      },
      /** `DELETE /admin/{org_slug}/usergroups/{usergroup_uuid}/courses/{course_uuid}` */
      removeCourse(
        orgSlug: string,
        usergroupUuid: string,
        courseUuid: string,
        options?: BaseRequestOptions,
      ): Promise<AdminResponse<'/api/v1/admin/{org_slug}/usergroups/{usergroup_uuid}/courses/{course_uuid}', 'delete'>> {
        return call('DELETE', '/usergroups/{usergroup_uuid}/courses/{course_uuid}', orgSlug, { usergroup_uuid: usergroupUuid, course_uuid: courseUuid }, options)
      },
    },
    courses: {
      /** Enrollment, completion and certificate counts. `GET /admin/{org_slug}/courses/{course_uuid}/analytics` */
      analytics(orgSlug: string, courseUuid: string, options?: BaseRequestOptions): Promise<AdminCourseAnalytics> {
        return call('GET', '/courses/{course_uuid}/analytics', orgSlug, { course_uuid: courseUuid }, options)
      },
    },
    auth: {
      /**
       * A one-time sign-in URL for a member, on the org's own site. Open it in
       * their browser, or redeem its `token` with `auth.verifyMagicLink()`.
       * Admins and maintainers are refused. `POST /admin/{org_slug}/auth/magic-link`
       */
      magicLink(orgSlug: string, input: MagicLinkInput, options?: BaseRequestOptions): Promise<AdminMagicLink> {
        const body: Record<string, unknown> = { user_id: input.userId }
        if (input.redirectTo !== undefined) body.redirect_to = input.redirectTo
        if (input.ttlSeconds !== undefined) body.ttl_seconds = input.ttlSeconds
        if (input.host !== undefined) body.host = input.host
        return call('POST', '/auth/magic-link', orgSlug, {}, { ...options, body })
      },
      /**
       * A full access token for a member, to call the API as them from your
       * server (it is not limited like an embed session). Keep it server-side.
       * Admins and maintainers are refused. `POST /admin/{org_slug}/auth/token`
       */
      issueToken(orgSlug: string, userId: number, options?: BaseRequestOptions): Promise<AdminUserToken> {
        return call('POST', '/auth/token', orgSlug, {}, { ...options, body: { user_id: userId } })
      },
    },
  }
}

export type AdminResource = ReturnType<typeof createAdminResource>
