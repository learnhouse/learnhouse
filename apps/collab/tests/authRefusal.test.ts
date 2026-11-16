import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { AUTH_REFUSAL, AuthRefusal, asAuthRefusal, isUnavailableStatus } from '../src/authRefusal.ts'

describe('auth refusal reasons', () => {
  it('keeps a refusal that already has a reason', () => {
    const err = new AuthRefusal(AUTH_REFUSAL.roomFull, 'Activity is full')
    assert.equal(asAuthRefusal(err), err)
  })

  it('reads a known reason off any error', () => {
    const err = Object.assign(new Error('nope'), { reason: 'invalid-token' })
    const out = asAuthRefusal(err)
    assert.equal(out.reason, AUTH_REFUSAL.invalidToken)
    assert.equal(out.message, 'nope')
  })

  it('maps plain errors from other room kinds', () => {
    assert.equal(asAuthRefusal(new Error('Authentication service unavailable')).reason, AUTH_REFUSAL.unavailable)
    assert.equal(asAuthRefusal(new Error('Not a member')).reason, AUTH_REFUSAL.refused)
    assert.equal(asAuthRefusal(Object.assign(new Error('x'), { reason: 'made-up' })).reason, AUTH_REFUSAL.refused)
    assert.equal(asAuthRefusal('string thrown').reason, AUTH_REFUSAL.refused)
    assert.equal(asAuthRefusal(null).message, 'Not authorized')
  })

  it('treats 5xx, 429 and 408 as unavailable', () => {
    for (const status of [500, 502, 503, 504, 429, 408]) assert.equal(isUnavailableStatus(status), true, String(status))
    for (const status of [200, 401, 403, 404, 422]) assert.equal(isUnavailableStatus(status), false, String(status))
  })
})
