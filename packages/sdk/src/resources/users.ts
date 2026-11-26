import type { HttpCore } from '../core/http'
import type { BaseRequestOptions } from '../core/types'
import { appendFile, type UploadFile } from '../core/upload'
import type {
  Course,
  PublicUserProfile,
  User,
  UserPreferences,
  UserPreferencesInput,
  UserSession,
  UserUpdateInput,
} from '../models'

export interface ListUserCoursesOptions extends BaseRequestOptions {
  /** 1-based. Default 1 (server side). */
  page?: number
  /** 1..50. Default 20 (server side). */
  limit?: number
}

export interface UpdateAvatarOptions extends BaseRequestOptions {
  /** File name sent with a Blob that has none (React Native, generated images). Default `avatar.png`. */
  filename?: string
}


export function createUsersResource(http: HttpCore) {
  return {
    /**
     * The current user with org memberships and roles (what the web app loads
     * after sign-in). Fails for anonymous callers.
     * `GET /api/v1/users/session`
     */
    session(options?: BaseRequestOptions): Promise<UserSession> {
      return http.GET('/api/v1/users/session', options)
    },
    /**
     * The signed-in user's own account record (email included).
     * `GET /api/v1/users/profile`
     */
    profile(options?: BaseRequestOptions): Promise<User> {
      return http.GET('/api/v1/users/profile', options) as Promise<User>
    },
    /** `GET /api/v1/users/uuid/{user_uuid}` */
    getByUuid(userUuid: string, options?: BaseRequestOptions): Promise<PublicUserProfile> {
      return http.GET('/api/v1/users/uuid/{user_uuid}', {
        ...options,
        params: { path: { user_uuid: userUuid } },
      })
    },
    /** `GET /api/v1/users/id/{user_id}` */
    getById(userId: number, options?: BaseRequestOptions): Promise<PublicUserProfile> {
      return http.GET('/api/v1/users/id/{user_id}', {
        ...options,
        params: { path: { user_id: userId } },
      })
    },
    /** `GET /api/v1/users/username/{username}` */
    getByUsername(username: string, options?: BaseRequestOptions): Promise<PublicUserProfile> {
      return http.GET('/api/v1/users/username/{username}', {
        ...options,
        params: { path: { username } },
      })
    },
    /**
     * Courses a user authored or contributes to (their public profile list,
     * not their enrollments: see `trail`). At most 50 per page.
     * `GET /api/v1/users/{user_id}/courses`
     */
    listCourses(userId: number, options: ListUserCoursesOptions = {}): Promise<Course[]> {
      const { page, limit, ...rest } = options
      return http.GET('/api/v1/users/{user_id}/courses', {
        ...rest,
        params: { path: { user_id: userId }, query: { page, limit } },
      })
    },
    /**
     * Update the signed-in user's profile. The API replaces the record, so
     * send `username` and `email` too (e.g. from `profile()`). Changing the
     * email needs `current_password` (or `mfa_code` for accounts without a
     * password).
     * `PUT /api/v1/users/{user_id}`
     */
    update(userId: number, input: UserUpdateInput, options?: BaseRequestOptions): Promise<User> {
      return http.PUT('/api/v1/users/{user_id}', {
        ...options,
        params: { path: { user_id: userId } },
        body: input,
      })
    },
    /**
     * Upload a new avatar (JPEG, PNG, WebP or GIF).
     * `PUT /api/v1/users/update_avatar/{user_id}` (multipart, field `avatar_file`)
     */
    updateAvatar(userId: number, file: UploadFile, options: UpdateAvatarOptions = {}): Promise<User> {
      const { filename, ...rest } = options
      const form = new FormData()
      appendFile(form, 'avatar_file', file, filename ?? 'avatar.png')
      return http.PUT('/api/v1/users/update_avatar/{user_id}', {
        ...rest,
        params: { path: { user_id: userId } },
        body: form,
      })
    },
    /**
     * Change the signed-in user's password. Signs out their other sessions.
     * `PUT /api/v1/users/change_password/{user_id}`
     */
    changePassword(
      userId: number,
      input: { oldPassword: string; newPassword: string },
      options?: BaseRequestOptions,
    ): Promise<User> {
      return http.PUT('/api/v1/users/change_password/{user_id}', {
        ...options,
        params: { path: { user_id: userId } },
        body: { old_password: input.oldPassword, new_password: input.newPassword },
      })
    },
    /** `GET /api/v1/users/me/preferences` */
    getPreferences(options?: BaseRequestOptions): Promise<UserPreferences> {
      return http.GET('/api/v1/users/me/preferences', options)
    },
    /** `PUT /api/v1/users/me/preferences` */
    updatePreferences(input: UserPreferencesInput, options?: BaseRequestOptions): Promise<UserPreferences> {
      return http.PUT('/api/v1/users/me/preferences', { ...options, body: input })
    },
    /**
     * Permanently delete the signed-in user's account. Cannot be undone.
     * `DELETE /api/v1/users/user_id/{user_id}`
     */
    deleteAccount(userId: number, options?: BaseRequestOptions): Promise<unknown> {
      return http.DELETE('/api/v1/users/user_id/{user_id}', {
        ...options,
        params: { path: { user_id: userId } },
      })
    },
  }
}

export type UsersResource = ReturnType<typeof createUsersResource>
