/**
 * DOM helpers for keyboard list navigation. Any element carrying
 * `data-kbd-item` is a stop; `data-kbd-active` marks the current one and is
 * what the stylesheet draws the focus ring on. Kept out of React so the
 * same logic serves every catalog page.
 */

export const ITEM_SELECTOR = '[data-kbd-item]'
export const ACTIVE_ATTR = 'data-kbd-active'

export function listItems(root: Document | Element = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(ITEM_SELECTOR)).filter(
    // offsetParent is null for display:none subtrees (collapsed sections, hidden tabs).
    (el) => el.offsetParent !== null,
  )
}

export function activeItem(root: Document | Element = document): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[${ACTIVE_ATTR}]`)
}

export function clearActive(root: Document | Element = document): void {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(`[${ACTIVE_ATTR}]`))) {
    el.removeAttribute(ACTIVE_ATTR)
  }
}

/** The index to land on after a step; wraps nothing, clamps at the ends. */
export function nextIndex(current: number, delta: 1 | -1, count: number): number {
  if (count === 0) return -1
  if (current < 0) return delta > 0 ? 0 : count - 1
  return Math.min(count - 1, Math.max(0, current + delta))
}

export function moveActive(delta: 1 | -1, root: Document | Element = document): HTMLElement | null {
  const items = listItems(root)
  const current = activeItem(root)
  const index = nextIndex(current ? items.indexOf(current) : -1, delta, items.length)
  if (index < 0) return null
  const target = items[index]
  if (target === current) return current
  clearActive(root)
  target.setAttribute(ACTIVE_ATTR, '')
  target.scrollIntoView({ block: 'nearest' })
  const focusable = target.matches('a[href], button')
    ? target
    : target.querySelector<HTMLElement>('a[href], button')
  focusable?.focus({ preventScroll: true })
  return target
}

/** Activate the current item: its own link if it is one, else the first link inside, else itself. */
export function openActive(root: Document | Element = document): boolean {
  const current = activeItem(root)
  if (!current) return false
  const link = current.matches('a[href]') ? current : current.querySelector<HTMLElement>('a[href]')
  ;(link ?? current).click()
  return true
}
