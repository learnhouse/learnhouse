// Auth replies are about one browser's session and must never be reused.
// Without a cache header a browser keeps a 410 as fresh forever, so a single
// "impersonation ended" reply bounced every later visit to that org.
export function noStore<T extends Response>(response: T): T {
  response.headers.set('Cache-Control', 'no-store')
  return response
}
