'use client'
/*
 Shared chrome for editor blocks (edit mode only; learners never see it).

 - BlockChrome: the hover/selection frame. A hairline ring when the block is
   selected, and a small floating toolbar with the block's key actions at the
   top-end corner. On touch screens (no hover) the toolbar shows while the
   block is selected.
 - BlockToolbarButton / BlockToolbarDivider: 28px icon buttons for it.
 - BlockPopover: a settings popover anchored to a toolbar button, used instead
   of a modal for anything that fits in ~280px.
 - Segmented / SettingsField: compact controls for those popovers.

 All of it is transient UI state; only the final values a control commits go
 into node attrs (see the collab rules in the spec).
*/
import React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { cn } from '@/lib/utils'

/**
 * Each block keeps the color its toolbar button has (globals.css
 * .editor-tool-btn-*), so the label, the empty-state icon and the toolbar
 * read as the same block.
 */
export type BlockTone = 'media' | 'document' | 'embed' | 'interactive' | 'math' | 'code' | 'dynamic' | 'info' | 'people' | 'link' | 'neutral'

export const BLOCK_TONE: Record<BlockTone, { text: string; soft: string }> = {
  media: { text: 'text-violet-600', soft: 'bg-violet-50 text-violet-600' },
  document: { text: 'text-rose-500', soft: 'bg-rose-50 text-rose-500' },
  embed: { text: 'text-teal-600', soft: 'bg-teal-50 text-teal-600' },
  interactive: { text: 'text-green-600', soft: 'bg-green-50 text-green-600' },
  math: { text: 'text-orange-600', soft: 'bg-orange-50 text-orange-600' },
  code: { text: 'text-slate-600', soft: 'bg-slate-100 text-slate-600' },
  dynamic: { text: 'text-fuchsia-700', soft: 'bg-fuchsia-50 text-fuchsia-700' },
  info: { text: 'text-blue-500', soft: 'bg-blue-50 text-blue-500' },
  // User card (toolbar: indigo) and Web preview (toolbar: sky).
  people: { text: 'text-indigo-600', soft: 'bg-indigo-50 text-indigo-600' },
  link: { text: 'text-sky-600', soft: 'bg-sky-50 text-sky-600' },
  neutral: { text: 'text-neutral-400', soft: 'bg-neutral-100 text-neutral-500' },
}

interface BlockChromeProps {
  selected?: boolean
  toolbar?: React.ReactNode
  /** Small label shown at the top-start corner on hover ("Image"). */
  label?: React.ReactNode
  className?: string
  children: React.ReactNode
  /** Keep the toolbar visible (e.g. while a popover from it is open). */
  forceToolbar?: boolean
  tone?: BlockTone
  /** Blocks with editable content inside (callouts) must not be contentEditable=false. */
  editableContent?: boolean
}

export function BlockChrome({ selected, toolbar, label, className, children, forceToolbar, tone = 'neutral', editableContent }: BlockChromeProps) {
  const showToolbar = selected || forceToolbar
  return (
    <div
      contentEditable={editableContent ? undefined : false}
      suppressContentEditableWarning
      data-block-chrome=""
      data-tone={tone}
      data-selected={selected ? 'true' : undefined}
      className={cn(
        'group/block relative rounded-xl transition-shadow duration-150',
        selected ? 'ring-2 ring-sky-500/40 ring-offset-2 ring-offset-white' : '',
        className,
      )}
    >
      {label && (
        <div
          contentEditable={false}
          className={cn(
            'pointer-events-none absolute -top-2.5 start-3 z-20 inline-flex items-center gap-1 rounded-md bg-white px-1.5 py-0.5 text-[11px] font-semibold shadow-[0_0_0_1px_var(--lhb-border,rgba(0,0,0,0.06))] transition-opacity',
            BLOCK_TONE[tone].text,
            showToolbar ? 'opacity-100' : 'opacity-0 group-hover/block:opacity-100',
          )}
        >
          {label}
        </div>
      )}
      {toolbar && (
        <div
          contentEditable={false}
          role="toolbar"
          className={cn(
            'absolute -top-4 end-3 z-30 flex items-center gap-0.5 rounded-[10px] bg-white/95 p-0.5 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_0_0_1px_rgba(0,0,0,0.08)] transition-opacity duration-150',
            showToolbar
              ? 'opacity-100'
              : 'pointer-events-none opacity-0 group-hover/block:pointer-events-auto group-hover/block:opacity-100 group-focus-within/block:pointer-events-auto group-focus-within/block:opacity-100',
          )}
          // Keep clicks on the toolbar from moving the editor selection.
          onMouseDown={(e) => {
            const tag = (e.target as HTMLElement).tagName
            if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') e.preventDefault()
          }}
        >
          {toolbar}
        </div>
      )}
      {children}
    </div>
  )
}

interface ToolbarButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  active?: boolean
  tone?: 'default' | 'danger'
}

