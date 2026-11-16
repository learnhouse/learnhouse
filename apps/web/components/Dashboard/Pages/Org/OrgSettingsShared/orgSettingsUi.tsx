'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Info, Warning } from '@phosphor-icons/react'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { Button, INPUT } from '@components/Dashboard/Shared/DashKit/DashKit'

// Small pieces shared by the organization settings tabs. DashKit stays
// untouched; anything it lacks for these screens lives here.

/**
 * A form draft seeded from server values. The draft re-seeds only when the
 * server values themselves change (after a save, or another admin's edit),
 * so a background refetch never wipes what the admin is typing.
 */
export function useDraft<T>(source: T) {
  const sourceKey = JSON.stringify(source)
  const [draft, setDraft] = React.useState<T>(source)
  const [seenKey, setSeenKey] = React.useState(sourceKey)
  if (seenKey !== sourceKey) {
    setSeenKey(sourceKey)
    setDraft(source)
  }
  const dirty = JSON.stringify(draft) !== sourceKey
  const reset = React.useCallback(() => setDraft(JSON.parse(sourceKey) as T), [sourceKey])
  const patch = React.useCallback((next: Partial<T>) => setDraft((prev) => ({ ...prev, ...next })), [])
  return { draft, setDraft, patch, dirty, reset }
}

/** Quiet "N characters left" hint for a FieldLabel; turns amber near the limit. */
export function CharCount({ value, max }: { value: string | undefined | null; max: number }) {
  const { t } = useTranslation()
  const left = max - (value?.length ?? 0)
  return (
    <span className={`tabular-nums ${left <= Math.max(5, Math.round(max * 0.1)) ? 'text-amber-600' : 'text-neutral-400'}`}>
      {t('user.settings.general.characters_left', { count: left })}
    </span>
  )
}

/** One-line hint under a field. */
export function FieldHint({ children, error }: { children: React.ReactNode; error?: boolean }) {
  return <p className={`mt-1.5 text-xs leading-relaxed ${error ? 'text-rose-600' : 'text-neutral-500'}`}>{children}</p>
}

const NOTICE_TONES = {
  neutral: 'bg-neutral-50 text-neutral-600 ring-neutral-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200/80',
  sky: 'bg-sky-50 text-sky-800 ring-sky-200/80',
  rose: 'bg-rose-50 text-rose-700 ring-rose-200/80',
} as const

/** Inline banner for read-only, plan or state notices. */
export function Notice({
  tone = 'neutral',
  icon,
  children,
  action,
}: {
  tone?: keyof typeof NOTICE_TONES
  icon?: React.ReactNode
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className={`flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm ring-1 ring-inset ${NOTICE_TONES[tone]}`}>
      <span className="mt-0.5 shrink-0">
        {icon ?? (tone === 'amber' || tone === 'rose' ? <Warning size={16} /> : <Info size={16} />)}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

/**
 * Destructive confirm that only arms once the admin types the expected text
 * (the org slug, say). Controlled, like DashKit's ConfirmDialog.
 */
export function TypeToConfirmDialog({
  open,
  onOpenChange,
  title,
  message,
  expected,
  prompt,
  confirmLabel,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (_open: boolean) => void
  title: string
  message: React.ReactNode
  /** The exact text the admin must type. */
  expected: string
  /** Label above the input, e.g. "Type acme to confirm". */
  prompt: React.ReactNode
  confirmLabel: string
  onConfirm: () => unknown | Promise<unknown>
}) {
  const { t } = useTranslation()
  const [value, setValue] = React.useState('')
  const [pending, setPending] = React.useState(false)
  const armed = value.trim() === expected

  const close = (next: boolean) => {
    if (!next) setValue('')
    onOpenChange(next)
  }

  const run = async () => {
    if (!armed) return
    setPending(true)
    try {
      await onConfirm()
      close(false)
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={close}
      preventClose={pending}
      size="sm"
      icon={<Warning size={16} className="text-rose-600" />}
      dialogTitle={title}
      dialogContent={
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            run()
          }}
        >
          <div className="text-sm text-neutral-600 leading-relaxed">{message}</div>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-neutral-500">{prompt}</span>
            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={expected}
              autoComplete="off"
              spellCheck={false}
              data-ltr-content
              className={`${INPUT} font-mono focus:ring-rose-500/25`}
            />
          </label>
        </form>
      }
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" onClick={run} disabled={!armed} loading={pending}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  )
}
