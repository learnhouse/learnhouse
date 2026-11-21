// document.cookie throws a SecurityError in an iframe sandboxed without
// allow-same-origin (and in some locked-down browsers). Code that runs on every
// page reads and writes cookies through these, so a blocked cookie jar behaves
// like an empty one instead of crashing the page.

/** The cookie string, or '' when there is no document or access is blocked. */
export function readDocumentCookie(): string {
  if (typeof document === 'undefined') return ''
  try {
    return document.cookie
  } catch {
    return ''
  }
}

/** Set one cookie (a full `name=value; attrs` string); a no-op when blocked. */
export function writeDocumentCookie(cookie: string): void {
  if (typeof document === 'undefined') return
  try {
    document.cookie = cookie
  } catch {
    /* blocked */
  }
}
