/**
 * The parent half of H5P's external-embed protocol.
 *
 * H5P content running in an iframe does not simply announce its height. It
 * runs a handshake, and stays silent unless the parent plays its part:
 *
 *   child  -> hello           "is anyone out there?"  (repeats until answered)
 *   parent -> hello           marks the parent friendly on the child's side
 *   child  -> prepareResize   "I am about to measure; give me my own height"
 *   parent -> resizePrepared  after shrinking the frame back to that height
 *   child  -> resize          the real content height
 *
 * Answering only the last step — which is the obvious reading of H5P's docs —
 * means no conformant host ever sends one, and the frame never resizes.
 *
 * Everything here is pure so the protocol can be tested without a live
 * cross-origin frame; the DOM half (matching the message to *this* iframe,
 * writing the height) stays in the component.
 */

// Matches the `height` attribute default on the H5PBlock node.
export const DEFAULT_HEIGHT = 400
// A frame shorter than this is unusable, and the number in a resize message
// comes from someone else's page, so clamp before it reaches a style
// attribute. The upper bound is an absurdity guard, not a layout decision:
// once the handshake completes the child stops managing its own scrolling, so
// a bound near real content heights would silently truncate long activities.
export const MIN_HEIGHT = 120
export const MAX_HEIGHT = 20000
// Only persist a resize once it has actually moved, so a noisy host does not
// flood the document with attribute updates.
export const HEIGHT_PERSIST_THRESHOLD = 16

export function clampHeight(value: number): number {
  return Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, value)))
}

export type H5PMessage =
  | { kind: 'hello' }
  | { kind: 'prepareResize'; clientHeight: number; scrollHeight: number }
  | { kind: 'resize'; scrollHeight: number }

// `Number(null)` is 0 and `Number('')` is 0, so a missing height would read as
// a real one. Only an actual number, or a string spelling one, counts.
function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/**
 * Recognise a message from H5P content. Anything on the page can postMessage
 * at us, so this accepts only the exact shapes the protocol defines and
 * returns null for everything else — the caller has already checked that the
 * message came from its own frame.
 *
 * Some hosts post the payload as a JSON string rather than a structured
 * clone, so a string is parsed before matching.
 */
export function parseH5PMessage(data: unknown): H5PMessage | null {
  let payload: any = data
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload)
    } catch {
      return null
    }
  }
  if (!payload || typeof payload !== 'object') return null
  if (payload.context !== 'h5p') return null

  switch (payload.action) {
    case 'hello':
      return { kind: 'hello' }

    case 'prepareResize': {
      const clientHeight = toFiniteNumber(payload.clientHeight)
      const scrollHeight = toFiniteNumber(payload.scrollHeight)
      if (clientHeight === null || scrollHeight === null) return null
      if (clientHeight < 0 || scrollHeight < 0) return null
      return { kind: 'prepareResize', clientHeight, scrollHeight }
    }

    case 'resize': {
      const scrollHeight = toFiniteNumber(payload.scrollHeight)
      if (scrollHeight === null || scrollHeight <= 0) return null
      return { kind: 'resize', scrollHeight }
    }

    default:
      return null
  }
}

/**
 * Whether to act on a `prepareResize` at all.
 *
 * Answering it means shrinking the frame to the content's own height so the
 * content can re-measure — which itself makes the content resize, which makes
 * it ask again. H5P's own h5p-resizer.js breaks that cycle by staying silent
 * when the three heights already agree, and so do we. Staying silent is the
 * intended end state of the handshake, not a dropped message.
 */
export function shouldPrepareResize(
  frameHeight: number,
  message: { clientHeight: number; scrollHeight: number }
): boolean {
  return !(frameHeight === message.scrollHeight && message.scrollHeight === message.clientHeight)
}

/**
 * postMessage target for a reply. A sandboxed frame reports its origin as the
 * string 'null', which postMessage rejects as a target URL.
 */
export function replyTarget(origin: string | undefined): string {
  return origin && origin !== 'null' ? origin : '*'
}
