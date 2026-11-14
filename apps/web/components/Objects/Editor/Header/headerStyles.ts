// Editor header controls: one look for every control right of the toolbar,
// matching the formatting toolbar (h-8, rounded-lg, 13px text, 16px icons)
// with the DashKit secondary relief (white, hairline ring).

export const HEADER_ICON = 16

export const HBTN =
  'inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-white px-2 sm:px-2.5 text-[13px] font-medium text-neutral-700 shadow-[0_1px_1px_rgba(0,0,0,0.03),0_0_0_1px_rgba(0,0,0,0.07)] transition-colors outline-none hover:bg-neutral-50 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-900/15 disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-neutral-50 data-[state=open]:text-neutral-900'

export const HMENU =
  'rounded-xl bg-white p-1 text-[13px] text-neutral-700 shadow-[0_12px_32px_rgba(0,0,0,0.1),0_0_0_1px_rgba(0,0,0,0.08)] outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0'

export const HMENU_ITEM =
  'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-start transition-colors outline-none hover:bg-neutral-100 focus-visible:bg-neutral-100 disabled:pointer-events-none disabled:opacity-50'

/** Text that only shows from the sm breakpoint; the button keeps its icon and a tooltip below it. */
export const HLABEL = 'hidden sm:inline'

/**
 * Icon-only header button: the formatting toolbar's button look (white,
 * soft shadow, hairline outline) at h-8 w-8.
 */
export const HICON =
  'relative inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-white text-neutral-500 shadow-[0_4px_6px_-1px_rgba(209,213,219,0.25),0_2px_4px_-2px_rgba(209,213,219,0.25)] outline outline-1 outline-gray-200/40 transition-colors hover:bg-neutral-50 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-neutral-900/25 disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-neutral-100 data-[state=open]:text-neutral-800'

/** Small count on an icon button (Comments). */
export const HBADGE =
  'pointer-events-none absolute -top-1 -end-1 min-w-4 rounded-full bg-amber-500 px-1 text-center text-[10px] font-semibold leading-4 text-white tabular-nums ring-2 ring-white'
