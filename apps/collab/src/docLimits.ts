import * as Y from 'yjs'

// The persistence cap alone does not bound memory: updates keep growing the
// in-memory document after store() starts refusing it. This tracks each
// loaded document's encoded size and flags it once it passes the cap, so the
// server can stop accepting updates for it. Encoding the whole document is
// O(size), so it is re-measured only after enough new update bytes arrive.

export interface DocSizeGuardOptions {
  maxDocBytes: number
  /** Update bytes to accumulate before measuring the document again. */
  remeasureEveryBytes: number
}

export function createDocSizeGuard(opts: DocSizeGuardOptions) {
  const unmeasured = new Map<string, number>()
  const oversized = new Set<string>()

  /** Measures the document now. Returns true when it is over the cap. */
  function measure(name: string, doc: Y.Doc): boolean {
    unmeasured.set(name, 0)
    if (Y.encodeStateAsUpdate(doc).byteLength > opts.maxDocBytes) oversized.add(name)
    return oversized.has(name)
  }

  /** Counts an applied update. Returns true when the document is over the cap. */
  function recordUpdate(name: string, doc: Y.Doc, updateBytes: number): boolean {
    if (oversized.has(name)) return true
    const pending = (unmeasured.get(name) ?? 0) + updateBytes
    if (pending < opts.remeasureEveryBytes) {
      unmeasured.set(name, pending)
      return false
    }
    return measure(name, doc)
  }

  function isOversized(name: string): boolean {
    return oversized.has(name)
  }

  /** Drops the bookkeeping once the document is unloaded. */
  function forget(name: string) {
    unmeasured.delete(name)
    oversized.delete(name)
  }

  return { measure, recordUpdate, isOversized, forget }
}
