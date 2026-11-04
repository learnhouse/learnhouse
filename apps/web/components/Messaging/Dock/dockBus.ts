/**
 * Lets anything on the page (notifications, profile buttons) open a
 * conversation in the chat dock without importing it. Returns false when the
 * dock isn't mounted (the Messages page, phones), so callers can navigate.
 */

export const DOCK_OPEN_EVENT = 'lh-messaging:open-chat'

let mounted = 0

export function setDockMounted(on: boolean) {
  mounted = Math.max(0, mounted + (on ? 1 : -1))
}

export function openInDock(conversationUuid: string): boolean {
  if (!mounted || typeof window === 'undefined') return false
  // The dock is CSS-hidden below md, so phones go to the Messages page instead.
  if (!window.matchMedia('(min-width: 768px)').matches) return false
  window.dispatchEvent(new CustomEvent(DOCK_OPEN_EVENT, { detail: { conversationUuid } }))
  return true
}
