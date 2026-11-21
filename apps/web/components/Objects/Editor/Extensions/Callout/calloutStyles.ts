/*
 Colour tones a callout can take instead of its type's own colours (the
 `tone` attr, Editor Plus). Keys match the text colour palette. A callout
 without a tone keeps its type's colours, so older callouts look the same.

 Pure module: imported by CalloutComponent.tsx and the tests.
*/
export const CALLOUT_TONES = {
  gray: { bg: 'bg-neutral-100', text: 'text-neutral-800', iconColor: 'text-neutral-500', ring: 'ring-neutral-200', swatch: 'bg-neutral-300' },
  red: { bg: 'bg-red-50', text: 'text-red-950', iconColor: 'text-red-500', ring: 'ring-red-200', swatch: 'bg-red-300' },
  orange: { bg: 'bg-orange-50', text: 'text-orange-950', iconColor: 'text-orange-500', ring: 'ring-orange-200', swatch: 'bg-orange-300' },
  amber: { bg: 'bg-amber-50', text: 'text-amber-950', iconColor: 'text-amber-500', ring: 'ring-amber-200', swatch: 'bg-amber-300' },
  green: { bg: 'bg-green-50', text: 'text-green-950', iconColor: 'text-green-600', ring: 'ring-green-200', swatch: 'bg-green-300' },
  teal: { bg: 'bg-teal-50', text: 'text-teal-950', iconColor: 'text-teal-500', ring: 'ring-teal-200', swatch: 'bg-teal-300' },
  blue: { bg: 'bg-blue-50', text: 'text-blue-950', iconColor: 'text-blue-500', ring: 'ring-blue-200', swatch: 'bg-blue-300' },
  purple: { bg: 'bg-purple-50', text: 'text-purple-950', iconColor: 'text-purple-500', ring: 'ring-purple-200', swatch: 'bg-purple-300' },
  pink: { bg: 'bg-pink-50', text: 'text-pink-950', iconColor: 'text-pink-500', ring: 'ring-pink-200', swatch: 'bg-pink-300' },
} as const

export type CalloutTone = keyof typeof CALLOUT_TONES

/** The stored tone when it is one we know; null (the type's colours) otherwise. */
export function calloutToneOf(raw: unknown): CalloutTone | null {
  return typeof raw === 'string' && raw in CALLOUT_TONES ? (raw as CalloutTone) : null
}

/** Every callout look an author can pick, the five original types first. */
export const CALLOUT_TYPE_IDS = ['info', 'warning', 'tip', 'success', 'error', 'note', 'question', 'example', 'quote'] as const
export type CalloutStyleId = (typeof CALLOUT_TYPE_IDS)[number]

/**
 * The only values ever written to `type`. Published renderers
 * (@learnhouse/react 1.4.x, the mobile app) look `type` up in a table of these
 * five and crash on anything else, so the Editor Plus kinds live in `kind`.
 */
export const LEGACY_CALLOUT_TYPES = ['info', 'warning', 'tip', 'success', 'error'] as const
export type LegacyCalloutType = (typeof LEGACY_CALLOUT_TYPES)[number]

export const CALLOUT_KINDS = ['note', 'question', 'example', 'quote'] as const
export type CalloutKind = (typeof CALLOUT_KINDS)[number]

/** What an older client shows for each kind (stored in `type` next to `kind`). */
export const CALLOUT_KIND_FALLBACK: Record<CalloutKind, LegacyCalloutType> = {
  note: 'info',
  question: 'info',
  example: 'tip',
  quote: 'info',
}

export function isLegacyCalloutType(v: unknown): v is LegacyCalloutType {
  return typeof v === 'string' && (LEGACY_CALLOUT_TYPES as readonly string[]).includes(v)
}

export function isCalloutKind(v: unknown): v is CalloutKind {
  return typeof v === 'string' && (CALLOUT_KINDS as readonly string[]).includes(v)
}

/** The look a callout shows: `kind` first, then `type` (unknown → info). */
export function calloutStyleOf(attrs: any): CalloutStyleId {
  if (isCalloutKind(attrs?.kind)) return attrs.kind
  const t = attrs?.type
  // A kind written straight into `type` (an old import or AI edit) still shows as that kind.
  if (isLegacyCalloutType(t) || isCalloutKind(t)) return t
  return 'info'
}

/** The attrs the editor writes for a picked look: `type` always stays legacy. */
export function calloutAttrsFor(style: CalloutStyleId): { type: LegacyCalloutType; kind: CalloutKind | null } {
  if (isCalloutKind(style)) return { type: CALLOUT_KIND_FALLBACK[style], kind: style }
  return { type: isLegacyCalloutType(style) ? style : 'info', kind: null }
}