export const BlockToolbarButton = React.forwardRef<HTMLButtonElement, ToolbarButtonProps>(
  ({ label, active, tone = 'default', className, children, ...rest }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      className={cn(
        'inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-lg px-1.5 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40',
        active ? 'bg-neutral-900 text-white' : tone === 'danger' ? 'text-neutral-500 hover:bg-rose-50 hover:text-rose-600' : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  ),
)
BlockToolbarButton.displayName = 'BlockToolbarButton'

export function BlockToolbarDivider() {
  return <span aria-hidden className="mx-0.5 h-4 w-px bg-neutral-200" />
}

interface BlockPopoverProps {
  trigger: React.ReactElement
  children: React.ReactNode
  open?: boolean
  onOpenChange?: (_open: boolean) => void
  title?: React.ReactNode
  width?: number
  align?: 'start' | 'center' | 'end'
}

export function BlockPopover({ trigger, children, open, onOpenChange, title, width = 288, align = 'end' }: BlockPopoverProps) {
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align={align}
          sideOffset={6}
          collisionPadding={12}
          style={{ zIndex: 'var(--z-popover)', width }}
          className="max-w-[calc(100vw-24px)] rounded-xl bg-white p-3 text-[13px] text-neutral-700 shadow-[0_8px_24px_rgba(0,0,0,0.08),0_0_0_1px_rgba(0,0,0,0.08)] outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          onOpenAutoFocus={(e) => {
            // Focus the first field rather than the close of the trigger chain.
            const el = (e.currentTarget as HTMLElement)?.querySelector<HTMLElement>('input,textarea,select,button')
            if (el) {
              e.preventDefault()
              el.focus()
            }
          }}
        >
          {title && <div className="mb-2.5 text-[12px] font-semibold text-neutral-500">{title}</div>}
          <div className="flex flex-col gap-3">{children}</div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

export function SettingsField({ label, hint, children }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-neutral-600">{label}</span>
      {children}
      {hint && <span className="text-[11px] leading-snug text-neutral-400">{hint}</span>}
    </label>
  )
}

export const FIELD_CLASS =
  'h-8 w-full rounded-lg bg-white px-2.5 text-[13px] text-neutral-800 shadow-[0_0_0_1px_var(--lhb-border,rgba(0,0,0,0.1))] outline-none placeholder:text-neutral-400 focus:shadow-[0_0_0_1px_rgba(0,0,0,0.25),0_0_0_3px_rgba(0,0,0,0.05)]'

export const TEXTAREA_CLASS =
  'w-full rounded-lg bg-white px-2.5 py-2 text-[13px] leading-relaxed text-neutral-800 shadow-[0_0_0_1px_var(--lhb-border,rgba(0,0,0,0.1))] outline-none placeholder:text-neutral-400 focus:shadow-[0_0_0_1px_rgba(0,0,0,0.25),0_0_0_3px_rgba(0,0,0,0.05)]'

interface SegmentedProps<T extends string> {
  value: T | null
  options: { value: T; label: React.ReactNode; title?: string }[]
  onChange: (_value: T) => void
  ariaLabel: string
}

export function Segmented<T extends string>({ value, options, onChange, ariaLabel }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex w-full rounded-lg bg-neutral-100 p-0.5">
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={opt.title}
            onClick={() => onChange(opt.value)}
            className={cn(
              'inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-md px-2 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40',
              active ? 'bg-white text-neutral-900 shadow-[0_1px_1px_rgba(0,0,0,0.06),0_0_0_1px_rgba(0,0,0,0.06)]' : 'text-neutral-500 hover:text-neutral-800',
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

/** A text input that commits on blur / Enter only (one attr write per edit). */
export function CommitInput({
  value,
  onCommit,
  multiline,
  className,
  ...rest
}: {
  value: string
  onCommit: (_value: string) => void
  multiline?: boolean
  className?: string
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [draft, setDraft] = React.useState(value)
  // Follow remote changes while the field isn't being edited.
  const editing = React.useRef(false)
  React.useEffect(() => {
    if (!editing.current) setDraft(value)
  }, [value])
  const commit = () => {
    editing.current = false
    if (draft !== value) onCommit(draft)
  }
  if (multiline) {
    return (
      <textarea
        value={draft}
        rows={4}
        className={className ?? TEXTAREA_CLASS}
        placeholder={rest.placeholder}
        aria-label={rest['aria-label']}
        onFocus={() => (editing.current = true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') {
            setDraft(value)
            ;(e.target as HTMLTextAreaElement).blur()
          }
        }}
      />
    )
  }
  return (
    <input
      {...rest}
      value={draft}
      className={className ?? FIELD_CLASS}
      onFocus={() => (editing.current = true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          ;(e.target as HTMLInputElement).blur()
        }
        if (e.key === 'Escape') {
          setDraft(value)
          ;(e.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}
