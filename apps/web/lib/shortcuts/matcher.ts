/**
 * Keyboard shortcut matching, kept free of React and the DOM so it can be
 * unit-tested. Bindings are written the way they are shown: single keys
 * (`j`, `?`), or chords typed in sequence (`g c`). Letters never carry a
 * modifier; ⌘K / Ctrl K belong to the command palette and are handled there.
 */

export interface KeyLike {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
}

export interface TargetLike {
  tagName?: string
  isContentEditable?: boolean
  /** `closest(selector)` truthiness, injected so tests need no DOM. */
  matchesAncestor?: (_selector: string) => boolean
}

/** Elements whose keystrokes are never shortcuts. */
export const IGNORED_ANCESTORS = '[data-shortcuts-ignore], .video-js, [role="dialog"]'

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

export function isTypingTarget(target: TargetLike | null | undefined): boolean {
  if (!target) return false
  if (target.tagName && EDITABLE_TAGS.has(target.tagName.toUpperCase())) return true
  if (target.isContentEditable) return true
  return false
}

export function isIgnoredTarget(target: TargetLike | null | undefined): boolean {
  if (isTypingTarget(target)) return true
  return !!target?.matchesAncestor?.(IGNORED_ANCESTORS)
}

const ACTIVATION_TOKENS = new Set(['space', 'enter'])
const CONTROL_TAGS = new Set(['BUTTON', 'A', 'SUMMARY'])

/**
 * Space and Enter on a focused button or link are that control's own
 * activation keys; a shortcut must never steal them.
 */
export function isActivationKeyOnControl(
  token: string,
  target: (TargetLike & { role?: string | null }) | null | undefined,
): boolean {
  if (!ACTIVATION_TOKENS.has(token) || !target) return false
  if (target.tagName && CONTROL_TAGS.has(target.tagName.toUpperCase())) return true
  return target.role === 'button' || target.role === 'link'
}

/** The token a key event contributes, or null when it cannot be part of a shortcut. */
export function tokenFromEvent(e: KeyLike): string | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null
  const key = e.key
  if (!key || key === 'Shift' || key === 'Dead' || key === 'Unidentified') return null
  if (key.length === 1) return key === ' ' ? 'space' : key.toLowerCase()
  return key.toLowerCase()
}

export function parseBinding(binding: string): string[] {
  return binding
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .map((token) => token.toLowerCase())
}

export interface Binding<T = string> {
  id: T
  keys: string
}

/** One binding per key sequence: the primary `keys` plus every alias. */
export function expandBindings<T>(
  actions: ReadonlyArray<{ id: T; keys: string; aliases?: ReadonlyArray<string> }>,
): Binding<T>[] {
  const out: Binding<T>[] = []
  for (const a of actions) {
    out.push({ id: a.id, keys: a.keys })
    for (const alias of a.aliases ?? []) out.push({ id: a.id, keys: alias })
  }
  return out
}

export interface MatchResult<T> {
  /** The binding that fired, if any. */
  fired: Binding<T> | null
  /** True while the keys typed so far are the start of a longer chord. */
  pending: boolean
}

/** Default window within which the next key of a chord has to arrive. */
export const CHORD_TIMEOUT_MS = 900

/**
 * Stateful matcher for one listener. Feed it key tokens in order; it tracks
 * chord prefixes and tells the caller when a binding completes. An exact
 * match fires at once even if a longer chord shares the prefix, so `g`
 * alone can never be a binding while `g c` exists.
 */
export class SequenceMatcher<T = string> {
  private buffer: string[] = []
  private lastAt = 0

  constructor(
    private readonly bindings: () => Binding<T>[],
    private readonly timeoutMs: number = CHORD_TIMEOUT_MS,
  ) {}

  reset(): void {
    this.buffer = []
  }

  feed(token: string, now: number = Date.now()): MatchResult<T> {
    if (now - this.lastAt > this.timeoutMs) this.buffer = []
    this.lastAt = now

    const attempt = (seq: string[]): MatchResult<T> | null => {
      let pending = false
      let exact: Binding<T> | null = null
      for (const binding of this.bindings()) {
        const parts = parseBinding(binding.keys)
        if (parts.length < seq.length) continue
        if (!seq.every((k, i) => parts[i] === k)) continue
        if (parts.length === seq.length) exact = exact ?? binding
        else pending = true
      }
      if (exact) {
        this.buffer = []
        return { fired: exact, pending: false }
      }
      if (pending) {
        this.buffer = seq
        return { fired: null, pending: true }
      }
      return null
    }

    const withPrefix = attempt([...this.buffer, token])
    if (withPrefix) return withPrefix
    // The prefix led nowhere: try the key on its own so a mistyped chord
    // does not swallow the next real shortcut.
    const fresh = this.buffer.length ? attempt([token]) : null
    if (fresh) return fresh
    this.buffer = []
    return { fired: null, pending: false }
  }
}
