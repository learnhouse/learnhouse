/**
 * Request headers the SCORM content proxy passes on to the API.
 *
 * Content is authorized by the launch token in the URL, never by session:
 * package code runs sandboxed, and the API must not see the viewer's cookie or
 * bearer token on a request a package can trigger. Only range and cache
 * validators pass through. Kept here so it can be tested without a server.
 */
export const FORWARDED_REQUEST_HEADERS = [
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
