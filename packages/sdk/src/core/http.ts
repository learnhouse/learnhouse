import { LearnHouseError } from '../errors'
import type {
  BaseRequestOptions,
  HttpMethod,
  OptionsArg,
  Operation,
  OperationResponse,
  ParseAs,
  PathsWithMethod,
  RetryOptions,
  UntypedRequestOptions,
} from './types'

export interface RequestContext {
  method: string
  /** Path template as passed by the caller, e.g. `/api/v1/courses/{course_uuid}`. */
  path: string
  /** Fully resolved URL. Hooks may replace it. */
  url: string
  /** The init handed to fetch. Hooks may mutate `headers` or replace fields. */
  init: RequestInit & { headers: Headers }
  /** 0 for the first try, 1+ for retries. */
  attempt: number
}

export interface ResponseContext extends RequestContext {
  response: Response
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface CoreOptions {
  /** API origin, e.g. `https://api.example.com` (no `/api/v1`). */
  baseUrl: string
  /** Static bearer token: an org API token (`lh_...`) or a user access token. */
  token?: string
  /** Called before each request; return a user access token or null for anonymous. */
  getToken?: () => string | null | undefined | Promise<string | null | undefined>
  /** Forwarded to fetch. Use `'include'` for browser cookie sessions. Unset by default. */
  credentials?: RequestCredentials
  /** Custom fetch implementation. Defaults to the global fetch at call time. */
  fetch?: FetchLike
  /** Headers sent with every request. */
  headers?: HeadersInit
  /** Per-attempt timeout in ms, covering the response body too. Default 30000; 0 disables. */
  timeoutMs?: number
  /**
   * Retry policy: GET/HEAD on network errors, timeouts and 5xx, plus any method
   * on 429. Honours `Retry-After`. Default 2 retries; false disables.
   */
  retry?: RetryOptions | number | false
  onRequest?: (ctx: RequestContext) => void | Promise<void>
  onResponse?: (ctx: ResponseContext) => void | Promise<void>
}

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_RETRY: Required<RetryOptions> = { retries: 2, baseDelayMs: 300, maxDelayMs: 5_000 }

export type TypedMethod<M extends HttpMethod> = <P extends PathsWithMethod<M>>(
  path: P,
  ...options: OptionsArg<Operation<P, M>>
) => Promise<OperationResponse<Operation<P, M>>>

export interface HttpCore {
  GET: TypedMethod<'get'>
  POST: TypedMethod<'post'>
  PUT: TypedMethod<'put'>
  PATCH: TypedMethod<'patch'>
  DELETE: TypedMethod<'delete'>
  /** Untyped escape hatch for routes missing from the generated schema (e.g. EE-only routes). */
  request<T = unknown>(method: string, path: string, options?: UntypedRequestOptions): Promise<T>
}

// ---------------------------------------------------------------------------
// Serialization. Built by hand rather than with URL/URLSearchParams: React
// Native's URL polyfill leaves much of that API unimplemented.

function enc(v: string): string {
  return encodeURIComponent(v)
}

function encodePathSegment(value: string): string {
  const e = enc(value)
  // "." and ".." survive encodeURIComponent and would be collapsed by URL
  // normalization, letting a parameter escape its path segment.
  return e === '.' || e === '..' ? e.replace(/\./g, '%2E') : e
}

export function buildPath(template: string, pathParams?: Record<string, unknown>): string {
  return template.replace(/\{([^}]+)\}/g, (_m, name: string) => {
    const v = pathParams?.[name]
    if (v === undefined || v === null || v === '') {
      throw new TypeError(`Missing path parameter "${name}" for ${template}`)
    }
    return encodePathSegment(String(v))
  })
}

function scalar(v: unknown): string {
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** FastAPI style: arrays repeat the key, null/undefined are dropped. */
export function serializeQuery(query?: Record<string, unknown> | null): string {
  if (!query) return ''
  const parts: string[] = []
  for (const key of Object.keys(query)) {
    const raw = query[key]
    const values = Array.isArray(raw) ? raw : [raw]
    for (const v of values) {
      if (v === undefined || v === null) continue
      parts.push(`${enc(key)}=${enc(scalar(v))}`)
    }
  }
  return parts.join('&')
}

export function joinUrl(baseUrl: string, path: string, query: string): string {
  const base = baseUrl.replace(/\/+$/, '')
  const p = path.charAt(0) === '/' ? path : `/${path}`
  return query ? `${base}${p}?${query}` : `${base}${p}`
}

function isRawBody(body: unknown): boolean {
  return (
    typeof body === 'string' ||
    (typeof FormData !== 'undefined' && body instanceof FormData) ||
    (typeof Blob !== 'undefined' && body instanceof Blob) ||
    (typeof ArrayBuffer !== 'undefined' && (body instanceof ArrayBuffer || ArrayBuffer.isView(body))) ||
    (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) ||
    (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream)
  )
}

function mergeHeaders(target: Headers, init?: HeadersInit): void {
  if (!init) return
  if (Array.isArray(init)) {
    for (const [k, v] of init) target.set(k, v)
  } else if (typeof Headers !== 'undefined' && init instanceof Headers) {
    init.forEach((v, k) => target.set(k, v))
  } else {
    const rec = init as Record<string, string | undefined>
    for (const k of Object.keys(rec)) {
      const v = rec[k]
      if (v !== undefined) target.set(k, v)
    }
  }
}

// ---------------------------------------------------------------------------
// Abort / timing helpers

function makeAbortError(): Error {
  // DOMException is missing on Hermes.
  if (typeof DOMException !== 'undefined') {
    return new DOMException('The operation was aborted.', 'AbortError')
  }
  const err = new Error('The operation was aborted.')
  err.name = 'AbortError'
  return err
}

export function abortReason(signal: AbortSignal): unknown {
  const reason = (signal as { reason?: unknown }).reason
  return reason !== undefined ? reason : makeAbortError()
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortReason(signal))
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortReason(signal as AbortSignal))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort)
  })
}

