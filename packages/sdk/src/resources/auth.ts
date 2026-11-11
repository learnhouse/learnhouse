import type { HttpCore } from '../core/http'
import type { BaseRequestOptions } from '../core/types'
import type { AuthMe, AuthTokens, LoginResult, LoginSuccess } from '../models'

export interface LoginInput {
  email: string
  password: string
  /** Org the sign-in is for; applies that org's allowed sign-in methods. */
  orgSlug?: string
}

export interface RefreshOptions extends BaseRequestOptions {
  /**
   * The API reads the refresh token only from the `LH_refresh` cookie. In a
   * browser, leave this unset and create the client with
   * `credentials: 'include'`. Outside a browser (Node, React Native), pass the
   * stored refresh token and it is sent as that cookie.
   */
  refreshToken?: string
}

export function createAuthResource(http: HttpCore) {
  return {
    /**
     * Email + password sign-in. Returns `{ mfa_required: true, mfa_token }`
     * when the account has a second factor; finish with `loginMfa()`.
     * `POST /api/v1/auth/login` (form-encoded)
     */
    login(input: LoginInput, options?: BaseRequestOptions): Promise<LoginResult> {
      return http.POST('/api/v1/auth/login', {
        ...options,
        skipAuth: true,
        bodyType: 'form',
        body: { username: input.email, password: input.password, org_slug: input.orgSlug ?? null },
      }) as Promise<LoginResult>
    },
    /** `POST /api/v1/auth/login/mfa` */
    loginMfa(
      input: { mfaToken: string; code: string; isBackupCode?: boolean },
      options?: BaseRequestOptions,
    ): Promise<LoginSuccess & { backup_codes_remaining?: number }> {
      return http.POST('/api/v1/auth/login/mfa', {
        ...options,
        skipAuth: true,
        body: { mfa_token: input.mfaToken, code: input.code, is_backup_code: input.isBackupCode ?? false },
      }) as Promise<LoginSuccess & { backup_codes_remaining?: number }>
    },
    /**
     * Rotate the session: returns a new access token and a new refresh token.
     * The old refresh token is single-use; store the new one.
     * `GET /api/v1/auth/refresh`
     */
    refresh(options: RefreshOptions = {}): Promise<AuthTokens> {
      const { refreshToken, headers, ...rest } = options
      const h = new Headers(headers)
      if (refreshToken) h.set('Cookie', `LH_refresh=${refreshToken}`)
      return http.GET('/api/v1/auth/refresh', {
        ...rest,
        headers: h,
        skipAuth: true,
        // A replayed refresh token revokes every session, so never retry.
        retry: false,
      }) as Promise<AuthTokens>
    },
    /**
     * Revoke every session of the current user and clear auth cookies.
     * `DELETE /api/v1/auth/logout`
     */
    logout(options?: BaseRequestOptions): Promise<{ msg: string }> {
      return http.DELETE('/api/v1/auth/logout', options) as Promise<{ msg: string }>
    },
    /**
     * Who the credentials belong to. Works for API tokens (with their org
     * scope) and user sessions; 401 when anonymous.
     * `GET /api/v1/auth/me`
     */
    me(options?: BaseRequestOptions): Promise<AuthMe> {
      return http.GET('/api/v1/auth/me', options)
    },
  }
}

export type AuthResource = ReturnType<typeof createAuthResource>
