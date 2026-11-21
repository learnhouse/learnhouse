'use client'
/*
 The Experiences gallery: one card per block in the family (icon, name, a
 plain line on what it does for learning, and a tiny drawn preview). Picking
 a card inserts that block, filled in with its example, at the cursor.

 Used by the toolbar's Experiences popover. Keyboard: arrow keys move between
 cards (mirrored in RTL), Enter or Space inserts.
*/
import React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { BLOCK_TONE } from '../../Blocks/ui/BlockChrome'
import { experienceRegistry, insertExperience, type ExperienceEntry } from './registry'

interface Props {
  editor: any
  /** Called after a block was inserted (close the popover). */
  onInserted?: (_entry: ExperienceEntry) => void
  className?: string
}

export function ExperiencesGallery({ editor, onInserted, className }: Props) {
  const { t } = useTranslation()
  const gridRef = React.useRef<HTMLDivElement>(null)

  const pick = (entry: ExperienceEntry) => {
    if (!editor) return
    insertExperience(editor, entry, t)
    onInserted?.(entry)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']
    if (!keys.includes(e.key)) return
    const cards = Array.from(gridRef.current?.querySelectorAll<HTMLButtonElement>('[data-exp-card]') ?? [])
    const at = cards.indexOf(document.activeElement as HTMLButtonElement)
    if (at < 0 || !cards.length) return
    e.preventDefault()
    const top = cards[0].offsetTop
    const cols = Math.max(1, cards.filter((c) => c.offsetTop === top).length)
    const rtl = getComputedStyle(gridRef.current as HTMLElement).direction === 'rtl'
    let next = at
    if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = cards.length - 1
    else if (e.key === 'ArrowDown') next = Math.min(cards.length - 1, at + cols)
    else if (e.key === 'ArrowUp') next = Math.max(0, at - cols)
    else if ((e.key === 'ArrowRight') !== rtl) next = Math.min(cards.length - 1, at + 1)
    else next = Math.max(0, at - 1)
    cards[next]?.focus()
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="px-1">
        <div className="text-[13px] font-semibold text-neutral-900">{t('editor.experiences.gallery.title')}</div>
        <div className="text-xs text-neutral-500">{t('editor.experiences.gallery.subtitle')}</div>
      </div>
      <div
        ref={gridRef}
        role="group"
        aria-label={t('editor.experiences.gallery.title')}
        onKeyDown={onKeyDown}
        className="-m-1 grid max-h-[min(64vh,540px)] grid-cols-2 gap-2 overflow-y-auto overscroll-contain p-1 sm:grid-cols-3"
      >
        {experienceRegistry.map((entry) => {
          const Icon = entry.icon
          const tone = BLOCK_TONE[entry.tone] ?? BLOCK_TONE.neutral
          return (
            <button
              key={entry.id}
              type="button"
              data-exp-card={entry.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(entry)}
              className="group flex min-w-0 flex-col gap-2 rounded-xl bg-white p-2.5 text-start shadow-[0_0_0_1px_rgba(0,0,0,0.07)] transition-[box-shadow,transform] duration-150 outline-none hover:shadow-[0_0_0_1px_rgba(0,0,0,0.14),0_4px_12px_rgba(0,0,0,0.06)] focus-visible:ring-2 focus-visible:ring-sky-500/50 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100"
            >
              <span className={cn('flex h-14 w-full items-center justify-center overflow-hidden rounded-lg', tone.soft)}>
                <ExperiencePreview id={entry.id} />
              </span>
              <span className="flex min-w-0 items-center gap-1.5">
                <Icon size={14} weight="bold" className={cn('shrink-0', tone.text)} />
                <span className="truncate text-[13px] font-semibold text-neutral-900">{t(entry.titleKey, entry.title)}</span>
              </span>
              <span className="line-clamp-2 text-[11.5px] leading-snug text-neutral-500">{t(entry.descriptionKey, entry.description)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Tiny line drawings in the card's tone color (currentColor). */
export function ExperiencePreview({ id }: { id: string }) {
  const common = { width: 72, height: 44, viewBox: '0 0 72 44', fill: 'none', 'aria-hidden': true as const, className: 'rtl:-scale-x-100' }
  const soft = { fill: 'currentColor', opacity: 0.18 }
  const solid = { fill: 'currentColor' }
  const line = { stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const }
  switch (id) {
    case 'scenarios':
      return (
        <svg {...common}>
          <path d="M18 22 L36 12 M18 22 L36 32 M42 12 L54 12" {...line} opacity={0.5} />
          <circle cx="14" cy="22" r="5" {...solid} />
          <circle cx="40" cy="12" r="5" {...soft} />
          <circle cx="40" cy="32" r="5" {...soft} />
          <rect x="52" y="7" width="12" height="10" rx="3" {...solid} />
        </svg>
      )
    case 'flashcards':
      return (
        <svg {...common}>
          <rect x="16" y="9" width="30" height="24" rx="4" transform="rotate(-8 31 21)" {...soft} />
          <rect x="26" y="11" width="30" height="24" rx="4" {...solid} />
          <path d="M33 21 H49 M33 27 H44" stroke="white" strokeWidth="2" strokeLinecap="round" />
        </svg>
      )
    case 'sort':
      return (
        <svg {...common}>
          <rect x="8" y="6" width="25" height="32" rx="4" {...soft} />
          <rect x="39" y="6" width="25" height="32" rx="4" {...soft} />
          <rect x="12" y="11" width="17" height="6" rx="3" {...solid} />
          <rect x="12" y="20" width="17" height="6" rx="3" {...solid} />
          <rect x="43" y="11" width="17" height="6" rx="3" {...solid} />
        </svg>
      )
    case 'sequence':
      return (
        <svg {...common}>
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <circle cx={14 + i * 8} cy={10 + i * 12} r="4" {...solid} />
              <rect x={22 + i * 8} y={7 + i * 12} width={30 - i * 4} height="6" rx="3" {...soft} />
            </g>
          ))}
        </svg>
      )
    case 'match':
      return (
        <svg {...common}>
          <path d="M20 10 L52 32 M20 32 L52 21 M20 21 L52 10" {...line} opacity={0.55} />
          {[10, 21, 32].map((y) => (
            <g key={y}>
              <rect x="6" y={y - 4} width="14" height="8" rx="3" {...solid} />
              <rect x="52" y={y - 4} width="14" height="8" rx="3" {...soft} />
            </g>
          ))}
        </svg>
      )
    case 'hotspot':
      return (
        <svg {...common}>
          <rect x="8" y="5" width="56" height="34" rx="5" {...soft} />
          <path d="M8 33 L24 20 L36 30 L46 22 L64 34" {...line} opacity={0.45} />
          <circle cx="47" cy="15" r="7" stroke="currentColor" strokeWidth="2" />
          <circle cx="47" cy="15" r="2" {...solid} />
        </svg>
      )
    case 'gaps':
      return (
        <svg {...common}>
          <rect x="8" y="10" width="18" height="5" rx="2.5" {...soft} />
          <rect x="29" y="7" width="18" height="10" rx="3" stroke="currentColor" strokeWidth="2" strokeDasharray="3 2" />
          <rect x="50" y="10" width="14" height="5" rx="2.5" {...soft} />
          <rect x="8" y="26" width="26" height="5" rx="2.5" {...soft} />
          <rect x="37" y="23" width="18" height="10" rx="3" {...solid} />
        </svg>
      )
    case 'mythFact':
      return (
        <svg {...common}>
          <rect x="20" y="4" width="32" height="24" rx="4" {...soft} />
          <rect x="25" y="11" width="22" height="4" rx="2" {...solid} opacity={0.6} />
          <circle cx="26" cy="36" r="5" {...solid} />
          <circle cx="46" cy="36" r="5" {...soft} />
          <path d="M24 36 L26 38 L29 34" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'speedRound':
      return (
        <svg {...common}>
          <circle cx="36" cy="22" r="14" stroke="currentColor" strokeOpacity="0.2" strokeWidth="4" />
          <path d="M36 8 A14 14 0 1 1 22.7 26.3" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
          <path d="M37 15 L32 23 H38 L35 30" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'estimate':
      return (
        <svg {...common}>
          <rect x="8" y="24" width="56" height="4" rx="2" {...soft} />
          <rect x="8" y="24" width="34" height="4" rx="2" {...solid} />
          <circle cx="42" cy="26" r="6" {...solid} />
          <path d="M50 12 V20" {...line} />
          <rect x="44" y="5" width="12" height="7" rx="2" {...soft} />
        </svg>
      )
    case 'spotMistake':
      return (
        <svg {...common}>
          <rect x="8" y="8" width="40" height="5" rx="2.5" {...soft} />
          <rect x="8" y="19" width="22" height="5" rx="2.5" {...soft} />
          <rect x="32" y="17" width="26" height="9" rx="3" {...solid} />
          <rect x="8" y="31" width="48" height="5" rx="2.5" {...soft} />
        </svg>
      )
    case 'codeLock':
      return (
        <svg {...common}>
          <path d="M28 18 V13 a8 8 0 0 1 16 0 V18" stroke="currentColor" strokeWidth="3" />
          <rect x="18" y="18" width="36" height="22" rx="5" {...solid} />
          {[26, 36, 46].map((x) => (
            <rect key={x} x={x - 3.5} y="24" width="7" height="10" rx="2" fill="white" opacity={0.9} />
          ))}
        </svg>
      )
    case 'venn':
      return (
        <svg {...common}>
          <circle cx="28" cy="22" r="15" {...soft} />
          <circle cx="44" cy="22" r="15" {...soft} />
          <path d="M36 9.5 A15 15 0 0 1 36 34.5 A15 15 0 0 1 36 9.5 Z" {...solid} opacity={0.55} />
          <rect x="15" y="19" width="10" height="6" rx="3" {...solid} />
          <rect x="47" y="19" width="10" height="6" rx="3" {...solid} />
        </svg>
      )
    case 'label':
      return (
        <svg {...common}>
          <rect x="6" y="5" width="38" height="34" rx="5" {...soft} />
          <circle cx="18" cy="16" r="3" {...solid} />
          <circle cx="32" cy="30" r="3" {...solid} />
          <path d="M21 16 H48 M35 30 H48" {...line} opacity={0.45} />
          <rect x="48" y="12" width="18" height="8" rx="3" {...solid} />
          <rect x="48" y="26" width="18" height="8" rx="3" stroke="currentColor" strokeWidth="1.6" strokeDasharray="3 2" />
        </svg>
      )
    case 'wordGuess':
      return (
        <svg {...common}>
          {[0, 1, 2, 3, 4].map((i) => (
            <rect key={`a${i}`} x={9 + i * 11} y="6" width="9" height="9" rx="2" {...(i === 0 || i === 3 ? solid : soft)} opacity={i === 3 ? 0.55 : undefined} />
          ))}
          {[0, 1, 2, 3, 4].map((i) => (
            <rect key={`b${i}`} x={9 + i * 11} y="18" width="9" height="9" rx="2" {...(i < 2 ? solid : soft)} />
          ))}
          {[0, 1, 2, 3, 4].map((i) => (
            <rect key={`c${i}`} x={9 + i * 11} y="30" width="9" height="9" rx="2" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.4" />
          ))}
        </svg>
      )
    case 'confidence':
      return (
        <svg {...common}>
          <rect x="10" y="32" width="52" height="2" rx="1" {...soft} />
          <rect x="16" y="22" width="9" height="10" rx="2" {...soft} />
          <rect x="31" y="15" width="9" height="17" rx="2" {...solid} opacity={0.6} />
          <rect x="46" y="7" width="9" height="25" rx="2" {...solid} />
          <path d="M14 38 H27 M29 38 H42 M44 38 H57" {...line} opacity={0.35} />
        </svg>
      )
    case 'matrix':
      return (
        <svg {...common}>
          {[0, 1, 2].map((r) =>
            [0, 1, 2, 3].map((c) => {
              const on = (r + c) % 3 === 0 || (r === 1 && c === 2)
              return <rect key={`${r}-${c}`} x={14 + c * 12} y={6 + r * 12} width="9" height="9" rx="2.5" {...(on ? solid : soft)} />
            }),
          )}
          <rect x="4" y="7" width="6" height="2" rx="1" {...solid} opacity={0.5} />
          <rect x="4" y="19" width="6" height="2" rx="1" {...solid} opacity={0.5} />
          <rect x="4" y="31" width="6" height="2" rx="1" {...solid} opacity={0.5} />
        </svg>
      )
    case 'reflect':
      return (
        <svg {...common}>
          <rect x="10" y="5" width="40" height="34" rx="4" {...soft} />
          <path d="M16 14 H42 M16 21 H44 M16 28 H32" {...line} opacity={0.55} />
          <path d="M50 30 L60 12 L64 14 L54 32 L49 34 Z" {...solid} />
        </svg>
      )
    default:
      return null
  }
}

export default ExperiencesGallery
