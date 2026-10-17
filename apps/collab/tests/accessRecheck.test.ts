import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  ACCESS_REVOKED,
  REAUTH_REQUIRED,
  type AccessVerdict,
  type ConnectionAuth,
  type MembershipResponse,
  type RecheckableConnection,
  type TokenState,
  createAccessChecker,
  recheckConnections,
} from '../src/accessRecheck.ts'

const NOW = 1_000_000_000
const MAX_UNVERIFIED_MS = 10 * 60_000
const options = { maxUnverifiedMs: MAX_UNVERIFIED_MS, now: () => NOW }

function fakeConnection(token: string | null, readOnly = false, verifiedAt = NOW - 60_000) {
  const conn = {
    readOnly,
    context: token ? { auth: { token, boardUuid: 'board_x', verifiedAt } } : {},
    closedWith: null as { code: number; reason: string } | null,
    socketClosedWith: null as number | null,
    close(event?: { code: number; reason: string }) {
      conn.closedWith = event ?? null
    },
    webSocket: {
      close(code?: number) {
        conn.socketClosedWith = code ?? null
      },
    },
  }
  return conn satisfies RecheckableConnection
}

describe('access re-check', () => {
  it('closes revoked connections and syncs read-only with the role', async () => {
    const verdicts: Record<string, AccessVerdict> = {
      revoked: 'denied',
      viewer: 'read',
      editor: 'write',
      flaky: 'unknown',
    }
    const revoked = fakeConnection('revoked')
    const viewer = fakeConnection('viewer')
    const editor = fakeConnection('editor', true)
    const flaky = fakeConnection('flaky', true)
    const seen: ConnectionAuth[] = []

    const closed = await recheckConnections(
      [revoked, viewer, editor, flaky],
      async (auth) => {
        seen.push(auth)
        return verdicts[auth.token]
      },
      options,
    )

    assert.equal(closed, 1)
    assert.deepEqual(revoked.closedWith, ACCESS_REVOKED)
    assert.equal(revoked.socketClosedWith, ACCESS_REVOKED.code)
    assert.equal(viewer.readOnly, true)
    assert.equal(editor.readOnly, false)
    // A failed check leaves the connection as it was
    assert.equal(flaky.readOnly, true)
    assert.equal(flaky.closedWith, null)
    assert.deepEqual(seen.map((a) => a.boardUuid), ['board_x', 'board_x', 'board_x', 'board_x'])
  })

  it('closes a connection with no recorded credentials', async () => {
    const orphan = fakeConnection(null)
    const closed = await recheckConnections([orphan], async () => 'write', options)
    assert.equal(closed, 1)
    assert.deepEqual(orphan.closedWith, ACCESS_REVOKED)
  })

  it('asks a connection whose token expired to reconnect, not leave', async () => {
    const lapsed = fakeConnection('lapsed')
    const closed = await recheckConnections([lapsed], async () => 'expired', options)
    assert.equal(closed, 1)
    assert.deepEqual(lapsed.closedWith, REAUTH_REQUIRED)
    assert.equal(lapsed.socketClosedWith, REAUTH_REQUIRED.code)
    assert.notEqual(REAUTH_REQUIRED.code, ACCESS_REVOKED.code)
  })

  it('records successful checks', async () => {
    const editor = fakeConnection('editor', false, NOW - MAX_UNVERIFIED_MS * 2)
    await recheckConnections([editor], async () => 'write', options)
    assert.equal((editor.context as { auth: ConnectionAuth }).auth.verifiedAt, NOW)
  })

  it('closes, reconnectably, a connection unverified for too long', async () => {
    const recent = fakeConnection('recent', false, NOW - MAX_UNVERIFIED_MS + 1)
    const stale = fakeConnection('stale', false, NOW - MAX_UNVERIFIED_MS - 1)
    const closed = await recheckConnections([recent, stale], async () => 'unknown', options)
    assert.equal(closed, 1)
    assert.equal(recent.closedWith, null)
    assert.deepEqual(stale.closedWith, REAUTH_REQUIRED)
  })
})

function response(status: number, body: unknown = {}): MembershipResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

describe('access checker', () => {
  const auth = { token: 't', boardUuid: 'board_x', verifiedAt: NOW }

  function checker(states: TokenState[], reply: () => Promise<MembershipResponse>) {
    let calls = 0
    const check = createAccessChecker({
      tokenState: () => states[Math.min(calls++, states.length - 1)],
      fetchMembership: reply,
    })
    return check
  }

  it('maps the membership role to read or write', async () => {
    assert.equal(await checker(['valid'], async () => response(200, { role: 'viewer' }))(auth), 'read')
    assert.equal(await checker(['valid'], async () => response(200, { role: 'editor' }))(auth), 'write')
  })

  it('reports a token that expired since connect without calling the API', async () => {
    let fetched = false
    const check = checker(['expired'], async () => {
      fetched = true
      return response(401)
    })
    assert.equal(await check(auth), 'expired')
    assert.equal(fetched, false)
  })

  it('treats a 401 as expired when the token lapsed in flight', async () => {
    assert.equal(await checker(['valid', 'expired'], async () => response(401))(auth), 'expired')
  })

  it('denies explicit rejections of a valid token', async () => {
    for (const status of [401, 403, 404]) {
      assert.equal(await checker(['valid'], async () => response(status))(auth), 'denied')
    }
  })

  it('denies a token that no longer verifies', async () => {
    assert.equal(await checker(['invalid'], async () => response(200))(auth), 'denied')
  })

  it('leaves the connection alone when the API is unreachable or erroring', async () => {
    assert.equal(
      await checker(['valid'], async () => {
        throw new Error('timeout')
      })(auth),
      'unknown',
    )
    assert.equal(await checker(['valid'], async () => response(502))(auth), 'unknown')
  })
})
