/**
 * Request headers the SCORM content proxy passes on to the API.
 *
 * The API decides who is asking from the session cookie or a Bearer token.
 * Without them every request reaches it as anonymous, and anything outside a
 * public, published course comes back 401, so the player loads nothing for
 * signed-in learners. Kept here so it can be tested without a server.
 */
export const FORWARDED_REQUEST_HEADERS = [
  'cookie',
  'authorization',
  'range',
  'if-none-match',
  'if-modified-since',
]

export function forwardedRequestHeaders(incoming: Headers): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const header of FORWARDED_REQUEST_HEADERS) {
    const value = incoming.get(header)
    if (value) headers[header] = value
  }
  return headers
}
