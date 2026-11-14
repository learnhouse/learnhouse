// Editor comment marks in stored activity JSON.
//
// Comment threads are anchored on text with a `comment` mark
// ({ type: 'comment', attrs: { threadId } }). Only the activity editor knows
// that mark. Every other renderer (the learner canvas, previews, templates)
// must drop it before handing the document to TipTap: an editor schema
// without the mark throws the whole document away and shows an empty page.
// Kept dependency-free so the learner bundle can import it cheaply.

export const COMMENT_MARK = 'comment'

type JSONNode = { type?: string; marks?: unknown; content?: unknown; [key: string]: unknown }

const MAX_DEPTH = 200
// Fast path: most documents have no comments at all, so a string scan of the
// serialized JSON avoids cloning anything.
const COMMENT_MARK_RE = /"type"\s*:\s*"comment"/

function isCommentMark(mark: unknown): boolean {
  return !!mark && typeof mark === 'object' && (mark as JSONNode).type === COMMENT_MARK
}

function strip(node: unknown, depth: number): unknown {
  if (!node || typeof node !== 'object' || depth > MAX_DEPTH) return node
  if (Array.isArray(node)) {
    let changed = false
    const next = node.map((child) => {
      const out = strip(child, depth + 1)
      if (out !== child) changed = true
      return out
    })
    return changed ? next : node
  }
  const src = node as JSONNode
  let out: JSONNode = src
  if (Array.isArray(src.marks) && src.marks.some(isCommentMark)) {
    const kept = src.marks.filter((m) => !isCommentMark(m))
    out = { ...src }
    if (kept.length) out.marks = kept
    else delete out.marks
  }
  if (Array.isArray(src.content)) {
    const content = strip(src.content, depth)
    if (content !== src.content) {
      if (out === src) out = { ...src }
      out.content = content
    }
  }
  return out
}

/** True when the document (object or JSON string) carries a comment mark. */
export function hasCommentMarks(content: unknown): boolean {
  if (content == null) return false
  try {
    const raw = typeof content === 'string' ? content : JSON.stringify(content)
    return COMMENT_MARK_RE.test(raw)
  } catch {
    return false
  }
}

/**
 * The document without comment marks. Returns the same reference when there
 * are none, so memoized renderers don't re-render; never mutates its input.
 * Strings are parsed first (the learner canvas receives either form).
 */
export function stripCommentMarks<T = any>(content: T): T {
  if (!hasCommentMarks(content)) return content
  if (typeof content === 'string') {
    try {
      return strip(JSON.parse(content), 0) as T
    } catch {
      return content
    }
  }
  return strip(content, 0) as T
}
