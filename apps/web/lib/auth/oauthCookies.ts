// The org context a Google sign-in carries to the OAuth callback, kept in
// LH_oauth_* cookies (the callback runs on the platform domain, or on the custom
// domain it bounces back to). Pure helpers, unit-tested in
// tests/invite-join-flow.test.mjs; the DOM side is in oauthCookiesClient.ts.

export const OAUTH_CONTEXT_COOKIES = ['LH_oauth_org_id', 'LH_oauth_orgslug', 'LH_oauth_invite_code', 'LH_oauth_invite_token'] as const

export type OAuthContext = {
  orgSlug?: string | null
  orgId?: number | string | null
  /** Invite-only org: the invite code from the join link. */
  inviteCode?: string | null
  /** Personal invitation link (`/signup?invite=`): accepted by the sign-in itself. */
  inviteToken?: string | null
}

export type OAuthCookieEnv = {
  secure: boolean
  /** Platform top domain for subdomain-wide cookies; null for host-only (custom domains, localhost). */
  domain: string | null
}

const ATTRS = (env: OAuthCookieEnv) => `; path=/; SameSite=Lax${env.secure ? '; secure' : ''}${env.domain ? `; domain=.${env.domain}` : ''}`

/** Expire every LH_oauth_* context cookie, host-only and domain-wide. */
export function oauthCookieClears(env: OAuthCookieEnv): string[] {
  const out: string[] = []
  for (const name of OAUTH_CONTEXT_COOKIES) {
    out.push(`${name}=; path=/; max-age=0`)
    if (env.domain) out.push(`${name}=; path=/; max-age=0; domain=.${env.domain}`)
  }
  return out
}

/**
 * Cookie writes for a Google sign-in: everything left over from an earlier
 * attempt is cleared first, so an org or invite from another tab never rides
 * along. Nothing is set without an org.
 */
export function oauthContextCookieWrites(ctx: OAuthContext, env: OAuthCookieEnv): string[] {
  const out = oauthCookieClears(env)
  if (!ctx.orgSlug && !ctx.orgId) return out
  const attrs = ATTRS(env)
  if (ctx.orgSlug) out.push(`LH_oauth_orgslug=${encodeURIComponent(ctx.orgSlug)}${attrs}`)
  if (ctx.orgId) out.push(`LH_oauth_org_id=${encodeURIComponent(String(ctx.orgId))}${attrs}`)
  if (ctx.inviteCode) out.push(`LH_oauth_invite_code=${encodeURIComponent(ctx.inviteCode)}${attrs}`)
  if (ctx.inviteToken) out.push(`LH_oauth_invite_token=${encodeURIComponent(ctx.inviteToken)}${attrs}`)
  return out
}

/** The context cookies from a `document.cookie` string. */
export function readOAuthContextCookies(cookieString: string): {
  orgId?: number
  orgSlug?: string
  inviteCode?: string
  inviteToken?: string
} {
  const out: { orgId?: number; orgSlug?: string; inviteCode?: string; inviteToken?: string } = {}
  for (const part of (cookieString || '').split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const name = part.slice(0, eq).trim()
    let value = part.slice(eq + 1).trim()
    if (!value) continue
    try {
      value = decodeURIComponent(value)
    } catch {
      continue
    }
    if (name === 'LH_oauth_org_id') {
      const id = parseInt(value, 10)
      if (!isNaN(id)) out.orgId = id
    } else if (name === 'LH_oauth_orgslug') out.orgSlug = value
    else if (name === 'LH_oauth_invite_code') out.inviteCode = value
    else if (name === 'LH_oauth_invite_token') out.inviteToken = value
  }
  return out
}
