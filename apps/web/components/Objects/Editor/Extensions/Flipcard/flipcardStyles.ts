/*
 Look of a flipcard: colour × style preset × size, plus the text sizing that
 keeps long answers inside the card. Pure (no React) so the node view, the
 grid and the tests share it.

 Backward compatibility: a card saved before the redesign has no `style`
 attr; 'solid' (the default) is the old look, a full colour fill with white
 text, and the stored colour keys keep their old meaning ('amber' was always
 drawn orange, 'yellow' amber). Colour names the AI tools write that the old
 picker never had ('orange', 'pink', 'violet'…) used to fall back to blue;
 they now map to the nearest real colour.

 Tailwind only sees literal class names, so every combination is spelled out.
*/

export type FlipcardStyle = 'solid' | 'soft' | 'outline'
export type FlipcardSize = 'small' | 'medium' | 'large'

export const FLIPCARD_STYLES: FlipcardStyle[] = ['solid', 'soft', 'outline']
export const FLIPCARD_SIZES: FlipcardSize[] = ['small', 'medium', 'large']

/** Picker order. Keys are what gets stored (unchanged from the old picker, plus pink). */
export const FLIPCARD_COLORS = ['blue', 'sky', 'indigo', 'purple', 'pink', 'red', 'amber', 'yellow', 'green', 'teal', 'neutral'] as const
export type FlipcardColor = (typeof FLIPCARD_COLORS)[number]

const ALIASES: Record<string, FlipcardColor> = {
  orange: 'amber',
  violet: 'purple',
  fuchsia: 'pink',
  rose: 'pink',
  cyan: 'sky',
  emerald: 'green',
  lime: 'green',
  gray: 'neutral',
  grey: 'neutral',
  slate: 'neutral',
  zinc: 'neutral',
  stone: 'neutral',
  black: 'neutral',
}

export function resolveFlipcardColor(raw: unknown): FlipcardColor {
  const key = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if ((FLIPCARD_COLORS as readonly string[]).includes(key)) return key as FlipcardColor
  return ALIASES[key] ?? 'blue'
}

export function resolveFlipcardStyle(raw: unknown): FlipcardStyle {
  return raw === 'soft' || raw === 'outline' ? raw : 'solid'
}

export function resolveFlipcardSize(raw: unknown): FlipcardSize {
  return raw === 'small' || raw === 'large' ? raw : 'medium'
}

interface Faces {
  front: string
  back: string
  /** Swatch for pickers. */
  swatch: string
  /** Accent text on light faces (hint line, icon). */
  accent: string
}

