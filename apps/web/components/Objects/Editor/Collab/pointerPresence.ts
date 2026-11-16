// Live mouse pointers in the activity editor: the pure part (no DOM, Yjs or
// provider imports), so it is cheap to import and easy to test.
//
// A pointer is shared anchored to the document rather than to the screen,
// so it lines up for everyone whatever their window width or scroll:
// - over text, to the character under it (`p`, a document position) plus a
//   small pixel offset (`dx`, `dy`): text reflows at other widths, and the
//   pointer follows the word it was on;
// - always, to the top-level block under it (`b`) with `x` a fraction of the
//   content width and `y` a fraction of that block's height ("40% across,
//   halfway down the third block"), used in margins, over images and other
//   non-text blocks, and when `p` no longer falls inside block `b`.
//
// The collab server (apps/collab/src/activityPresence.ts) applies the same
// bounds, drops pointers from read-only connections and caps how often one
// connection may update its presence.

export interface PointerAnchor {
  /** Index of the top-level block under the pointer. */
  b: number
  /** Fraction of the content width (can be a little outside 0..1 in the margins). */
  x: number
  /** Fraction of the block's height (outside 0..1 between blocks). */
  y: number
  /** Document position of the character under the pointer, when over text. */
  p?: number
  /** Pixels from that character (left edge, line middle). */
  dx?: number
  dy?: number
}

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

/** Fewest milliseconds between two pointer broadcasts (~15 a second). */
export const POINTER_INTERVAL_MS = 66
/** Most often the caret goes out on its own. */
export const CARET_INTERVAL_MS = 100
/** Smallest move, in screen pixels, worth telling the others about. */
export const POINTER_MIN_MOVE_PX = 3
/** Most often the selected/edited block goes out (it changes on clicks, not moves). */
export const BLOCK_INTERVAL_MS = 150
/** A pointer that stops moving fades out after this long. */
export const POINTER_IDLE_MS = 5000

// Same bounds as the server's POINTER_LIMITS (tighter on our side).
const LIMITS = { maxBlock: 100_000, minX: -0.5, maxX: 1.5, minY: -5, maxY: 5, maxPos: 10_000_000, maxOffset: 32 }

/** How far from a character's caret box the pointer may be to count as on it. */
export const TEXT_SNAP_PX = 24

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
const round = (v: number, digits: number) => {
  const f = 10 ** digits
  return Math.round(v * f) / f
}

/** Anchors a screen point to block `index` (both boxes in the same coordinates). */
export function toAnchor(index: number, point: { x: number; y: number }, content: Box, block: Box): PointerAnchor {
  const width = content.width > 0 ? content.width : 1
  const height = block.height > 0 ? block.height : 1
  return {
    b: clamp(Math.floor(index), 0, LIMITS.maxBlock),
    // 3 decimals ≈ 1px across a 1000px column; 4 for tall blocks (images, code)
    x: round(clamp((point.x - content.left) / width, LIMITS.minX, LIMITS.maxX), 3),
    y: round(clamp((point.y - block.top) / height, LIMITS.minY, LIMITS.maxY), 4),
  }
}

/**
 * Adds the text anchor when the pointer is close to the character at `pos`
 * (`caret` is that position's caret box on screen); otherwise returns the
 * block anchor unchanged.
 */
export function withTextAnchor(
  anchor: PointerAnchor,
  pos: number,
  point: { x: number; y: number },
  caret: { left: number; top: number; bottom: number },
): PointerAnchor {
  const dx = Math.round(point.x - caret.left)
  const dy = Math.round(point.y - (caret.top + caret.bottom) / 2)
  const lineHalf = Math.max(8, (caret.bottom - caret.top) / 2 + 4)
  if (!Number.isInteger(pos) || pos < 0 || pos > LIMITS.maxPos) return anchor
  if (Math.abs(dx) > TEXT_SNAP_PX || Math.abs(dy) > lineHalf) return anchor
  return { ...anchor, p: pos, dx: clamp(dx, -LIMITS.maxOffset, LIMITS.maxOffset), dy: clamp(dy, -LIMITS.maxOffset, LIMITS.maxOffset) }
}

/** Where a text anchor lands, given that character's caret box here. */
export function fromTextAnchor(anchor: PointerAnchor, caret: { left: number; top: number; bottom: number }): { x: number; y: number } {
  return { x: caret.left + (anchor.dx ?? 0), y: (caret.top + caret.bottom) / 2 + (anchor.dy ?? 0) }
}

/** Where an anchor lands on this screen, given the content and block boxes here. */
export function fromAnchor(anchor: PointerAnchor, content: Box, block: Box): { x: number; y: number } {
  return {
    x: content.left + anchor.x * content.width,
    y: block.top + anchor.y * block.height,
  }
}

/**
 * True when `next` is far enough from the last pointer sent to be worth a
 * message: another block, or more than `minPx` away on this screen.
 */
export function movedEnough(
  prev: PointerAnchor | null,
  next: PointerAnchor,
  contentWidth: number,
  blockHeight: number,
  minPx = POINTER_MIN_MOVE_PX,
): boolean {
  if (!prev || prev.b !== next.b || prev.p !== next.p) return true
  if (next.p !== undefined && (Math.abs((prev.dx ?? 0) - (next.dx ?? 0)) > minPx || Math.abs((prev.dy ?? 0) - (next.dy ?? 0)) > minPx)) {
    return true
  }
  return Math.abs(prev.x - next.x) * contentWidth > minPx || Math.abs(prev.y - next.y) * blockHeight > minPx
}

