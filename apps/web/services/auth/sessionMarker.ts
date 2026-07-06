// The non-httpOnly `LH_session` marker cookie signals that a session exists (the
// real tokens stay httpOnly). It lets client code tell an EXPIRED session apart
// from an ANONYMOUS visitor: a 401 from an auth-required endpoint is expected on
// public content for anonymous users and must NOT trigger a login redirect.
export function hasSessionMarker(): boolean {
  if (typeof document === 'undefined') return false
  return document.cookie.split('; ').some((c) => c.startsWith('LH_session='))
}
