import type { HttpCore } from '../core/http'
import type { BaseRequestOptions } from '../core/types'
import type { components } from '../generated/schema'
import type {
  AuthMe,
  AuthTokens,
  LoginResult,
  LoginSuccess,
  MagicLinkResult,
  MfaDisabled,
  MfaEnabled,
  MfaSetup,
  MfaStatus,
  User,
  UserSignup,
  VerifyEmailResult,
} from '../models'

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

export interface SignupInput {
  email: string
  /** Unique across the instance. */
  username: string
  password: string
  firstName?: string
  lastName?: string
  /**
   * Join this organization (numeric id) as part of the signup. Without it,
   * the account is created on the platform with no organization.
   */
  orgId?: number
  /** An org invite code, for organizations that only take invited signups. Needs `orgId`. */
  inviteCode?: string
  /** Answers to the organization's extra signup fields, keyed by field id. */
  customFields?: Record<string, unknown>
  bio?: string
  /** Relative path the verification email should land on afterwards. */
  next?: string
}

export interface MagicLinkRequestInput {
  email: string
  /** Send the org-branded link that lands on the org's own sign-in page. */
  orgSlug?: string
  /** Relative path to land on after signing in. */
  next?: string
}

export interface VerifyEmailInput {
  /** The `token` query parameter of the verification link. */
  token: string
  /** The `user` query parameter of the verification link. */
  userUuid: string
  /** The `org` query parameter of the verification link. */
  orgUuid: string
  email?: string
}

export interface ResendVerificationInput {
  email: string
  orgId?: number
  next?: string
}

export interface PasswordResetRequestInput {
  email: string
  /**
   * The organization whose reset email and code to use. Leave it out for
   * accounts that sign in on the platform itself (no organization).
   */
  orgId?: number
  /** Platform resets only: relative path to land on afterwards. */
  next?: string
}

export interface PasswordResetInput {
  email: string
  /** The code from the reset email. */
  code: string
  newPassword: string
  /** Same `orgId` as the request, when it had one. */
  orgId?: number
}

export interface OAuthLoginInput {
  /** Only `google` is accepted by the API today. */
  provider: 'google'
  email: string
  /** The provider's OAuth access token for that email. */
  accessToken: string
  /** Sign in to (or join) this organization. */
  orgId?: number
  inviteCode?: string
}

type UserCreate = components['schemas']['UserCreate']

function signupBody(input: SignupInput): UserCreate {
  const body: UserCreate = {
    email: input.email,
    username: input.username,
    password: input.password,
  }
  if (input.firstName !== undefined) body.first_name = input.firstName
  if (input.lastName !== undefined) body.last_name = input.lastName
  if (input.bio !== undefined) body.bio = input.bio
  if (input.customFields !== undefined) body.custom_fields = input.customFields
  return body
}

