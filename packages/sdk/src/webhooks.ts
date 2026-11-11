// Webhook verification with Web Crypto, so it runs in Node 19+, Bun, Deno,
// edge workers and browsers without a dependency.
import { LearnHouseError } from './errors'

/** The raw request body, exactly as received. Never a re-serialized object. */
export type WebhookPayload = string | Uint8Array | ArrayBuffer

/** Fetch `Headers`, or a plain object like Node's `req.headers`. */
export type WebhookHeaders = Headers | Record<string, string | string[] | undefined>

export interface VerifyWebhookSignatureInput {
  payload: WebhookPayload
  /** The `X-Webhook-Signature` header: `sha256=<hex>`. */
  signature: string | null | undefined
  /** The endpoint's signing secret (`whsec_...`). */
  secret: string
}

export interface ParseWebhookInput {
  payload: WebhookPayload
  headers: WebhookHeaders
  secret: string
}

/** A verified delivery. Fields come from the signed body. */
export interface WebhookEvent<T = Record<string, unknown>> {
  /** Event name, e.g. `course_completed`. */
  event: string
  /** Same for every retry of one delivery: use it to drop duplicates. */
  deliveryId: string
  /** When the delivery was first attempted (ISO 8601, UTC). Retries keep it. */
  timestamp: string
  orgId: number
  data: T
}

const PREFIX = 'sha256='
const encoder = new TextEncoder()

function toBytes(payload: WebhookPayload): Uint8Array {
  if (typeof payload === 'string') return encoder.encode(payload)
  if (payload instanceof Uint8Array) return payload
  return new Uint8Array(payload)
}

function subtle(): SubtleCrypto {
  const s = (globalThis as { crypto?: Crypto }).crypto?.subtle
  if (!s) throw new TypeError('Web Crypto (crypto.subtle) is not available in this runtime')
  return s
}

async function hmacHex(secret: string, bytes: Uint8Array): Promise<string> {
  const s = subtle()
  const key = await s.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await s.sign('HMAC', key, bytes as Uint8Array<ArrayBuffer>))
  let hex = ''
  for (const b of mac) hex += b.toString(16).padStart(2, '0')
  return hex
}

/** Compares in time that depends only on the length, which is public. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Checks an `X-Webhook-Signature` header: HMAC-SHA256 of the raw body with the
 * endpoint's secret. Resolves false for a missing, malformed or wrong signature.
 */
export async function verifyWebhookSignature(input: VerifyWebhookSignatureInput): Promise<boolean> {
  const { payload, signature, secret } = input
  if (!secret) throw new TypeError('verifyWebhookSignature: `secret` is required')
  const sig = signature?.trim() ?? ''
  if (!sig.startsWith(PREFIX)) return false
  const expected = await hmacHex(secret, toBytes(payload))
  return safeEqual(sig.slice(PREFIX.length).toLowerCase(), expected)
}

function header(headers: WebhookHeaders, name: string): string | undefined {
  if (typeof Headers !== 'undefined' && headers instanceof Headers) return headers.get(name) ?? undefined
  const rec = headers as Record<string, string | string[] | undefined>
  const key = Object.keys(rec).find((k) => k.toLowerCase() === name)
  const v = key === undefined ? undefined : rec[key]
  return Array.isArray(v) ? v[0] : v
}

function webhookError(status: number, code: string, message: string, cause?: unknown): LearnHouseError {
  return new LearnHouseError({ status, code, message, method: 'POST', path: '', url: '', cause })
}

/**
 * Verifies a delivery and returns its event. Throws a LearnHouseError with
 * code `INVALID_SIGNATURE` (status 401) or `INVALID_PAYLOAD` (status 400);
 * answer the request with that status.
 */
export async function parseWebhook<T = Record<string, unknown>>(input: ParseWebhookInput): Promise<WebhookEvent<T>> {
  const { payload, headers, secret } = input
  const signature = header(headers, 'x-webhook-signature')
  if (!signature) throw webhookError(401, 'INVALID_SIGNATURE', 'Missing X-Webhook-Signature header')
  if (!(await verifyWebhookSignature({ payload, signature, secret }))) {
    throw webhookError(401, 'INVALID_SIGNATURE', 'Webhook signature does not match')
  }
  let body: unknown
  try {
    body = JSON.parse(typeof payload === 'string' ? payload : new TextDecoder().decode(toBytes(payload)))
  } catch (cause) {
    throw webhookError(400, 'INVALID_PAYLOAD', 'Webhook body is not valid JSON', cause)
  }
  const b = body as { event?: unknown; delivery_id?: unknown; timestamp?: unknown; org_id?: unknown; data?: unknown }
  if (!b || typeof b !== 'object' || typeof b.event !== 'string' || typeof b.delivery_id !== 'string') {
    throw webhookError(400, 'INVALID_PAYLOAD', 'Webhook body is not a LearnHouse event')
  }
  return {
    event: b.event,
    deliveryId: b.delivery_id,
    timestamp: b.timestamp as string,
    orgId: b.org_id as number,
    data: b.data as T,
  }
}
