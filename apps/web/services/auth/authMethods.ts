/**
 * Which sign-in methods an organization accepts.
 *
 * Mirrors `allowed_auth_methods` in src/services/orgs/auth_policy.py, including
 * its two "unrestricted" cases: an absent list and an empty one. The empty case
 * matters — a mis-saved policy must not render a login page with no way in.
 *
 * The backend refuses a disallowed sign-in at /auth/login, /auth/oauth and the
 * magic-link endpoints; this module only decides what the login page bothers to
 * render. It is a convenience, never the enforcement.
 */

export const ALL_AUTH_METHODS = ['password', 'magic_login', 'google', 'sso'] as const

export type AuthMethod = (typeof ALL_AUTH_METHODS)[number]

/**
 * The methods this org allows, read from the public org config.
 *
 * `org` is the payload of GET /orgs/slug/{slug}. On the org-less apex there is
 * no org, so nothing is restricted.
 */
export function getAllowedAuthMethods(org: any): Set<AuthMethod> {
  const configured = org?.config?.config?.admin_toggles?.security?.allowed_auth_methods

  if (!Array.isArray(configured)) return new Set(ALL_AUTH_METHODS)

  const allowed = ALL_AUTH_METHODS.filter((m) => configured.includes(m))

  // Empty (or entirely unrecognised) list = unrestricted, matching the backend.
  return allowed.length === 0 ? new Set(ALL_AUTH_METHODS) : new Set(allowed)
}

export function isAuthMethodAllowed(org: any, method: AuthMethod): boolean {
  return getAllowedAuthMethods(org).has(method)
}
