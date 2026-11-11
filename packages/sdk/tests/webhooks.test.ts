import { afterEach, describe, expect, it, vi } from 'vitest'
import { LearnHouseError, parseWebhook, verifyWebhookSignature } from '../src'

// Signed by the API's own code path: json.dumps(payload, separators=(",", ":"))
// then hmac.new(secret.encode(), body, sha256) (apps/api/src/services/webhooks).
const SECRET = 'whsec_test_sécret'
const BODY =
  '{"event":"course_completed","delivery_id":"dlv_9f1e3c7b22a44f0d","timestamp":"2026-04-19T14:31:02Z","org_id":1,"data":{"course":{"course_uuid":"course_xyz","name":"Intro to Python \\u00e9"}}}'
const SIG = 'sha256=0f3c999e7437e646c96d9b778e6628a164ddcb14780f224725b11f30c918b311'

const bytes = (s: string) => new TextEncoder().encode(s)
/** Like a Node Buffer from the pool: a view that does not start at offset 0. */
function view(s: string): Uint8Array {
  const b = bytes(s)
  const pool = new Uint8Array(b.length + 16)
  pool.set(b, 8)
  return pool.subarray(8, 8 + b.length)
}
const NodeBuffer = (globalThis as unknown as { Buffer: { from(s: string): Uint8Array } }).Buffer

async function sign(body: string, secret = SECRET): Promise<string> {
  const key = await crypto.subtle.importKey('raw', bytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes(body)))
  return `sha256=${Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('')}`
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('verifyWebhookSignature', () => {
  it('accepts the API signature for every payload type', async () => {
    const u8 = bytes(BODY)
    const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)
    for (const payload of [BODY, u8, ab, view(BODY), NodeBuffer.from(BODY)]) {
      expect(await verifyWebhookSignature({ payload, signature: SIG, secret: SECRET })).toBe(true)
    }
  })

  it('tolerates surrounding whitespace and uppercase hex', async () => {
    const sig = ` sha256=${SIG.slice(7).toUpperCase()} `
    expect(await verifyWebhookSignature({ payload: BODY, signature: sig, secret: SECRET })).toBe(true)
  })

  it('rejects a tampered body', async () => {
    const payload = BODY.replace('"org_id":1', '"org_id":2')
    expect(await verifyWebhookSignature({ payload, signature: SIG, secret: SECRET })).toBe(false)
    expect(await verifyWebhookSignature({ payload: bytes(payload), signature: SIG, secret: SECRET })).toBe(false)
  })

  it('rejects the wrong secret', async () => {
    expect(await verifyWebhookSignature({ payload: BODY, signature: SIG, secret: 'whsec_other' })).toBe(false)
  })

  it('rejects a missing prefix, a missing header or a truncated digest', async () => {
    for (const signature of [SIG.slice(7), `sha1=${SIG.slice(7)}`, '', null, undefined, SIG.slice(0, -2)]) {
      expect(await verifyWebhookSignature({ payload: BODY, signature, secret: SECRET })).toBe(false)
    }
  })

  it('requires a secret', async () => {
    await expect(verifyWebhookSignature({ payload: BODY, signature: SIG, secret: '' })).rejects.toThrow(TypeError)
  })

  it('says so when Web Crypto is missing', async () => {
    vi.stubGlobal('crypto', undefined)
    await expect(verifyWebhookSignature({ payload: BODY, signature: SIG, secret: SECRET })).rejects.toThrow(
      /crypto\.subtle/,
    )
  })
})

describe('parseWebhook', () => {
  const expected = {
    event: 'course_completed',
    deliveryId: 'dlv_9f1e3c7b22a44f0d',
    timestamp: '2026-04-19T14:31:02Z',
    orgId: 1,
    data: { course: { course_uuid: 'course_xyz', name: 'Intro to Python é' } },
  }

  it('reads the signature from fetch Headers', async () => {
    const headers = new Headers({ 'X-Webhook-Signature': SIG, 'X-Webhook-Event': 'course_completed' })
    expect(await parseWebhook({ payload: BODY, headers, secret: SECRET })).toEqual(expected)
  })

  it('reads plain header objects case-insensitively, including arrays', async () => {
    expect(await parseWebhook({ payload: bytes(BODY), headers: { 'x-webhook-signature': SIG }, secret: SECRET })).toEqual(
      expected,
    )
    expect(
      await parseWebhook({ payload: view(BODY), headers: { 'X-WEBHOOK-SIGNATURE': [SIG, 'x'] }, secret: SECRET }),
    ).toEqual(expected)
  })

  it('throws INVALID_SIGNATURE (401) without a signature header', async () => {
    for (const headers of [new Headers(), { 'x-webhook-event': 'ping' }, { 'x-webhook-signature': undefined }]) {
      const err = (await parseWebhook({ payload: BODY, headers, secret: SECRET }).catch((e: unknown) => e)) as LearnHouseError
      expect(err).toBeInstanceOf(LearnHouseError)
      expect(err).toMatchObject({ status: 401, code: 'INVALID_SIGNATURE', message: 'Missing X-Webhook-Signature header' })
    }
  })

  it('throws INVALID_SIGNATURE (401) for a bad signature', async () => {
    await expect(
      parseWebhook({ payload: BODY, headers: { 'X-Webhook-Signature': SIG }, secret: 'whsec_other' }),
    ).rejects.toMatchObject({ status: 401, code: 'INVALID_SIGNATURE', message: 'Webhook signature does not match' })
  })

  it('throws INVALID_PAYLOAD (400) for a signed body that is not JSON', async () => {
    const payload = 'not json'
    const err = (await parseWebhook({
      payload,
      headers: { 'X-Webhook-Signature': await sign(payload) },
      secret: SECRET,
    }).catch((e: unknown) => e)) as LearnHouseError
    expect(err).toMatchObject({ status: 400, code: 'INVALID_PAYLOAD', message: 'Webhook body is not valid JSON' })
    expect(err.cause).toBeInstanceOf(SyntaxError)
  })

  it('throws INVALID_PAYLOAD (400) for signed JSON that is not an event', async () => {
    for (const payload of ['null', '5', '{"event":"ping"}', '{"delivery_id":"dlv_1"}']) {
      await expect(
        parseWebhook({ payload: bytes(payload), headers: { 'X-Webhook-Signature': await sign(payload) }, secret: SECRET }),
      ).rejects.toMatchObject({ status: 400, code: 'INVALID_PAYLOAD', message: 'Webhook body is not a LearnHouse event' })
    }
  })
})
