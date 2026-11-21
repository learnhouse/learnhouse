/*
 Classes of the button block for each color, variant and size.

 `solid` + `md` (what every button stored before these options gets) is
 exactly the original look: the same color classes as the old
 getButtonColor() and the same padding and rounding. Tailwind needs every
 class spelled out, hence the tables.

 Pure module: imported by ButtonsExtension.tsx and the tests.
*/
import type { ButtonSize, ButtonVariant } from '../../Blocks/schema/blockAttrs'

export const BUTTON_COLORS = ['blue', 'sky', 'indigo', 'purple', 'teal', 'green', 'amber', 'yellow', 'red', 'neutral'] as const
export type ButtonColor = (typeof BUTTON_COLORS)[number]

const SOLID: Record<ButtonColor, string> = {
  blue: 'bg-blue-500 hover:bg-blue-600',
  sky: 'bg-sky-500 hover:bg-sky-600',
  indigo: 'bg-indigo-500 hover:bg-indigo-600',
  purple: 'bg-purple-500 hover:bg-purple-600',
  teal: 'bg-teal-500 hover:bg-teal-600',
  green: 'bg-green-500 hover:bg-green-600',
  amber: 'bg-amber-500 hover:bg-amber-600',
  yellow: 'bg-yellow-500 hover:bg-yellow-600',
  red: 'bg-red-500 hover:bg-red-600',
  neutral: 'bg-neutral-500 hover:bg-neutral-600',
}

const OUTLINE: Record<ButtonColor, string> = {
  blue: 'text-blue-600 ring-2 ring-inset ring-blue-500 hover:bg-blue-50',
  sky: 'text-sky-600 ring-2 ring-inset ring-sky-500 hover:bg-sky-50',
  indigo: 'text-indigo-600 ring-2 ring-inset ring-indigo-500 hover:bg-indigo-50',
  purple: 'text-purple-600 ring-2 ring-inset ring-purple-500 hover:bg-purple-50',
  teal: 'text-teal-600 ring-2 ring-inset ring-teal-500 hover:bg-teal-50',
  green: 'text-green-600 ring-2 ring-inset ring-green-500 hover:bg-green-50',
  amber: 'text-amber-600 ring-2 ring-inset ring-amber-500 hover:bg-amber-50',
  yellow: 'text-yellow-700 ring-2 ring-inset ring-yellow-500 hover:bg-yellow-50',
  red: 'text-red-600 ring-2 ring-inset ring-red-500 hover:bg-red-50',
  neutral: 'text-neutral-700 ring-2 ring-inset ring-neutral-500 hover:bg-neutral-50',
}

const SOFT: Record<ButtonColor, string> = {
  blue: 'bg-blue-100 text-blue-800 hover:bg-blue-200',
  sky: 'bg-sky-100 text-sky-800 hover:bg-sky-200',
  indigo: 'bg-indigo-100 text-indigo-800 hover:bg-indigo-200',
  purple: 'bg-purple-100 text-purple-800 hover:bg-purple-200',
  teal: 'bg-teal-100 text-teal-800 hover:bg-teal-200',
  green: 'bg-green-100 text-green-800 hover:bg-green-200',
  amber: 'bg-amber-100 text-amber-800 hover:bg-amber-200',
  yellow: 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200',
  red: 'bg-red-100 text-red-800 hover:bg-red-200',
  neutral: 'bg-neutral-100 text-neutral-800 hover:bg-neutral-200',
}

const LINK: Record<ButtonColor, string> = {
  blue: 'text-blue-600 hover:text-blue-700',
  sky: 'text-sky-600 hover:text-sky-700',
  indigo: 'text-indigo-600 hover:text-indigo-700',
  purple: 'text-purple-600 hover:text-purple-700',
  teal: 'text-teal-600 hover:text-teal-700',
  green: 'text-green-600 hover:text-green-700',
  amber: 'text-amber-600 hover:text-amber-700',
  yellow: 'text-yellow-700 hover:text-yellow-800',
  red: 'text-red-600 hover:text-red-700',
  neutral: 'text-neutral-700 hover:text-neutral-900',
}

const SIZE: Record<ButtonSize, string> = {
  sm: 'py-1 px-3 text-sm rounded-lg',
  md: 'py-2 px-4 rounded-xl',
  lg: 'py-3 px-6 text-lg rounded-2xl',
}

// The link variant keeps the text size of its size but drops the box.
const LINK_SIZE: Record<ButtonSize, string> = {
  sm: 'py-0.5 text-sm',
  md: 'py-1',
  lg: 'py-1.5 text-lg',
}

export function buttonColorOf(color: unknown): ButtonColor {
  return (BUTTON_COLORS as readonly string[]).includes(color as string) ? (color as ButtonColor) : 'blue'
}

/** The old getButtonColor(), kept for the color swatches. */
export function solidColorClasses(color: unknown): string {
  return SOLID[buttonColorOf(color)]
}

/** Color + shape classes of the button face (layout classes are added by the caller). */
export function buttonFaceClasses(color: unknown, variant: ButtonVariant, size: ButtonSize): string {
  const c = buttonColorOf(color)
  switch (variant) {
    case 'outline':
      return `${SIZE[size]} bg-transparent ${OUTLINE[c]}`
    case 'soft':
      return `${SIZE[size]} ${SOFT[c]}`
    case 'link':
      return `${LINK_SIZE[size]} px-0 rounded-none bg-transparent underline-offset-4 hover:underline ${LINK[c]}`
    default:
      return `${SIZE[size]} text-white ${SOLID[c]}`
  }
}
