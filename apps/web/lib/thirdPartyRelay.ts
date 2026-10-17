// Same-origin relays to third parties: PostHog (/ingest, next.config rewrite)
// and the Sentry tunnel (/monitoring, added by withSentryConfig). Both are
// external rewrites, and Next forwards the browser's request headers to the
// destination as-is, session cookies (LH_access / LH_refresh) included. The
// proxy strips credentials from these paths before the rewrite runs.

const RELAY_PATH = /^\/(ingest|monitoring)(\/|$)/

/** Request headers that carry the user's credentials and must not leave us. */
const CREDENTIAL_HEADERS = ['cookie', 'authorization']

export function isThirdPartyRelayPath(pathname: string): boolean {
  return RELAY_PATH.test(pathname)
}

/** A copy of `headers` without cookies or authorization. */
export function withoutCredentialHeaders(headers: Headers): Headers {
  const stripped = new Headers(headers)
  for (const name of CREDENTIAL_HEADERS) stripped.delete(name)
  return stripped
}
