/*
 Pure helpers shared by every Experiences block (no React, safe in tests and
 on the server).
*/

function randomHex(length: number): string {
  try {
    const c = (globalThis as { crypto?: Crypto }).crypto
    if (c?.randomUUID) return c.randomUUID().replace(/-/g, '').slice(0, length)
    if (c?.getRandomValues) {
      const bytes = c.getRandomValues(new Uint8Array(Math.ceil(length / 2)))
      return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, length)
    }
  } catch {
    // fall through
  }
  let out = ''
  while (out.length < length) out += Math.random().toString(16).slice(2)
  return out.slice(0, length)
}

/** Short id for items inside a block (cards, pairs, spots…). 10 hex chars. */
export function newId(): string {
  return randomHex(10)
}

/** Full uuid v4 for a block's `blockId` attr. */
export function newBlockId(): string {
  try {
    const c = (globalThis as { crypto?: Crypto }).crypto
    if (c?.randomUUID) return c.randomUUID()
  } catch {
    // fall through
  }
  const h = randomHex(32)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`
}

/**
 * Fisher-Yates shuffle into a new array. With more than one item the result
 * is never the original order (by position), so a learner never gets the
 * answer handed to them. The input array is not touched.
 */
export function shuffle<T>(arr: readonly T[], random: () => number = Math.random): T[] {
  const n = arr.length
  const idx = Array.from({ length: n }, (_, i) => i)
  if (n < 2) return idx.map((i) => arr[i])
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[idx[i], idx[j]] = [idx[j], idx[i]]
  }
  if (idx.every((v, i) => v === i)) {
    // Identity permutation: rotate by one so every item moves.
    idx.push(idx.shift() as number)
  }
  return idx.map((i) => arr[i])
}

/** 0–3 stars from a ratio (0..1). 100% → 3, ≥ 70% → 2, ≥ 40% → 1. */
export function starsFromRatio(ratio: number): 0 | 1 | 2 | 3 {
  if (!Number.isFinite(ratio)) return 0
  if (ratio >= 0.999) return 3
  if (ratio >= 0.7) return 2
  if (ratio >= 0.4) return 1
  return 0
}

/** Trimmed, case-insensitive, whitespace-collapsed comparison for typed answers. */
export function normalizeAnswer(value: unknown, caseSensitive = false): string {
  const s = String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
  return caseSensitive ? s : s.toLocaleLowerCase()
}

export function answersMatch(given: unknown, expected: unknown, caseSensitive = false): boolean {
  const g = normalizeAnswer(given, caseSensitive)
  return g.length > 0 && g === normalizeAnswer(expected, caseSensitive)
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/** Array attr read defensively (old or AI-written content may hold anything). */
export function asArray<T = unknown>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[]
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? (parsed as T[]) : []
    } catch {
      return []
    }
  }
  return []
}

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : value == null ? fallback : String(value)
}

export function asNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}
