// Pure logic for the Hotspot experience. No React, no DOM: the view and the
// bun tests both import this file.
//
// Coordinates: x and y are percentages of the image width and height, r is a
// percentage of the image WIDTH. Spots are drawn as circles (aspect-ratio 1),
// so a hit test needs the image aspect (height / width) to convert y.

import { newId } from '../shared/utils'

export type HotspotMode = 'find' | 'explore'

export interface HotspotSpot {
  id: string
  x: number
  y: number
  r: number
  label: string
  explanation?: string
  correct: boolean
}

export interface HotspotAttrs {
  blockId: string
  title: string
  instructions: string
  imageUrl: string
  mode: HotspotMode
  spots: HotspotSpot[]
}

export const MIN_RADIUS = 2
export const MAX_RADIUS = 25
export const DEFAULT_RADIUS = 7
export const MAX_SPOTS = 20

type Translate = (_key: string, _options?: Record<string, unknown>) => string

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** Coerce anything stored in the attrs into a valid spot list. */
export function normalizeSpots(raw: unknown): HotspotSpot[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: HotspotSpot[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const s = item as Record<string, unknown>
    let id = typeof s.id === 'string' && s.id ? s.id : newId()
    while (seen.has(id)) id = newId()
    seen.add(id)
    out.push({
      id,
      x: round2(clamp(Number(s.x), 0, 100)),
      y: round2(clamp(Number(s.y), 0, 100)),
      r: round2(clamp(Number(s.r ?? DEFAULT_RADIUS), MIN_RADIUS, MAX_RADIUS)),
      label: typeof s.label === 'string' ? s.label : '',
      explanation: typeof s.explanation === 'string' ? s.explanation : '',
      correct: s.correct !== false,
    })
    if (out.length >= MAX_SPOTS) break
  }
  return out
}

export function normalizeMode(raw: unknown): HotspotMode {
  return raw === 'explore' ? 'explore' : 'find'
}

