/**
 * Brand colors from a logo: the theme studio's "Import from logo".
 *
 * Pure (no DOM): the caller draws the logo on a canvas and passes its RGBA
 * pixels. Colors are bucketed (4 bits per channel), transparent pixels and the
 * near-white / near-black background are ignored, and buckets are ranked by
 * how often they appear weighted by saturation, so the brand mark wins over
 * the anti-aliased edge. The second color must be clearly different (hue or
 * lightness) from the first, or it is left out.
 */
import { contrastRatio, mixHex, relativeLuminance } from './orgTheme'

export interface LogoPalette {
  /** The dominant brand color, or '' when the logo is only black/white/grey. */
  primary: string
  /** A clearly different second color, or ''. */
  secondary: string
  /** Every candidate, most prominent first (for swatches). */
  swatches: string[]
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`
}

function hsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0)
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  return { h: h * 60, s, l }
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

export function extractLogoPalette(data: ArrayLike<number>, maxSwatches = 6): LogoPalette {
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>()
  for (let i = 0; i + 3 < data.length; i += 4) {
    const a = data[i + 3]
    if (a < 160) continue
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const cur = buckets.get(key)
    if (cur) {
      cur.r += r
      cur.g += g
      cur.b += b
      cur.n += 1
    } else buckets.set(key, { r, g, b, n: 1 })
  }
  const candidates = Array.from(buckets.values())
    .map((x) => {
      const r = x.r / x.n
      const g = x.g / x.n
      const b = x.b / x.n
      const c = hsl(r, g, b)
      return { hex: toHex(r, g, b), n: x.n, ...c }
    })
    // Backgrounds and outlines: near white, near black, or grey.
    .filter((c) => c.l > 0.08 && c.l < 0.94 && c.s > 0.18)
    .map((c) => ({ ...c, score: c.n * (0.35 + c.s) }))
    .sort((a, b) => b.score - a.score)

  const picked: typeof candidates = []
  for (const c of candidates) {
    if (picked.every((p) => hueDistance(p.h, c.h) > 18 || Math.abs(p.l - c.l) > 0.22)) picked.push(c)
    if (picked.length >= maxSwatches) break
  }
  const primary = picked[0]?.hex || ''
  const second = picked.find((c, i) => i > 0 && (hueDistance(c.h, picked[0].h) > 30 || Math.abs(c.l - picked[0].l) > 0.25))
  return { primary, secondary: second?.hex || '', swatches: picked.map((p) => p.hex) }
}

/**
 * A brand color that works as a button fill on white: very light logo colors
 * are deepened until white text reads on them (AA large text, 3:1).
 */
export function usableBrandColor(hex: string): string {
  if (!hex) return ''
  let out = hex
  for (let i = 0; i < 12 && contrastRatio(out, '#ffffff') < 3; i++) out = mixHex(out, '#000000', 0.12)
  // Almost-black logos stay as they are: they are deliberate.
  return relativeLuminance(hex) < 0.02 ? hex : out
}