// solid: the original card (fill + darker 2px border). soft: tinted face, coloured ink.
// outline: white face, coloured edge. The node view adds `border-2`.
const PALETTE: Record<FlipcardColor, Record<FlipcardStyle, Faces>> = {
  blue: {
    solid: { front: 'bg-blue-500 text-white border-blue-600', back: 'bg-blue-600 text-white border-blue-700', swatch: 'bg-blue-500', accent: 'text-white/75' },
    soft: { front: 'bg-blue-50 text-blue-950 border-blue-200', back: 'bg-blue-100 text-blue-950 border-blue-200', swatch: 'bg-blue-500', accent: 'text-blue-600' },
    outline: { front: 'bg-white text-neutral-900 border-blue-400', back: 'bg-blue-50 text-blue-950 border-blue-400', swatch: 'bg-blue-500', accent: 'text-blue-600' },
  },
  sky: {
    solid: { front: 'bg-sky-500 text-white border-sky-600', back: 'bg-sky-600 text-white border-sky-700', swatch: 'bg-sky-500', accent: 'text-white/75' },
    soft: { front: 'bg-sky-50 text-sky-950 border-sky-200', back: 'bg-sky-100 text-sky-950 border-sky-200', swatch: 'bg-sky-500', accent: 'text-sky-600' },
    outline: { front: 'bg-white text-neutral-900 border-sky-400', back: 'bg-sky-50 text-sky-950 border-sky-400', swatch: 'bg-sky-500', accent: 'text-sky-600' },
  },
  indigo: {
    solid: { front: 'bg-indigo-500 text-white border-indigo-600', back: 'bg-indigo-600 text-white border-indigo-700', swatch: 'bg-indigo-500', accent: 'text-white/75' },
    soft: { front: 'bg-indigo-50 text-indigo-950 border-indigo-200', back: 'bg-indigo-100 text-indigo-950 border-indigo-200', swatch: 'bg-indigo-500', accent: 'text-indigo-600' },
    outline: { front: 'bg-white text-neutral-900 border-indigo-400', back: 'bg-indigo-50 text-indigo-950 border-indigo-400', swatch: 'bg-indigo-500', accent: 'text-indigo-600' },
  },
  purple: {
    solid: { front: 'bg-purple-500 text-white border-purple-600', back: 'bg-purple-600 text-white border-purple-700', swatch: 'bg-purple-500', accent: 'text-white/75' },
    soft: { front: 'bg-purple-50 text-purple-950 border-purple-200', back: 'bg-purple-100 text-purple-950 border-purple-200', swatch: 'bg-purple-500', accent: 'text-purple-600' },
    outline: { front: 'bg-white text-neutral-900 border-purple-400', back: 'bg-purple-50 text-purple-950 border-purple-400', swatch: 'bg-purple-500', accent: 'text-purple-600' },
  },
  pink: {
    solid: { front: 'bg-pink-500 text-white border-pink-600', back: 'bg-pink-600 text-white border-pink-700', swatch: 'bg-pink-500', accent: 'text-white/75' },
    soft: { front: 'bg-pink-50 text-pink-950 border-pink-200', back: 'bg-pink-100 text-pink-950 border-pink-200', swatch: 'bg-pink-500', accent: 'text-pink-600' },
    outline: { front: 'bg-white text-neutral-900 border-pink-400', back: 'bg-pink-50 text-pink-950 border-pink-400', swatch: 'bg-pink-500', accent: 'text-pink-600' },
  },
  red: {
    solid: { front: 'bg-red-500 text-white border-red-600', back: 'bg-red-600 text-white border-red-700', swatch: 'bg-red-500', accent: 'text-white/75' },
    soft: { front: 'bg-red-50 text-red-950 border-red-200', back: 'bg-red-100 text-red-950 border-red-200', swatch: 'bg-red-500', accent: 'text-red-600' },
    outline: { front: 'bg-white text-neutral-900 border-red-400', back: 'bg-red-50 text-red-950 border-red-400', swatch: 'bg-red-500', accent: 'text-red-600' },
  },
  // Stored as 'amber', drawn orange (as the old block did).
  amber: {
    solid: { front: 'bg-orange-500 text-white border-orange-600', back: 'bg-orange-600 text-white border-orange-700', swatch: 'bg-orange-500', accent: 'text-white/75' },
    soft: { front: 'bg-orange-50 text-orange-950 border-orange-200', back: 'bg-orange-100 text-orange-950 border-orange-200', swatch: 'bg-orange-500', accent: 'text-orange-600' },
    outline: { front: 'bg-white text-neutral-900 border-orange-400', back: 'bg-orange-50 text-orange-950 border-orange-400', swatch: 'bg-orange-500', accent: 'text-orange-600' },
  },
  // Stored as 'yellow', drawn amber (as the old block did).
  yellow: {
    solid: { front: 'bg-amber-500 text-white border-amber-600', back: 'bg-amber-600 text-white border-amber-700', swatch: 'bg-amber-500', accent: 'text-white/75' },
    soft: { front: 'bg-amber-50 text-amber-950 border-amber-200', back: 'bg-amber-100 text-amber-950 border-amber-200', swatch: 'bg-amber-500', accent: 'text-amber-600' },
    outline: { front: 'bg-white text-neutral-900 border-amber-400', back: 'bg-amber-50 text-amber-950 border-amber-400', swatch: 'bg-amber-500', accent: 'text-amber-600' },
  },
  green: {
    solid: { front: 'bg-emerald-500 text-white border-emerald-600', back: 'bg-emerald-600 text-white border-emerald-700', swatch: 'bg-emerald-500', accent: 'text-white/75' },
    soft: { front: 'bg-emerald-50 text-emerald-950 border-emerald-200', back: 'bg-emerald-100 text-emerald-950 border-emerald-200', swatch: 'bg-emerald-500', accent: 'text-emerald-600' },
    outline: { front: 'bg-white text-neutral-900 border-emerald-400', back: 'bg-emerald-50 text-emerald-950 border-emerald-400', swatch: 'bg-emerald-500', accent: 'text-emerald-600' },
  },
  teal: {
    solid: { front: 'bg-teal-500 text-white border-teal-600', back: 'bg-teal-600 text-white border-teal-700', swatch: 'bg-teal-500', accent: 'text-white/75' },
    soft: { front: 'bg-teal-50 text-teal-950 border-teal-200', back: 'bg-teal-100 text-teal-950 border-teal-200', swatch: 'bg-teal-500', accent: 'text-teal-600' },
    outline: { front: 'bg-white text-neutral-900 border-teal-400', back: 'bg-teal-50 text-teal-950 border-teal-400', swatch: 'bg-teal-500', accent: 'text-teal-600' },
  },
  neutral: {
    solid: { front: 'bg-neutral-600 text-white border-neutral-700', back: 'bg-neutral-700 text-white border-neutral-800', swatch: 'bg-neutral-600', accent: 'text-white/75' },
    soft: { front: 'bg-neutral-100 text-neutral-900 border-neutral-200', back: 'bg-neutral-200/70 text-neutral-900 border-neutral-300', swatch: 'bg-neutral-600', accent: 'text-neutral-500' },
    outline: { front: 'bg-white text-neutral-900 border-neutral-400', back: 'bg-neutral-50 text-neutral-900 border-neutral-400', swatch: 'bg-neutral-600', accent: 'text-neutral-500' },
  },
}

export function flipcardFaces(color: unknown, style: unknown): Faces {
  return PALETTE[resolveFlipcardColor(color)][resolveFlipcardStyle(style)]
}

/** Width × height of a standalone card (unchanged from the old block). */
export const SIZE_BOX: Record<FlipcardSize, { w: string; h: string }> = {
  small: { w: 'w-64', h: 'h-36' },
  medium: { w: 'w-80', h: 'h-48' },
  large: { w: 'w-96', h: 'h-60' },
}

/**
 * Text size for a face: the card size sets the base, long text steps down so
 * it stays inside the fixed-height card instead of spilling out of it.
 */
export function faceTextClass(text: string, size: FlipcardSize): string {
  const len = (text || '').trim().length
  // Short text keeps the original sizes; long text steps down so it stays
  // inside the fixed-height card instead of spilling out of it.
  if (len > 160) return 'text-xs leading-snug'
  if (len > 90) return size === 'large' ? 'text-base leading-snug' : 'text-sm leading-snug'
  return size === 'small' ? 'text-sm leading-relaxed' : size === 'large' ? 'text-xl leading-relaxed' : 'text-lg leading-relaxed'
}
