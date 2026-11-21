'use client'
/*
 Edit-in-place pieces for the Experiences authoring views (see the spec,
 "Authoring v2"). The author works on the learner's own layout; these are
 the few quiet controls laid over it. Styles: styles/experiences.css,
 "Authoring in place".

 - AddGhost: "+ Add …" drawn as a dashed version of the object it adds.
 - RemoveX: a small × that shows on hover / focus of its object (always on
   touch). The object carries `EDIT_OBJECT` (.lh-exp-editobj).
 - CorrectMark: a check badge that marks an option as the right answer.
 - SettingsGear: the header gear for rare settings, in a BlockPopover.
 - AnswerKeyHint: the one line under the canvas saying this is the key.
 - CardNav: prev / dots / next (+ add) for blocks edited one card at a time.
*/
import React from 'react'
import { CaretLeft, CaretRight, Check, GearSix, Key, Plus, X } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { BlockPopover } from '../../../Blocks/ui/BlockChrome'
import { cn } from '@/lib/utils'

/** Put on an object whose edit tools (× and friends) show on hover / focus. */
export const EDIT_OBJECT = 'lh-exp-editobj'

export interface AddGhostProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  /** The visible label, e.g. "Add item". */
  children: React.ReactNode
  /** Shape and size of the real object (rounded-xl min-h-10 px-3…). */
  className?: string
  iconSize?: number
}

export const AddGhost = React.forwardRef<HTMLButtonElement, AddGhostProps>(function AddGhost({ children, className, iconSize = 14, ...rest }, ref) {
  return (
    <button ref={ref} type="button" data-no-drag="" className={cn('lh-exp-ghost text-[13px] outline-none', className)} {...rest}>
      <Plus size={iconSize} weight="bold" aria-hidden className="shrink-0" />
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
    </button>
  )
})

export interface RemoveXProps {
  onClick: () => void
  /** Accessible name, e.g. "Remove “Solar”". */
  label: string
  /** Hidden when removing is not allowed (minimum reached). */
  disabled?: boolean
  /** Pin to the object's top-end corner as a small raised button. */
  floating?: boolean
  className?: string
}

export function RemoveX({ onClick, label, disabled, floating = false, className }: RemoveXProps) {
  if (disabled) return null
  return (
    <button
      type="button"
      data-no-drag=""
      aria-label={label}
      title={label}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={cn(
        'lh-exp-tool inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-neutral-400 outline-none hover:text-rose-600',
        floating
          ? 'lh-exp-raised absolute -top-2 -end-2 z-10 hover:bg-rose-50'
          : 'hover:bg-rose-50',
        className,
      )}
    >
      <X size={11} weight="bold" aria-hidden />
    </button>
  )
}

export interface CorrectMarkProps {
  checked: boolean
  onChange: (_checked: boolean) => void
  /** Accessible name, e.g. "Correct answer". */
  label: string
  className?: string
}

/** A check badge: filled when this option is the right answer. */
export function CorrectMark({ checked, onChange, label, className }: CorrectMarkProps) {
  return (
    <button
      type="button"
      role="checkbox"
      data-no-drag=""
      aria-checked={checked}
      aria-label={label}
      title={label}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!checked)
      }}
      className={cn(
        'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sky-500/40',
        checked
          ? 'bg-emerald-500 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_1px_1px_rgba(15,23,42,0.08)]'
          : 'border border-dashed border-neutral-300 text-neutral-300 hover:border-emerald-400 hover:text-emerald-600',
        className,
      )}
    >
      <Check size={13} weight="bold" aria-hidden />
    </button>
  )
}

export interface SettingsGearProps {
  children: React.ReactNode
  /** Button name and popover title (defaults to "Settings"). */
  label?: string
  width?: number
}