/** Distance from a point to a spot centre, in "% of width" units. */
export function distanceTo(spot: HotspotSpot, x: number, y: number, aspect = 1): number {
  const dx = x - spot.x
  const dy = (y - spot.y) * (aspect > 0 ? aspect : 1)
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * The spot under a point, or null. When spots overlap, the one whose centre is
 * closest (relative to its radius) wins. `skip` ignores already-found spots.
 */
export function hitTest(
  spots: HotspotSpot[],
  x: number,
  y: number,
  aspect = 1,
  skip: ReadonlySet<string> = new Set(),
): HotspotSpot | null {
  let best: HotspotSpot | null = null
  let bestRatio = Infinity
  for (const spot of spots) {
    if (skip.has(spot.id)) continue
    const ratio = distanceTo(spot, x, y, aspect) / Math.max(spot.r, 0.0001)
    if (ratio <= 1 && ratio < bestRatio) {
      best = spot
      bestRatio = ratio
    }
  }
  return best
}

/** A gentle hint after a miss: "close" when within twice a target's radius. */
export function missHint(
  spots: HotspotSpot[],
  found: ReadonlySet<string>,
  x: number,
  y: number,
  aspect = 1,
): 'close' | 'far' {
  for (const spot of targetSpots(spots)) {
    if (found.has(spot.id)) continue
    if (distanceTo(spot, x, y, aspect) <= spot.r * 2) return 'close'
  }
  return 'far'
}

/** The spots a learner has to find. */
export function targetSpots(spots: HotspotSpot[]): HotspotSpot[] {
  return spots.filter((s) => s.correct !== false)
}

export function isComplete(spots: HotspotSpot[], found: ReadonlySet<string>): boolean {
  const targets = targetSpots(spots)
  return targets.length > 0 && targets.every((s) => found.has(s.id))
}

/** Stars in find mode come from misses: none is 3, up to half the targets is 2. */
export function starsForMisses(misses: number, targets: number): 0 | 1 | 2 | 3 {
  if (targets <= 0) return 0
  if (misses <= 0) return 3
  if (misses <= Math.max(1, Math.ceil(targets / 2))) return 2
  return 1
}

export function addSpot(spots: HotspotSpot[], x: number, y: number, label = ''): HotspotSpot[] {
  if (spots.length >= MAX_SPOTS) return spots
  return [
    ...spots,
    {
      id: newId(),
      x: round2(clamp(x, 0, 100)),
      y: round2(clamp(y, 0, 100)),
      r: DEFAULT_RADIUS,
      label,
      explanation: '',
      correct: true,
    },
  ]
}

export function moveSpot(spots: HotspotSpot[], id: string, x: number, y: number): HotspotSpot[] {
  return spots.map((s) =>
    s.id === id ? { ...s, x: round2(clamp(x, 0, 100)), y: round2(clamp(y, 0, 100)) } : s,
  )
}

/** Keyboard nudge for a spot (arrow keys). dx/dy are in percentage points. */
export function nudgeSpot(spots: HotspotSpot[], id: string, dx: number, dy: number): HotspotSpot[] {
  const spot = spots.find((s) => s.id === id)
  if (!spot) return spots
  return moveSpot(spots, id, spot.x + dx, spot.y + dy)
}

export function updateSpot(
  spots: HotspotSpot[],
  id: string,
  patch: Partial<Omit<HotspotSpot, 'id'>>,
): HotspotSpot[] {
  return spots.map((s) => {
    if (s.id !== id) return s
    const next = { ...s, ...patch }
    next.x = round2(clamp(next.x, 0, 100))
    next.y = round2(clamp(next.y, 0, 100))
    next.r = round2(clamp(next.r, MIN_RADIUS, MAX_RADIUS))
    return next
  })
}

export function removeSpot(spots: HotspotSpot[], id: string): HotspotSpot[] {
  return spots.filter((s) => s.id !== id)
}

/** Convert a pointer position inside a rect into image percentages. */
export function pointToPercent(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  if (rect.width <= 0 || rect.height <= 0) return { x: 50, y: 50 }
  return {
    x: round2(clamp(((clientX - rect.left) / rect.width) * 100, 0, 100)),
    y: round2(clamp(((clientY - rect.top) / rect.height) * 100, 0, 100)),
  }
}

export type HotspotIssue =
  | { kind: 'noImage' }
  | { kind: 'noSpots' }
  | { kind: 'missingLabel'; spotIndex: number }
  | { kind: 'overlap'; a: number; b: number }

/** Inline hints for the author. Never blocking. */
export function validateHotspot(attrs: Pick<HotspotAttrs, 'imageUrl' | 'spots'>): HotspotIssue[] {
  const issues: HotspotIssue[] = []
  if (!attrs.imageUrl) issues.push({ kind: 'noImage' })
  if (attrs.spots.length === 0) issues.push({ kind: 'noSpots' })
  attrs.spots.forEach((s, i) => {
    if (!s.label.trim()) issues.push({ kind: 'missingLabel', spotIndex: i })
  })
  for (let i = 0; i < attrs.spots.length; i++) {
    for (let j = i + 1; j < attrs.spots.length; j++) {
      const a = attrs.spots[i]
      const b = attrs.spots[j]
      if (distanceTo(a, b.x, b.y) < Math.max(a.r, b.r)) issues.push({ kind: 'overlap', a: i, b: j })
    }
  }
  return issues
}

/** A filled-in example that works before any image is uploaded. */
export function defaultHotspotContent(t: Translate): Omit<HotspotAttrs, 'blockId'> {
  return {
    title: t('editor.experiences.hotspot.example.title'),
    instructions: t('editor.experiences.hotspot.example.instructions'),
    imageUrl: '',
    mode: 'find',
    spots: [
      {
        id: newId(),
        x: 28,
        y: 38,
        r: 9,
        label: t('editor.experiences.hotspot.example.spot1_label'),
        explanation: t('editor.experiences.hotspot.example.spot1_explanation'),
        correct: true,
      },
      {
        id: newId(),
        x: 70,
        y: 62,
        r: 9,
        label: t('editor.experiences.hotspot.example.spot2_label'),
        explanation: t('editor.experiences.hotspot.example.spot2_explanation'),
        correct: true,
      },
    ],
  }
}
