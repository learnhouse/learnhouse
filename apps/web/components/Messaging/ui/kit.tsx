'use client'

import React from 'react'
import { buttonClass } from '@components/Dashboard/Shared/DashKit/buttons'
import { Tooltip, TooltipContent, TooltipTrigger } from '@components/ui/tooltip'

// Small pieces shared by the Messages page, the thread and the chat dock so
// they read as one app.

/** A square ghost icon button with a tooltip; the tooltip doubles as its label. */
export const IconButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; size?: 'sm' | 'md' }
>(function IconButton({ label, active, size = 'md', className = '', children, type = 'button', ...rest }, ref) {
  const dims = size === 'sm' ? 'h-7 w-7' : 'h-8 w-8'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          ref={ref}
          type={type}
          aria-label={label}
          className={`${buttonClass('ghost', 'icon')} ${dims} !px-0 ${active ? 'bg-neutral-100 text-neutral-900' : 'text-neutral-500'} ${className}`}
          {...rest}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent className="text-xs">{label}</TooltipContent>
    </Tooltip>
  )
})

export function Kbd({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-md bg-neutral-100 px-1 font-sans text-[10px] font-semibold text-neutral-500 ring-1 ring-inset ring-neutral-900/5 ${className}`}
    >
      {children}
    </kbd>
  )
}

/** True when a key press belongs to a text field, so global shortcuts stay out of the way. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
}

/** A dialog, popover or menu is open; Escape and arrows belong to it. */
export function overlayOpen(): boolean {
  return Boolean(document.querySelector('[role="dialog"],[role="menu"],[role="listbox"]'))
}

// Unsent text per conversation, kept in this browser only. Storage can be
// blocked (private windows), so every access is guarded.
const DRAFT_PREFIX = 'lh-msg-draft:'

export function readDraft(key: string | undefined): string {
  if (!key) return ''
  try {
    return window.localStorage.getItem(DRAFT_PREFIX + key) || ''
  } catch {
    return ''
  }
}

export function writeDraft(key: string | undefined, text: string) {
  if (!key) return
  try {
    if (text.trim()) window.localStorage.setItem(DRAFT_PREFIX + key, text)
    else window.localStorage.removeItem(DRAFT_PREFIX + key)
  } catch {
    // ignore
  }
}

/** Unread count pill. Muted chats get a quiet dot instead of a number. */
export function UnreadBadge({ count, muted = false, className = '' }: { count: number; muted?: boolean; className?: string }) {
  if (count <= 0) return null
  if (muted) return <span className={`h-2 w-2 shrink-0 rounded-full bg-neutral-300 ${className}`} />
  return (
    <span
      className={`inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-neutral-900 px-1.5 text-[11px] font-semibold tabular-nums text-white ${className}`}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}
