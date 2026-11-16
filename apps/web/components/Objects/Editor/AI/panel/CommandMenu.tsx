'use client'
/*
 The composer's "/" menu: every AI Editor action, searchable, in groups.
 Actions that need a choice (tone, language, reading level, section) open a
 second list in place. Keyboard: ↑ ↓ to move, Enter to run, Esc / ← to go back.
 The cost of an action shows on hover, not as a label.
*/
import React from 'react'
import { useTranslation } from 'react-i18next'
import { CaretLeft, CaretRight } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import {
  type CreditCosts,
  type QuickAction,
  LANGUAGES,
  LEVELS,
  TONES,
  estimateCredits,
  groupedActions,
} from '../engine/actions'
import { ACTION_ICONS, type ActionRun, type Heading, actionMessage } from './actionUtils'

export interface CommandMenuHandle {
  /** Handle a key from the composer; true when the menu used it. */
  onKeyDown: (_e: React.KeyboardEvent) => boolean
}

interface Row {
  key: string
  label: string
  group?: string
  icon?: React.ComponentType<any>
  title?: string
  more?: boolean
  run: () => void
}

type Sub = { action: QuickAction; asCopy?: boolean }

const CommandMenu = React.forwardRef<
  CommandMenuHandle,
  {
    query: string
    costs: CreditCosts
    headings: Heading[]
    atlas: boolean
    hasSelection: boolean
    /** Open straight on an action's choices (a suggestion with a choice). */
    initialSub?: QuickAction | null
    placement: 'above' | 'below'
    onRun: (_run: ActionRun) => void
    onClose: () => void
    /** Entering an action's choices: the typed filter starts over. */
    onEnterSub?: () => void
  }
