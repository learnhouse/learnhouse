export type LearnHouseErrorCode =
  /** The server answered with a non-2xx status. `detail.code` wins when the API sends one. */
  | 'HTTP_ERROR'
  /** fetch() rejected before a response arrived (DNS, TLS, connection reset, CORS, ...). */
  | 'NETWORK_ERROR'
  /** The request exceeded `timeoutMs`. */
  | 'TIMEOUT'
  /** The response claimed JSON but could not be parsed. */
  | 'PARSE_ERROR'
  // Server-provided codes (e.g. RATE_LIMITED, INVALID_CREDENTIALS) pass through as-is.
  | (string & {})

export interface LearnHouseErrorInit {
  status: number
  method: string
  path: string
  url: string
  detail?: unknown
  code?: LearnHouseErrorCode
  body?: unknown
  cause?: unknown
  message?: string
}

/**
 * Every failure the client produces (HTTP error, network error, timeout) is a
 * LearnHouseError. A request cancelled through the caller's own `signal`
 * rejects with the platform's AbortError instead, like fetch() does.
 */
export class LearnHouseError extends Error {
  /** HTTP status, or 0 when no response was received. */
  readonly status: number
  /** FastAPI's `detail` field: a string, an object like `{ code, message }`, or a validation error list. */
  readonly detail: unknown
  readonly code: LearnHouseErrorCode
  readonly method: string
  /** The path template or path that was requested, e.g. `/api/v1/courses/{course_uuid}`. */
  readonly path: string
  readonly url: string
  /** The parsed response body, when there was one. */
  readonly body: unknown
  readonly cause: unknown

  constructor(init: LearnHouseErrorInit) {
    super(init.message ?? messageFromDetail(init.detail, init.status))
    // Keep instanceof working when compiled down or used across bundles.
    Object.setPrototypeOf(this, new.target.prototype)
    this.name = 'LearnHouseError'
    this.status = init.status
    this.detail = init.detail
    this.code = init.code ?? codeFromDetail(init.detail) ?? (init.status ? 'HTTP_ERROR' : 'NETWORK_ERROR')
    this.method = init.method
    this.path = init.path
    this.url = init.url
    this.body = init.body
    this.cause = init.cause
  }
}

/** Works across realms and duplicated copies of the package, where instanceof does not. */
export function isLearnHouseError(err: unknown): err is LearnHouseError {
  return (
    err instanceof LearnHouseError ||
    (typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'LearnHouseError')
  )
}

function codeFromDetail(detail: unknown): string | undefined {
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    const code = (detail as { code?: unknown }).code
    if (typeof code === 'string' && code) return code
  }
  if (Array.isArray(detail)) return 'VALIDATION_ERROR'
  return undefined
}

function messageFromDetail(detail: unknown, status: number): string {
  if (typeof detail === 'string' && detail) return detail
  if (Array.isArray(detail)) {
    // FastAPI 422: [{ loc: ['query', 'limit'], msg: '...', type: '...' }]
    const parts = detail
      .map((d) => {
        if (!d || typeof d !== 'object') return String(d)
        const { loc, msg } = d as { loc?: unknown; msg?: unknown }
        const where = Array.isArray(loc) ? loc.join('.') : ''
        return where ? `${where}: ${String(msg)}` : String(msg)
      })
      .filter(Boolean)
    if (parts.length) return parts.join('; ')
  }
  if (detail && typeof detail === 'object') {
    const msg = (detail as { message?: unknown }).message
    if (typeof msg === 'string' && msg) return msg
  }
  return status ? `Request failed with status ${status}` : 'Request failed'
}
