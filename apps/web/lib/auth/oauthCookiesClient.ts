'use client'
import { getLEARNHOUSE_TOP_DOMAIN_VAL, isOnCustomDomain } from '@services/config/config'
import { oauthContextCookieWrites, oauthCookieClears, type OAuthContext, type OAuthCookieEnv } from './oauthCookies'

function cookieEnv(): OAuthCookieEnv {
  const top = getLEARNHOUSE_TOP_DOMAIN_VAL()
  return {
    secure: window.location.protocol === 'https:',
    // Host-only on custom domains: a `.{platformTopDomain}` cookie can't be set
    // from learn.acme.org, so the browser would drop it.
    domain: !top || top === 'localhost' || isOnCustomDomain() ? null : top,
  }
}

/** Set the org context for a Google sign-in, clearing any left from before. */
export function setOAuthContextCookies(ctx: OAuthContext): void {
  try {
    for (const c of oauthContextCookieWrites(ctx, cookieEnv())) document.cookie = c
  } catch {
    /* cookies off: the sign-in goes ahead without org context */
  }
}

/** Drop every LH_oauth_* context cookie (best effort). */
export function clearOAuthContextCookies(): void {
  try {
    for (const c of oauthCookieClears(cookieEnv())) document.cookie = c
  } catch {
    /* best effort */
  }
}