/** A peer's pointer from its awareness state, or null when missing or malformed. */
export function parsePointer(v: unknown): PointerAnchor | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const { b, x, y } = v as Record<string, unknown>
  const num = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
  if (!Number.isInteger(b) || !num(b) || b < 0 || b > LIMITS.maxBlock || !num(x) || !num(y)) return null
  const out: PointerAnchor = { b, x: clamp(x, LIMITS.minX, LIMITS.maxX), y: clamp(y, LIMITS.minY, LIMITS.maxY) }
  const { p, dx, dy } = v as Record<string, unknown>
  if (Number.isInteger(p) && num(p) && p >= 0 && p <= LIMITS.maxPos) {
    out.p = p
    out.dx = num(dx) ? clamp(dx, -LIMITS.maxOffset, LIMITS.maxOffset) : 0
    out.dy = num(dy) ? clamp(dy, -LIMITS.maxOffset, LIMITS.maxOffset) : 0
  }
  return out
}

/** The top-level block someone has selected or is editing inside. */
export interface BlockFocus {
  b: number
}

export function parseBlockFocus(v: unknown): BlockFocus | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const { b } = v as Record<string, unknown>
  return typeof b === 'number' && Number.isInteger(b) && b >= 0 && b <= LIMITS.maxBlock ? { b } : null
}

export interface RemoteBlock {
  clientId: number
  userId: number
  name: string
  color: string
  b: number
}

/** Blocks other people have selected or are editing (my own tabs left out). */
export function remoteBlocks(states: Map<number, Record<string, any>>, selfClientId: number, selfUserId: number): RemoteBlock[] {
  const out: RemoteBlock[] = []
  for (const [clientId, state] of states) {
    if (clientId === selfClientId) continue
    const user = state?.user
    if (!user || typeof user.id !== 'number' || user.id <= 0 || user.id === selfUserId) continue
    const block = parseBlockFocus(state.block)
    if (!block) continue
    out.push({
      clientId,
      userId: user.id,
      name: typeof user.name === 'string' ? user.name : '',
      color: safeColor(user.color),
      b: block.b,
    })
  }
  return out.sort((a, b) => a.clientId - b.clientId)
}

const safeColor = (c: unknown) => (typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : '#64748b')

export interface RemotePointer {
  clientId: number
  userId: number
  name: string
  color: string
  pointer: PointerAnchor
}

/**
 * Other people's pointers from awareness states: the current user's own
 * tabs left out, and only states with a valid pointer and identity.
 */
export function remotePointers(
  states: Map<number, Record<string, any>>,
  selfClientId: number,
  selfUserId: number,
): RemotePointer[] {
  const out: RemotePointer[] = []
  for (const [clientId, state] of states) {
    if (clientId === selfClientId) continue
    const user = state?.user
    if (!user || typeof user.id !== 'number' || user.id <= 0 || user.id === selfUserId) continue
    const pointer = parsePointer(state.pointer)
    if (!pointer) continue
    out.push({
      clientId,
      userId: user.id,
      name: typeof user.name === 'string' ? user.name : '',
      color: safeColor(user.color),
      pointer,
    })
  }
  return out.sort((a, b) => a.clientId - b.clientId)
}

/**
 * Batches presence fields into as few awareness updates as possible. Each
 * field has its own minimum interval since the last update of any kind, and
 * every pending field rides along whichever update goes out first, so a
 * moving pointer and a moving caret share one message (~15 a second at most)
 * instead of sending two streams. The latest value of each field wins.
 * `urgent` sends right away (clearing a pointer or caret).
 */
export function createPresenceBatcher(
  apply: (_patch: Record<string, unknown>) => void,
  intervals: Record<string, number>,
  now: () => number = () => Date.now(),
  schedule: (_fn: () => void, _ms: number) => unknown = setTimeout,
  cancel: (_handle: any) => void = clearTimeout,
) {
  let last = -Infinity
  let pending: Record<string, unknown> | null = null
  let timer: unknown = null
  let timerAt = Infinity

  const clearTimer = () => {
    if (timer !== null) cancel(timer)
    timer = null
    timerAt = Infinity
  }

  const flush = () => {
    clearTimer()
    if (!pending) return
    const patch = pending
    pending = null
    last = now()
    apply(patch)
  }

  const set = (field: string, value: unknown, urgent = false) => {
    pending = { ...(pending ?? {}), [field]: value }
    const due = last + (intervals[field] ?? 0)
    const t = now()
    if (urgent || t >= due) {
      flush()
      return
    }
    if (due < timerAt) {
      clearTimer()
      timerAt = due
      timer = schedule(flush, due - t)
    }
  }

  return {
    set,
    flush,
    cancel() {
      clearTimer()
      pending = null
    },
  }
}

export interface Spring {
  x: number
  y: number
  vx: number
  vy: number
}

/**
 * Moves a critically damped spring towards (tx, ty) by `dt` seconds (the
 * same feel as board cursors). Long gaps (a background tab) jump straight
 * there. Returns true while still moving.
 */
export function stepSpring(s: Spring, tx: number, ty: number, dt: number, omega = 22): boolean {
  if (dt > 0.25) {
    s.x = tx
    s.y = ty
    s.vx = s.vy = 0
    return false
  }
  const ax = omega * omega * (tx - s.x) - 2 * omega * s.vx
  const ay = omega * omega * (ty - s.y) - 2 * omega * s.vy
  s.vx += ax * dt
  s.vy += ay * dt
  s.x += s.vx * dt
  s.y += s.vy * dt
  const settled = Math.abs(tx - s.x) < 0.1 && Math.abs(ty - s.y) < 0.1 && Math.abs(s.vx) < 1 && Math.abs(s.vy) < 1
  if (settled) {
    s.x = tx
    s.y = ty
    s.vx = s.vy = 0
  }
  return !settled
}
