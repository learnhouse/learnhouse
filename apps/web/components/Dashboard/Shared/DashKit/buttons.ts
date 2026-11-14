// Button recipes, kept free of imports so any component (including the
// shared Modal, which DashKit itself imports) can use them without a cycle.

const BTN_BASE =
  'inline-flex items-center justify-center gap-1.5 font-medium whitespace-nowrap select-none transition-[background-color,box-shadow,color] duration-150 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20 focus-visible:ring-offset-2'

const BTN_VARIANTS = {
  // lh-t-btn: follows the org theme on learner pages (styles/theme.css), inert elsewhere.
  primary:
    'lh-t-btn text-white bg-neutral-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_1px_1px_rgba(0,0,0,0.08),0_0_0_1px_rgba(0,0,0,0.9)] hover:bg-neutral-800',
  secondary:
    'text-neutral-700 bg-white shadow-[0_1px_1px_rgba(0,0,0,0.03),0_0_0_1px_rgba(0,0,0,0.07)] hover:text-neutral-900 hover:bg-neutral-50',
  ghost:
    'text-neutral-600 bg-transparent hover:bg-neutral-100 hover:text-neutral-900',
  danger:
    'text-white bg-rose-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_1px_1px_rgba(159,18,57,0.12),0_0_0_1px_rgba(159,18,57,0.6)] hover:bg-rose-700',
  'danger-ghost':
    'text-rose-600 bg-transparent hover:bg-rose-50 hover:text-rose-700',
} as const

const BTN_SIZES = {
  sm: 'h-7 px-2.5 rounded-lg text-xs',
  md: 'h-8 px-3.5 rounded-xl text-[13px]',
  lg: 'h-9 px-4 rounded-xl text-sm',
  icon: 'h-7 w-7 rounded-lg text-xs',
} as const

export type ButtonVariant = keyof typeof BTN_VARIANTS
export type ButtonSize = keyof typeof BTN_SIZES

export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', extra = '') {
  return `${BTN_BASE} ${BTN_VARIANTS[variant]} ${BTN_SIZES[size]} ${extra}`
}
