/* Quote block looks shared by its view and its loading fallback. */
import type { QuoteVariant } from '../mediaModel'

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')

export const QUOTE_FRAME: Record<QuoteVariant, string> = {
  pull: 'px-4 py-5 text-center sm:px-10',
  testimonial: 'rounded-2xl bg-white p-5 ring-1 ring-inset ring-neutral-200/80 sm:p-6',
  highlight: 'rounded-e-2xl border-s-4 border-amber-400 bg-amber-50/70 px-5 py-4',
}

export const QUOTE_TEXT: Record<QuoteVariant, string> = {
  pull: 'text-xl font-medium leading-snug text-neutral-800 sm:text-2xl [&_p]:my-1',
  testimonial: 'text-[17px] leading-relaxed text-neutral-800 [&_p]:my-1',
  highlight: 'text-[17px] leading-relaxed text-neutral-900 [&_p]:my-1',
}