>(function CommandMenu({ query, costs, headings, atlas, hasSelection, initialSub, placement, onRun, onClose, onEnterSub }, ref) {
  const { t } = useTranslation()
  const [sub, setSubState] = React.useState<Sub | null>(initialSub ? { action: initialSub } : null)
  const setSub = (next: Sub | null) => {
    setSubState(next)
    if (next) onEnterSub?.()
  }
  const [active, setActive] = React.useState(0)
  const listRef = React.useRef<HTMLDivElement>(null)
  const q = query.trim().toLowerCase()

  const cost = (a: QuickAction) => {
    const est = estimateCredits(a.id, costs)
    return est.perItem
      ? t('editor.ai_editor_v2.cost_with_items', { count: est.now, per: est.perItem })
      : t('editor.ai_editor_v2.cost', { count: est.now })
  }

  let rows: Row[] = []
  if (sub) {
    const a = sub.action
    const run = (r: Omit<ActionRun, 'action'>) => onRun({ action: a.id, ...r })
    if (a.param === 'tone') {
      rows = TONES.map((tone) => ({
        key: tone,
        label: t(`editor.ai_editor_v2.tones.${tone}`),
        run: () => run({ message: actionMessage(t, a.id, { param: tone, hasSelection }) }),
      }))
    } else if (a.param === 'level') {
      rows = LEVELS.map((level) => ({
        key: level,
        label: t(`editor.ai_editor_v2.levels.${level}`),
        run: () => run({ message: actionMessage(t, a.id, { param: level }) }),
      }))
    } else if (a.param === 'language') {
      rows = LANGUAGES.map((lang) => ({
        key: lang,
        label: lang,
        run: () =>
          run({
            asCopy: sub.asCopy,
            message: actionMessage(t, a.id, { param: lang, hasSelection: hasSelection && !sub.asCopy, asCopy: sub.asCopy }),
          }),
      }))
    } else if (a.param === 'section') {
      rows = headings.map((h) => ({
        key: String(h.index),
        label: h.text,
        run: () => run({ path: [h.index], message: actionMessage(t, a.id, { heading: h.text }) }),
      }))
    }
  } else {
    for (const { group, actions } of groupedActions()) {
      for (const a of actions) {
        if (a.id === 'draft_section' && !headings.length) continue
        rows.push({
          key: a.id,
          label: t(`editor.ai_editor_v2.actions.${a.id}`),
          group: t(`editor.ai_editor_v2.groups.${group}`),
          icon: ACTION_ICONS[a.id],
          title: cost(a),
          more: !!a.param,
          run: () =>
            a.param ? setSub({ action: a }) : onRun({ action: a.id, message: actionMessage(t, a.id, { hasSelection: hasSelection && a.usesSelection }) }),
        })
        if (a.id === 'translate' && atlas) {
          rows.push({
            key: 'translate_copy',
            label: t('editor.ai_editor_v2.actions.translate_copy'),
            group: t(`editor.ai_editor_v2.groups.${group}`),
            icon: ACTION_ICONS.translate,
            title: cost(a),
            more: true,
            run: () => setSub({ action: a, asCopy: true }),
          })
        }
      }
    }
  }
  if (q) rows = rows.filter((r) => r.label.toLowerCase().includes(q) || r.group?.toLowerCase().includes(q))

  React.useEffect(() => setActive(0), [q, sub])
  React.useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  React.useImperativeHandle(ref, () => ({
    onKeyDown: (e) => {
      if (e.key === 'ArrowDown') {
        setActive((i) => Math.min(rows.length - 1, i + 1))
        return true
      }
      if (e.key === 'ArrowUp') {
        setActive((i) => Math.max(0, i - 1))
        return true
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        rows[active]?.run()
        return true
      }
      if (e.key === 'Escape' || (e.key === 'ArrowLeft' && sub)) {
        if (sub) setSub(null)
        else onClose()
        return true
      }
      if (e.key === 'Tab' && rows[active]?.more) {
        rows[active].run()
        return true
      }
      return false
    },
  }))

  let lastGroup: string | undefined
  return (
    <div
      role="listbox"
      aria-label={t('editor.ai_editor_v2.quick_actions')}
      className={cn(
        'absolute inset-x-0 z-20 overflow-hidden rounded-xl bg-[#17132e] ring-1 ring-inset ring-white/10 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.6)]',
        placement === 'above' ? 'bottom-full mb-2' : 'top-full mt-2'
      )}
      onMouseDown={(e) => e.preventDefault()}
    >
      {sub && (
        <button
          type="button"
          onClick={() => setSub(null)}
          className="flex w-full items-center gap-1.5 border-b border-white/[0.07] px-3 py-2 text-start text-[12px] text-white/50 hover:text-white/80"
        >
          <CaretLeft size={11} className="rtl:rotate-180" />
          {sub.asCopy ? t('editor.ai_editor_v2.actions.translate_copy') : t(`editor.ai_editor_v2.choose.${sub.action.param}`)}
        </button>
      )}
      <div ref={listRef} className="lh-ai-scroll max-h-64 overflow-y-auto py-1">
        {rows.length === 0 && <p className="px-3 py-2 text-[12.5px] text-white/40">{t('editor.ai_editor_v2.no_match')}</p>}
        {rows.map((row, i) => {
          const header = row.group && row.group !== lastGroup && !q ? row.group : null
          lastGroup = row.group
          const Icon = row.icon
          return (
            <React.Fragment key={row.key}>
              {header && <div className="px-3 pb-1 pt-2 text-[11px] text-white/35">{header}</div>}
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                data-row={i}
                data-ai-action={row.key}
                title={row.title}
                onMouseEnter={() => setActive(i)}
                onClick={row.run}
                className={cn(
                  'flex h-8 w-full items-center gap-2.5 px-3 text-start text-[13px] text-white/75',
                  i === active && 'bg-white/[0.07] text-white'
                )}
              >
                {Icon && <Icon size={15} className="shrink-0 text-violet-300/80" />}
                <span className="min-w-0 flex-1 truncate">{row.label}</span>
                {row.more && <CaretRight size={11} className="shrink-0 text-white/30 rtl:rotate-180" />}
              </button>
            </React.Fragment>
          )
        })}
      </div>
    </div>
  )
})

export default CommandMenu
