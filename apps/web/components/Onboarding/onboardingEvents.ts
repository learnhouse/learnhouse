'use client'
import type { InviteTab } from './InviteDialog'

// The invite dialog is mounted once, by the onboarding
// tracker in the dashboard layout; anything on the page opens it with these.
const INVITE_EVENT = 'lh:open-invite-dialog'

export function openInviteDialog(tab: InviteTab = 'link') {
  window.dispatchEvent(new CustomEvent(INVITE_EVENT, { detail: { tab } }))
}

export function onOpenInviteDialog(handler: (_tab: InviteTab) => void) {
  const listener = (e: Event) => handler((e as CustomEvent).detail?.tab ?? 'link')
  window.addEventListener(INVITE_EVENT, listener)
  return () => window.removeEventListener(INVITE_EVENT, listener)
}
