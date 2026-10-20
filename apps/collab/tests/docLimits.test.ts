import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import { createDocSizeGuard } from '../src/docLimits.ts'

function grow(doc: Y.Doc, bytes: number): Uint8Array {
  let update = new Uint8Array()
  const capture = (u: Uint8Array) => {
    update = u
  }
  doc.on('update', capture)
  doc.getText('t').insert(0, 'x'.repeat(bytes))
  doc.off('update', capture)
  return update
}

describe('doc size guard', () => {
  it('flags a document once it passes the cap', () => {
    const guard = createDocSizeGuard({ maxDocBytes: 4096, remeasureEveryBytes: 1024 })
    const doc = new Y.Doc()
    assert.equal(guard.measure('a', doc), false)

    assert.equal(guard.recordUpdate('a', doc, grow(doc, 512).byteLength), false)
    assert.equal(guard.isOversized('a'), false)

    // Re-measured once enough update bytes accumulate
    assert.equal(guard.recordUpdate('a', doc, grow(doc, 8192).byteLength), true)
    assert.equal(guard.isOversized('a'), true)
    assert.equal(guard.recordUpdate('a', doc, 1), true)
  })

  it('does not measure between thresholds', () => {
    const guard = createDocSizeGuard({ maxDocBytes: 16, remeasureEveryBytes: 1_000_000 })
    const doc = new Y.Doc()
    grow(doc, 64)
    // Over the cap, but not re-measured until enough bytes arrive
    assert.equal(guard.recordUpdate('b', doc, 64), false)
    assert.equal(guard.measure('b', doc), true)
  })

  it('forgets a document after it unloads', () => {
    const guard = createDocSizeGuard({ maxDocBytes: 16, remeasureEveryBytes: 1 })
    const doc = new Y.Doc()
    grow(doc, 64)
    assert.equal(guard.measure('c', doc), true)
    guard.forget('c')
    assert.equal(guard.isOversized('c'), false)
  })
})