export function createAuthResource(http: HttpCore) {
  // The account-security routes never take a bearer token the caller didn't
  // mean for them; anonymous ones skip it so a stale token can't 401 them.
  const anon = { skipAuth: true } as const

  return {
    /**
     * Email + password sign-in. Returns `{ mfa_required: true, mfa_token }`
     * when the account has a second factor; finish with `loginMfa()`.
     * `POST /api/v1/auth/login` (form-encoded)
     */
    login(input: LoginInput, options?: BaseRequestOptions): Promise<LoginResult> {
      return http.POST('/api/v1/auth/login', {
        ...options,
        ...anon,
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
        ...anon,
        body: { mfa_token: input.mfaToken, code: input.code, is_backup_code: input.isBackupCode ?? false },
      }) as Promise<LoginSuccess & { backup_codes_remaining?: number }>
    },
    /**
     * Sign in with a Google access token obtained by your app. Returns the
     * same shape as `login()`, including the two-factor challenge.
     * `POST /api/v1/auth/oauth`
     */
    loginWithOAuth(input: OAuthLoginInput, options?: BaseRequestOptions): Promise<LoginResult> {
      return http.POST('/api/v1/auth/oauth', {
        ...options,
        ...anon,
        params: { query: { org_id: input.orgId, invite_code: input.inviteCode } },
        body: { email: input.email, provider: input.provider, access_token: input.accessToken },
      }) as Promise<LoginResult>
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
    /**
     * Create an account. With `orgId` it also joins that organization (and
     * `inviteCode` redeems an invite); without, it is a platform account.
     * Signing up does not sign in: depending on the instance, the address may
     * have to be verified first (see `verifyEmail()`), then call `login()`.
     *
     * `POST /api/v1/users/{org_id}`, `POST /api/v1/users/{org_id}/invite/{invite_code}`
     * or `POST /api/v1/users/`
     */
    signup(input: SignupInput, options?: BaseRequestOptions): Promise<UserSignup | User> {
      const body = signupBody(input)
      const query = { next: input.next }
      if (input.inviteCode !== undefined) {
        if (input.orgId === undefined) {
          return Promise.reject(new TypeError('auth.signup: `inviteCode` needs `orgId`'))
        }
        return http.POST('/api/v1/users/{org_id}/invite/{invite_code}', {
          ...options,
          ...anon,
          params: { path: { org_id: input.orgId, invite_code: input.inviteCode }, query },
          body,
        })
      }
      if (input.orgId !== undefined) {
        return http.POST('/api/v1/users/{org_id}', {
          ...options,
          ...anon,
          params: { path: { org_id: input.orgId }, query },
          body,
        })
      }
      return http.POST('/api/v1/users/', { ...options, ...anon, params: { query }, body })
    },
    /**
     * Email a one-time sign-in link. Always resolves the same way whether or
     * not the account exists. Finish with `verifyMagicLink(token)`.
     * `POST /api/v1/auth/magic-link/request`
     */
    requestMagicLink(input: MagicLinkRequestInput, options?: BaseRequestOptions): Promise<{ detail: string }> {
      return http.POST('/api/v1/auth/magic-link/request', {
        ...options,
        ...anon,
        body: { email: input.email, org_slug: input.orgSlug ?? null, next: input.next ?? null },
      }) as Promise<{ detail: string }>
    },
    /**
     * Exchange the token from a magic link (emailed, or minted by
     * `admin.auth.magicLink()`) for a session. Single-use: a second call
     * answers 410.
     * `POST /api/v1/auth/magic-link/verify`
     */
    verifyMagicLink(token: string, options?: BaseRequestOptions): Promise<MagicLinkResult> {
      return http.POST('/api/v1/auth/magic-link/verify', {
        ...options,
        ...anon,
        body: { token },
      }) as Promise<MagicLinkResult>
    },
    /**
     * Confirm an email address with the values of the verification link.
     * When the account allows it, this also signs the user in (`tokens`).
     * `POST /api/v1/auth/verify-email`
     */
    verifyEmail(input: VerifyEmailInput, options?: BaseRequestOptions): Promise<VerifyEmailResult> {
      return http.POST('/api/v1/auth/verify-email', {
        ...options,
        ...anon,
        body: { token: input.token, user_uuid: input.userUuid, org_uuid: input.orgUuid, email: input.email ?? null },
      }) as Promise<VerifyEmailResult>
    },
    /** `POST /api/v1/auth/resend-verification`. Same answer whether or not the account exists. */
    resendVerification(input: ResendVerificationInput, options?: BaseRequestOptions): Promise<{ message: string }> {
      return http.POST('/api/v1/auth/resend-verification', {
        ...options,
        ...anon,
        body: { email: input.email, org_id: input.orgId ?? null, next: input.next ?? null },
      }) as Promise<{ message: string }>
    },
    /**
     * Email a password reset code.
     * `POST /api/v1/users/reset_password/send_reset_code` (with `orgId`) or
     * `POST /api/v1/users/reset_password/platform/send_reset_code`
     */
    requestPasswordReset(input: PasswordResetRequestInput, options?: BaseRequestOptions): Promise<unknown> {
      if (input.orgId !== undefined) {
        return http.POST('/api/v1/users/reset_password/send_reset_code', {
          ...options,
          ...anon,
          body: { email: input.email, org_id: input.orgId },
        })
      }
      return http.POST('/api/v1/users/reset_password/platform/send_reset_code', {
        ...options,
        ...anon,
        body: { email: input.email, next: input.next ?? null },
      })
    },
    /**
     * Set a new password with the emailed code. Signs out every session.
     * `POST /api/v1/users/reset_password/change_password` (with `orgId`) or
     * `POST /api/v1/users/reset_password/platform/change_password`
     */
    resetPassword(input: PasswordResetInput, options?: BaseRequestOptions): Promise<unknown> {
      if (input.orgId !== undefined) {
        return http.POST('/api/v1/users/reset_password/change_password', {
          ...options,
          ...anon,
          body: { email: input.email, reset_code: input.code, new_password: input.newPassword, org_id: input.orgId },
        })
      }
      return http.POST('/api/v1/users/reset_password/platform/change_password', {
        ...options,
        ...anon,
        body: { email: input.email, reset_code: input.code, new_password: input.newPassword },
      })
    },
    /**
     * Two-factor (TOTP) for the signed-in account. Needs a real sign-in:
     * API tokens and embed sessions are refused.
     */
    mfa: {
      /** `GET /api/v1/auth/mfa/status` */
      status(options?: BaseRequestOptions): Promise<MfaStatus> {
        return http.GET('/api/v1/auth/mfa/status', options) as Promise<MfaStatus>
      },
      /**
       * Start enrollment. Pass the account password when it has one. Show
       * `provisioning_uri` as a QR code, then call `confirm()` with a code.
       * `POST /api/v1/auth/mfa/setup`
       */
      setup(input: { password?: string } = {}, options?: BaseRequestOptions): Promise<MfaSetup> {
        return http.POST('/api/v1/auth/mfa/setup', {
          ...options,
          body: { password: input.password ?? null },
        }) as Promise<MfaSetup>
      },
      /**
       * Turn two-factor on with the first code. Signs out other sessions and
       * returns new tokens for this one, plus single-use backup codes.
       * `POST /api/v1/auth/mfa/confirm`
       */
      confirm(code: string, options?: BaseRequestOptions): Promise<MfaEnabled> {
        return http.POST('/api/v1/auth/mfa/confirm', { ...options, body: { code } }) as Promise<MfaEnabled>
      },
      /** `POST /api/v1/auth/mfa/disable`. Signs out other sessions; returns new tokens. */
      disable(input: { code: string; password?: string }, options?: BaseRequestOptions): Promise<MfaDisabled> {
        return http.POST('/api/v1/auth/mfa/disable', {
          ...options,
          body: { code: input.code, password: input.password ?? null },
        }) as Promise<MfaDisabled>
      },
      /** Replace every backup code. `POST /api/v1/auth/mfa/backup-codes/regenerate` */
      regenerateBackupCodes(code: string, options?: BaseRequestOptions): Promise<{ backup_codes: string[] }> {
        return http.POST('/api/v1/auth/mfa/backup-codes/regenerate', {
          ...options,
          body: { code },
        }) as Promise<{ backup_codes: string[] }>
      },
    },
  }
}

export type AuthResource = ReturnType<typeof createAuthResource>
