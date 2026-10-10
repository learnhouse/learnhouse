// Query params that carry credentials or PII in auth links (reset codes, magic
// / verify tokens, OAuth + exchange codes, MFA tokens, emails). They must never
// reach analytics or error reporting: a leaked reset code is an account takeover.
export const SENSITIVE_QUERY_PARAMS = new Set(
  [
    'resetCode',
    'reset_code',
    'token',
    'code',
    'state',
    'mfa_token',
    'email',
    'user',
    'inviteCode',
    'invite_code',
    'magic',
    'exchange_code',
    'access_token',
    'refresh_token',
    'id_token',
  ].map((p) => p.toLowerCase())
)

const REDACTED = '[redacted]'

/** Redacts sensitive values in a raw query string (with or without leading `?`). */
export function scrubQueryString(qs: string): string {
  const hasQ = qs.startsWith('?')
  const raw = hasQ ? qs.slice(1) : qs
  if (!raw) return qs
  const out = raw
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=')
      const rawKey = eq === -1 ? pair : pair.slice(0, eq)
      let key = rawKey
      try {
        key = decodeURIComponent(rawKey.replace(/\+/g, ' '))
      } catch {
        /* keep raw key */
      }
      return SENSITIVE_QUERY_PARAMS.has(key.toLowerCase()) ? `${rawKey}=${REDACTED}` : pair
    })
    .join('&')
  return hasQ ? `?${out}` : out
}

/** Redacts sensitive query values in an absolute or relative URL string. */
export function scrubUrl(url: string): string {
  if (typeof url !== 'string') return url
  const q = url.indexOf('?')
  if (q === -1) return url
  const hash = url.indexOf('#', q)
  const query = hash === -1 ? url.slice(q) : url.slice(q, hash)
  const rest = hash === -1 ? '' : url.slice(hash)
  return url.slice(0, q) + scrubQueryString(query) + rest
}

/** Shallow-scrubs every string value of a properties object that looks like a URL. */
export function scrubUrlProperties<T extends Record<string, any> | undefined | null>(props: T): T {
  if (!props) return props
  for (const k of Object.keys(props)) {
    const v = props[k]
    if (typeof v === 'string' && v.includes('?')) {
      ;(props as Record<string, any>)[k] = scrubUrl(v)
    }
  }
  return props
}

function scrubBreadcrumbData(data: Record<string, any> | undefined) {
  if (!data) return
  for (const k of ['url', 'to', 'from']) {
    if (typeof data[k] === 'string') data[k] = scrubUrl(data[k])
  }
}

/** Sentry breadcrumb hook: scrub navigation/fetch/xhr URLs as they're recorded. */
export function scrubSentryBreadcrumb<B extends { data?: Record<string, any> } | null>(crumb: B): B {
  if (crumb) scrubBreadcrumbData(crumb.data)
  return crumb
}

/** Scrubs request URL, query string, Referer and breadcrumb URLs of a Sentry event. */
export function scrubSentryEvent<E extends Record<string, any> | null>(event: E): E {
  if (!event) return event
  const req = event.request
  if (req) {
    if (typeof req.url === 'string') req.url = scrubUrl(req.url)
    const qs = req.query_string
    if (typeof qs === 'string') {
      req.query_string = scrubQueryString(qs)
    } else if (Array.isArray(qs)) {
      req.query_string = qs.map((pair: unknown) =>
        Array.isArray(pair) && SENSITIVE_QUERY_PARAMS.has(String(pair[0]).toLowerCase())
          ? [pair[0], REDACTED]
          : pair
      )
    } else if (qs && typeof qs === 'object') {
      for (const k of Object.keys(qs)) {
        if (SENSITIVE_QUERY_PARAMS.has(k.toLowerCase())) qs[k] = REDACTED
      }
    }
    if (req.headers) {
      for (const h of Object.keys(req.headers)) {
        if (h.toLowerCase() === 'referer' && typeof req.headers[h] === 'string') {
          req.headers[h] = scrubUrl(req.headers[h])
        }
      }
    }
  }
  if (Array.isArray(event.breadcrumbs)) {
    for (const crumb of event.breadcrumbs) scrubBreadcrumbData(crumb?.data)
  }
  return event
}

/** Drops secret query params from the address bar (keeps Next's history state). */
export function removeQueryParamsFromAddressBar(names: string[]): void {
  if (typeof window === 'undefined') return
  try {
    const u = new URL(window.location.href)
    let changed = false
    for (const n of names) {
      if (u.searchParams.has(n)) {
        u.searchParams.delete(n)
        changed = true
      }
    }
    if (changed) window.history.replaceState(window.history.state, '', u.pathname + u.search + u.hash)
  } catch {
    /* best-effort */
  }
}