function resolveRetry(r: RetryOptions | number | false | undefined): Required<RetryOptions> {
  if (r === false) return { ...DEFAULT_RETRY, retries: 0 }
  if (typeof r === 'number') return { ...DEFAULT_RETRY, retries: Math.max(0, r) }
  return { ...DEFAULT_RETRY, ...(r ?? {}) }
}

function backoffDelay(attempt: number, r: Required<RetryOptions>): number {
  const exp = Math.min(r.maxDelayMs, r.baseDelayMs * 2 ** attempt)
  return Math.round(exp * (0.5 + Math.random() * 0.5))
}

/** `Retry-After` as delay-seconds or an HTTP date, in ms from `now`. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined
  const v = value.trim()
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 1000)
  const at = Date.parse(v)
  return Number.isNaN(at) ? undefined : Math.max(0, at - now)
}

// Some API limiters send the delay only as `detail.retry_after` (seconds).
function retryAfterFromDetail(detail: unknown): number | undefined {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return undefined
  const s = (detail as { retry_after?: unknown }).retry_after
  return typeof s === 'number' && s >= 0 ? Math.round(s * 1000) : undefined
}

// ---------------------------------------------------------------------------
// Response handling

async function readError(res: Response, method: string, path: string, url: string): Promise<LearnHouseError> {
  let text = ''
  try {
    text = await res.text()
  } catch {
    // body unreadable; report the status alone
  }
  let body: unknown = text || undefined
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      // not JSON, keep the text
    }
  }
  const detail =
    body && typeof body === 'object' && !Array.isArray(body) && 'detail' in body
      ? (body as { detail: unknown }).detail
      : body
  const retryAfterMs = parseRetryAfter(res.headers.get('retry-after')) ?? retryAfterFromDetail(detail)
  return new LearnHouseError({ status: res.status, detail, body, method, path, url, retryAfterMs })
}

async function readBody(res: Response, parseAs: ParseAs, method: string, path: string, url: string): Promise<unknown> {
  switch (parseAs) {
    case 'response':
      return res
    case 'stream':
      return res.body
    case 'blob':
      return res.blob()
    case 'arrayBuffer':
      return res.arrayBuffer()
    case 'text':
      return res.text()
    default:
      break
  }
  if (res.status === 204 || res.status === 205 || method === 'HEAD') return undefined
  const type = res.headers.get('content-type') ?? ''
  const text = await res.text()
  if (parseAs === 'auto' && !/[/+]json\b/i.test(type)) return text
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch (cause) {
    throw new LearnHouseError({
      status: res.status,
      code: 'PARSE_ERROR',
      message: 'Response body is not valid JSON',
      body: text,
      method,
      path,
      url,
      cause,
    })
  }
}

class RetryableStatus {
  constructor(readonly error: LearnHouseError) {}
}

// ---------------------------------------------------------------------------

export function createHttpCore(options: CoreOptions): HttpCore {
  if (!options || typeof options.baseUrl !== 'string' || !options.baseUrl) {
    throw new TypeError('createClient: `baseUrl` is required')
  }

  async function request(method: string, pathTemplate: string, opts: UntypedRequestOptions = {}): Promise<unknown> {
    const M = method.toUpperCase()
    const path = buildPath(pathTemplate, opts.params?.path)
    const url = joinUrl(options.baseUrl, path, serializeQuery(opts.params?.query))

    const headers = new Headers()
    mergeHeaders(headers, options.headers)
    if (!headers.has('accept')) headers.set('Accept', 'application/json')
    mergeHeaders(headers, opts.headers)

    if (!opts.skipAuth && !headers.has('authorization')) {
      let token: string | null | undefined = options.token
      if (!token && options.getToken) token = await options.getToken()
      if (token) headers.set('Authorization', `Bearer ${token}`)
    }

    let body: BodyInit | undefined
    if (opts.body !== undefined && opts.body !== null) {
      if (isRawBody(opts.body)) {
        body = opts.body as BodyInit
      } else if (opts.bodyType === 'form') {
        body = serializeQuery(opts.body as Record<string, unknown>)
        if (!headers.has('content-type')) headers.set('Content-Type', 'application/x-www-form-urlencoded')
      } else {
        body = JSON.stringify(opts.body)
        if (!headers.has('content-type')) headers.set('Content-Type', 'application/json')
      }
    }

    const retry = resolveRetry(opts.retry !== undefined ? opts.retry : options.retry)
    const idempotent = M === 'GET' || M === 'HEAD'
    // A stream body is consumed by the first attempt and cannot be sent again.
    const replayable = !(typeof ReadableStream !== 'undefined' && body instanceof ReadableStream)
    const timeoutMs = opts.timeoutMs ?? options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const parseAs: ParseAs = opts.parseAs ?? 'auto'
    const signal = opts.signal

    for (let attempt = 0; ; attempt++) {
      try {
        return await attemptOnce(attempt)
      } catch (err) {
        const delay = retryDelay(err, attempt)
        if (delay !== undefined && !signal?.aborted) {
          await sleep(delay, signal)
          continue
        }
        throw err instanceof RetryableStatus ? err.error : err
      }
    }

    /** ms to wait before the next attempt, or undefined to give up. */
    function retryDelay(err: unknown, attempt: number): number | undefined {
      let error: LearnHouseError
      if (err instanceof RetryableStatus) error = err.error
      else if (err instanceof LearnHouseError && (err.code === 'NETWORK_ERROR' || err.code === 'TIMEOUT')) error = err
      else return undefined
      // A 429 was refused before the server did anything, so any method may retry it.
      const limit = error.status === 429 ? (replayable ? retry.retries : 0) : idempotent ? retry.retries : 0
      if (attempt >= limit) return undefined
      if ((error.status === 429 || error.status === 503) && error.retryAfterMs !== undefined) {
        // Retrying before the server's time only earns another refusal.
        return error.retryAfterMs <= retry.maxDelayMs ? error.retryAfterMs : undefined
      }
      return backoffDelay(attempt, retry)
    }

    async function attemptOnce(attempt: number): Promise<unknown> {
      if (signal?.aborted) throw abortReason(signal)
      const controller = new AbortController()
      let timedOut = false
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              timedOut = true
              controller.abort()
            }, timeoutMs)
          : undefined
      const onCallerAbort = () => controller.abort()
      signal?.addEventListener('abort', onCallerAbort)

      const init: RequestInit & { headers: Headers } = {
        method: M,
        headers: new Headers(headers),
        body,
        signal: controller.signal,
      }
      // Only set when asked: some runtimes (older Cloudflare Workers) throw on it.
      if (options.credentials) init.credentials = options.credentials
      const ctx: RequestContext = { method: M, path: pathTemplate, url, init, attempt }
      // For parseAs 'response' / 'stream' the caller reads the body later, so
      // the caller's signal stays wired to cancel that read.
      let detachCaller = true

      const failure = (cause: unknown): unknown => {
        if (signal?.aborted) return abortReason(signal)
        if (timedOut) {
          return new LearnHouseError({
            status: 0,
            code: 'TIMEOUT',
            message: `Request timed out after ${timeoutMs}ms`,
            method: M,
            path: pathTemplate,
            url: ctx.url,
            cause,
          })
        }
        if (cause instanceof LearnHouseError) return cause
        return new LearnHouseError({
          status: 0,
          code: 'NETWORK_ERROR',
          message: cause instanceof Error && cause.message ? cause.message : 'Network request failed',
          method: M,
          path: pathTemplate,
          url: ctx.url,
          cause,
        })
      }

      try {
        if (options.onRequest) await options.onRequest(ctx)
        const fetchImpl: FetchLike = options.fetch ?? ((input, i) => fetch(input, i))
        let res: Response
        try {
          res = await fetchImpl(ctx.url, ctx.init)
        } catch (cause) {
          throw failure(cause)
        }
        if (options.onResponse) await options.onResponse({ ...ctx, response: res })

        if (!res.ok) {
          let error: LearnHouseError
          try {
            error = await readError(res, M, pathTemplate, ctx.url)
          } catch (cause) {
            throw failure(cause)
          }
          if (res.status >= 500 || res.status === 429) throw new RetryableStatus(error)
          throw error
        }
        if (parseAs === 'response' || parseAs === 'stream') detachCaller = false
        try {
          return await readBody(res, parseAs, M, pathTemplate, ctx.url)
        } catch (cause) {
          throw failure(cause)
        }
      } finally {
        // The timeout covers headers and (for parsed bodies) the body; it is
        // cleared here so it never cuts a caller-owned stream short.
        if (timer !== undefined) clearTimeout(timer)
        if (detachCaller) signal?.removeEventListener('abort', onCallerAbort)
      }
    }
  }

  const typed =
    (method: HttpMethod) =>
    (path: string, ...rest: unknown[]) =>
      request(method, path, (rest[0] ?? {}) as BaseRequestOptions & UntypedRequestOptions)

  return {
    GET: typed('get') as TypedMethod<'get'>,
    POST: typed('post') as TypedMethod<'post'>,
    PUT: typed('put') as TypedMethod<'put'>,
    PATCH: typed('patch') as TypedMethod<'patch'>,
    DELETE: typed('delete') as TypedMethod<'delete'>,
    request: request as HttpCore['request'],
  }
}
