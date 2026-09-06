/**
 * Compression decisions for the SCORM content proxy.
 *
 * The proxy exists so SCORM assets are same-origin with the player, which means
 * every file in a package — often hundreds of them — crosses this hop. Getting
 * the encoding wrong here does not fail loudly in one place; it either inflates
 * the whole package on the slowest leg of the path, or hands the browser bytes
 * that contradict their headers. Both decisions live here so they can be tested
 * without a server.
 */

/**
 * Whether `fetch` decompressed the upstream body underneath us.
 *
 * The API gzips every response over 1000 bytes and undici transparently decodes
 * it, while leaving the upstream (compressed) `content-length` on the response.
 * Forwarding that length alongside the decoded body tells the browser to stop
 * reading early and truncates every asset large enough to have been gzipped.
 */
export function bodyWasDecoded(response: Response): boolean {
  const encoding = response.headers.get('content-encoding')?.trim().toLowerCase()
  return !!encoding && encoding !== 'identity'
}

/**
 * Whether the client asked for gzip and did not then weight it away.
 *
 * `accept-encoding: gzip;q=0` is a refusal, not a request, so matching the token
 * alone is not enough. A `*` covers gzip unless gzip is refused by name.
 */
export function acceptsGzip(header: string | null | undefined): boolean {
  if (!header) return false

  let wildcard = false
  for (const entry of header.split(',')) {
    const [rawToken, ...params] = entry.split(';')
    const token = rawToken.trim().toLowerCase()
    if (token !== 'gzip' && token !== '*') continue

    const quality = params
      .map((param) => param.trim().toLowerCase())
      .find((param) => param.startsWith('q='))
    const accepted = !quality || Number(quality.slice(2)) > 0

    if (token === 'gzip') return accepted
    wildcard = accepted
  }

  return wildcard
}

/**
 * Whether this response can be handed back to the browser gzipped.
 *
 * When the API compresses a response there is no way to keep the compression
 * across this hop: undici decodes even when the outgoing request carries an
 * explicit `accept-encoding: gzip`, while still reporting `content-encoding:
 * gzip` on the response — so forwarding that header would ship gzip-labelled
 * plaintext and every text asset would fail with ERR_CONTENT_DECODING_FAILED.
 * Next does not compress App Router route-handler streams either. Re-compressing
 * here is what keeps the package from crossing the last mile as raw bytes.
 *
 * Only full responses qualify. A 206 body is a slice the browser asked for by
 * byte offset and its `content-range` describes the identity bytes, so
 * compressing it would contradict the header.
 */
export function canRecompress(
  response: Response,
  acceptEncoding: string | null | undefined
): boolean {
  if (!bodyWasDecoded(response)) return false
  if (response.status !== 200) return false
  if (typeof CompressionStream === 'undefined') return false
  return acceptsGzip(acceptEncoding)
}
