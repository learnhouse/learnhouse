import React from 'react'
import { parseBinding } from '@/lib/shortcuts/matcher'

const LABELS: Record<string, string> = {
  escape: 'esc',
  enter: '↵',
  arrowleft: '←',
  arrowright: '→',
  arrowup: '↑',
  arrowdown: '↓',
  space: 'Space',
}

export function keyLabel(token: string): string {
  return LABELS[token] ?? token.toUpperCase()
}

/**
 * One keycap, light theme. Pass `tone="onDark"` when it sits on a dark button.
 */
export function Kbd({
  children,
  tone = 'light',
  className = '',
}: {
  children: React.ReactNode
  tone?: 'light' | 'onDark' | 'muted'
  className?: string
}) {
  const tones = {
    light: 'bg-black/5 text-black/55',
    muted: 'bg-black/[0.04] text-black/40',
    onDark: 'bg-white/15 text-white/80',
  }
  return (
    <kbd
      className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded px-1 font-sans text-[10.5px] font-medium leading-none ${tones[tone]} ${className}`}
    >
      {children}
    </kbd>
  )
}

/** A whole binding: `g c` renders as two keycaps in a row. */
export function Keys({
  keys,
  tone,
  className = '',
}: {
  keys: string
  tone?: 'light' | 'onDark' | 'muted'
  className?: string
}) {
  const parts = parseBinding(keys)
  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`} aria-label={parts.map(keyLabel).join(' ')}>
      {parts.map((p, i) => (
        <Kbd key={`${p}-${i}`} tone={tone}>
          {keyLabel(p)}
        </Kbd>
      ))}
    </span>
  )
}
