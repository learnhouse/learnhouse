import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_BOARD_EDITORS,
  MAX_BOARD_VIEWERS,
  sanitizeAwareness,
  seatRefusal,
} from '../src/boardPresence.ts'

const seats = (n: number, readOnly: boolean, prefix: string) =>
  Array.from({ length: n }, (_, i) => ({ readOnly, socketId: `${prefix}${i}` }))

describe('board seats', () => {
  it('lets an editor in when viewers fill their own seats', () => {
    const existing = seats(MAX_BOARD_VIEWERS, true, 'v')
    assert.equal(seatRefusal(existing, { readOnly: false, socketId: 'e' }), null)
    assert.match(seatRefusal(existing, { readOnly: true, socketId: 'v-new' }) ?? '', /viewers/)
  })

  it('still caps editors', () => {
    const existing = seats(MAX_BOARD_EDITORS, false, 'e')
    assert.match(seatRefusal(existing, { readOnly: false, socketId: 'e-new' }) ?? '', /full/)
    assert.equal(seatRefusal(existing, { readOnly: true, socketId: 'v' }), null)
  })

  it('limits sessions per socket', () => {
    const existing = [
      { readOnly: true, socketId: 's' },
      { readOnly: true, socketId: 's' },
    ]
    assert.match(seatRefusal(existing, { readOnly: true, socketId: 's' }) ?? '', /one connection/)
    assert.equal(seatRefusal(existing, { readOnly: true, socketId: 'other' }), null)
  })
})

describe('awareness sanitizer', () => {
  const conn = (name: string, readOnly = false) => ({ readOnly, context: { user: { name } } })

  it('stamps the authenticated name over a spoofed one', () => {
    const alice = conn('alice')
    const states = new Map([[1, { user: { name: 'admin', color: '#fff' } }]])
    sanitizeAwareness(alice, states, new Set(), new Map(), [alice])
    assert.deepEqual(states.get(1), { user: { name: 'alice', color: '#fff' } })
  })

  it("drops writes to and removals of another connection's client id", () => {
    const alice = conn('alice')
    const mallory = conn('mallory')
    const claims = new Map<number, typeof alice>([[1, alice]])
    const states = new Map([[1, { user: { name: 'x' } }], [2, { user: { name: 'y' } }]])
    const removed = new Set([1])
    sanitizeAwareness(mallory, states, removed, claims, [alice, mallory])
    assert.equal(states.has(1), false)
    assert.equal(states.get(2)?.user.name, 'mallory')
    assert.equal(removed.has(1), false)
    assert.equal(claims.get(1), alice)
  })

  it('lets a reconnecting client take back its id from a closed connection', () => {
    const old = conn('alice')
    const fresh = conn('alice')
    const claims = new Map<number, typeof old>([[1, old]])
    const states = new Map([[1, { user: { name: 'alice' } }]])
    sanitizeAwareness(fresh, states, new Set(), claims, [fresh])
    assert.equal(states.has(1), true)
    assert.equal(claims.get(1), fresh)
  })

  it('lets a connection remove its own id and blanks viewer chat bubbles', () => {
    const viewer = conn('vic', true)
    const claims = new Map<number, typeof viewer>([[3, viewer]])
    const states = new Map([[4, { user: { name: 'vic' }, chatBubble: { text: 'hi', timestamp: 1 } }]])
    const removed = new Set([3])
    sanitizeAwareness(viewer, states, removed, claims, [viewer])
    assert.equal(removed.has(3), true)
    assert.equal(claims.has(3), false)
    assert.equal(states.get(4)?.chatBubble, null)
  })
})
