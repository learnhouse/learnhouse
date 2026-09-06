'use client'
import { getConfig } from '@services/config/config'
import { safeHref, safeInternalPath } from '@services/security/url'

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = document.cookie.match(new RegExp('(?:^|; )' + escaped + '=([^;]*)'))
  try {
    return m ? decodeURIComponent(m[1]) : null
  } catch {
    return null
  }
}

// The configured org top-domain (e.g. "learnhouse.io"), so we can allow safe
// redirects to org subdomains while still blocking external origins.
function topDomain(): string | null {
  const t =
    getConfig('NEXT_PUBLIC_LEARNHOUSE_TOP_DOMAIN') ||
    getConfig('NEXT_PUBLIC_LEARNHOUSE_DOMAIN') ||
    readCookie('LH_top_domain') ||
    ''
  return t ? t.replace(/^\./, '').split(':')[0] : null
}

/**
 * Returns `target` only when it is SAFE to navigate to, otherwise `fallback`.
 * Safe = a relative path, or an http(s) URL on the same host or a subdomain of
 * the configured org top-domain (e.g. *.learnhouse.io). Blocks external origins,
 * protocol-relative `//evil.com`, and `javascript:`/`data:` schemes — closing
 * the open-redirect holes on attacker-supplied callbackUrl / returnOrigin.
 */
export function safeRedirectUrl(target: string | null | undefined, fallback = '/'): string {
  if (!target || typeof target !== 'string') return fallback
  const t = target.trim()
  if (safeHref(target) === '#') return fallback
  if (t.startsWith('/')) return safeInternalPath(target, fallback)
  if (typeof window === 'undefined') return fallback
  try {
    const u = new URL(t, window.location.origin)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return fallback
    if (u.username || u.password) return fallback
    if (u.origin === window.location.origin) return t
    if (window.location.protocol === 'https:' && u.protocol !== 'https:') return fallback
    const top = topDomain()
    const host = u.hostname.toLowerCase()
    if (top && u.port === window.location.port && (host === top || host.endsWith('.' + top))) return t
  } catch {
    return fallback
  }
  return fallback
}
