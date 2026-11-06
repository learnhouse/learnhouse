import type { paths } from '../generated/schema'

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete'

/** Paths that declare the given method. */
export type PathsWithMethod<M extends HttpMethod> = {
  [P in keyof paths]: [NonNullable<paths[P][M]>] extends [never] ? never : P
}[keyof paths]

export type Operation<P extends keyof paths, M extends HttpMethod> = NonNullable<paths[P][M]>

/** Drop parameter groups the operation doesn't use (`query?: never`, ...). */
type StripNever<T> = {
  [K in keyof T as [NonNullable<T[K]>] extends [never] ? never : K]: T[K]
}

export type OperationParams<O> = O extends { parameters: infer Prm } ? StripNever<Prm> : {}

type RequestContent<O> = O extends { requestBody?: infer RB }
  ? NonNullable<RB> extends { content: infer C }
    ? C[keyof C]
    : never
  : never

/** Raw bodies are passed to fetch untouched. */
export type RawBody = FormData | Blob | ArrayBuffer | ArrayBufferView | string

export type OperationBody<O> = [RequestContent<O>] extends [never] ? never : RequestContent<O> | RawBody

type BodyRequired<O> = O extends { requestBody: { content: unknown } } ? true : false

type SuccessStatus = 200 | 201 | 202 | 203 | 204 | 206

type JsonOf<R> = R extends { content: { 'application/json': infer J } }
  ? J
  : R extends { content?: never }
    ? void
    : unknown

export type OperationResponse<O> = O extends { responses: infer R }
  ? [keyof R & SuccessStatus] extends [never]
    ? unknown
    : JsonOf<R[keyof R & SuccessStatus]>
  : unknown

export type ParseAs = 'auto' | 'json' | 'text' | 'blob' | 'arrayBuffer' | 'stream' | 'response'

export interface RetryOptions {
  /** Extra attempts after the first one. Default 2. */
  retries?: number
  /** First backoff delay; doubles each attempt, with jitter. Default 300ms. */
  baseDelayMs?: number
  /** Upper bound for a single backoff delay. Default 5000ms. */
  maxDelayMs?: number
}

/** Per-call options shared by every request. */
export interface BaseRequestOptions {
  signal?: AbortSignal
  headers?: HeadersInit
  /** Overrides the client's `timeoutMs` for this call. 0 disables the timeout. */
  timeoutMs?: number
  /** Overrides the client's `retry` for this call. Only GET/HEAD are ever retried. */
  retry?: RetryOptions | number | false
  /**
   * How to read a successful response. `auto` (default) parses JSON when the
   * response says it is JSON and returns text otherwise. `response` hands back
   * the raw Response without reading it.
   */
  parseAs?: ParseAs
  /** Send an object body as `application/x-www-form-urlencoded` instead of JSON. */
  bodyType?: 'json' | 'form'
  /** Skip the client's token / getToken for this call (cookies still follow `credentials`). */
  skipAuth?: boolean
}

type ParamsField<O> = {} extends OperationParams<O>
  ? { params?: OperationParams<O> }
  : { params: OperationParams<O> }

type BodyField<O> = [OperationBody<O>] extends [never]
  ? { body?: never }
  : BodyRequired<O> extends true
    ? { body: OperationBody<O> }
    : { body?: OperationBody<O> }

export type RequestOptions<O> = BaseRequestOptions & ParamsField<O> & BodyField<O>

/** Makes the options argument optional when nothing in it is required. */
export type OptionsArg<O> = {} extends RequestOptions<O>
  ? [options?: RequestOptions<O>]
  : [options: RequestOptions<O>]

/** Options for the untyped escape hatch, `client.request()`. */
export interface UntypedRequestOptions extends BaseRequestOptions {
  params?: {
    path?: Record<string, string | number>
    query?: Record<string, unknown>
  }
  body?: unknown
}