/** The header gear: rare settings (mode, shuffle, labels…) in a small popover. */
export function SettingsGear({ children, label, width = 280 }: SettingsGearProps) {
  const { t } = useTranslation()
  const name = label ?? t('editor.experiences.common.settings', 'Settings')
  return (
    <BlockPopover
      title={name}
      width={width}
      trigger={
        <button
          type="button"
          aria-label={name}
          title={name}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500 transition-colors outline-none hover:bg-neutral-200 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-sky-500/40 data-[state=open]:bg-neutral-200 data-[state=open]:text-neutral-900"
        >
          <GearSix size={14} weight="bold" aria-hidden />
        </button>
      }
    >
      {children}
    </BlockPopover>
  )
}

/** A checkbox row for the settings popover. */
export function SettingsToggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (_v: boolean) => void; label: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-neutral-900" />
      <span className="flex flex-col gap-0.5">
        <span className="text-[13px] font-medium text-neutral-700">{label}</span>
        {hint && <span className="text-[11px] leading-snug text-neutral-400">{hint}</span>}
      </span>
    </label>
  )
}

/** One line under the canvas: you are editing the answer key. Sits where the learner footer is. */
export function AnswerKeyHint({ children, className }: { children?: React.ReactNode; className?: string }) {
  const { t } = useTranslation()
  return (
    <p className={cn('m-0 flex items-center gap-1.5 px-4 pt-1 pb-3.5 text-xs leading-snug text-neutral-500 sm:px-5', className)}>
      <Key size={13} weight="duotone" aria-hidden className="shrink-0 text-amber-500" />
      <span>{children ?? t('editor.experiences.common.answer_key_hint', 'You’re editing the answer key. Preview to try it as a learner.')}</span>
    </p>
  )
}

/** Prev / dots / next for one-card-at-a-time authoring, plus an add ghost. */
export function CardNav({
  count,
  index,
  onGo,
  onAdd,
  canAdd,
  addLabel,
  itemLabel,
  flagged,
  prevLabel,
  nextLabel,
}: {
  count: number
  index: number
  onGo: (_i: number) => void
  onAdd: () => void
  canAdd: boolean
  addLabel: string
  itemLabel: (_n: number) => string
  flagged?: (_i: number) => boolean
  prevLabel: string
  nextLabel: string
}) {
  const btn =
    'inline-flex h-7 w-7 items-center justify-center rounded-lg text-neutral-500 outline-none hover:bg-neutral-200/60 hover:text-neutral-800 focus-visible:ring-2 focus-visible:ring-sky-500/40 disabled:pointer-events-none disabled:opacity-30'
  return (
    <div className="flex flex-wrap items-center justify-center gap-1">
      <button type="button" onClick={() => onGo(index - 1)} disabled={index === 0} aria-label={prevLabel} className={btn}>
        <CaretLeft size={14} weight="bold" aria-hidden className="rtl:rotate-180" />
      </button>
      <div className="flex flex-wrap items-center justify-center">
        {Array.from({ length: count }, (_, n) => (
          <button
            key={n}
            type="button"
            onClick={() => onGo(n)}
            aria-label={itemLabel(n + 1)}
            aria-current={n === index ? 'true' : undefined}
            className="group inline-flex h-7 items-center justify-center px-[3px] outline-none"
          >
            <span
              aria-hidden
              className={cn(
                'block h-1.5 rounded-full transition-all group-focus-visible:ring-2 group-focus-visible:ring-sky-500/40',
                n === index ? 'w-4 bg-neutral-700' : 'w-1.5 bg-neutral-300 group-hover:bg-neutral-400',
                flagged?.(n) && n !== index && 'bg-amber-300',
              )}
            />
          </button>
        ))}
      </div>
      <button type="button" onClick={() => onGo(index + 1)} disabled={index >= count - 1} aria-label={nextLabel} className={btn}>
        <CaretRight size={14} weight="bold" aria-hidden className="rtl:rotate-180" />
      </button>
      {canAdd && (
        <AddGhost onClick={onAdd} iconSize={12} className="ms-1 h-7 rounded-lg px-2 text-[12px]">
          {addLabel}
        </AddGhost>
      )}
    </div>
  )
}
