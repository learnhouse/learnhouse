'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-hot-toast'
import type { LiveEditingControl } from '../Editor'
import {
  ArrowSquareOut,
  Broadcast,
  Check,
  FloppyDisk,
  BookmarkSimple,
  CircleNotch,
  ClockCounterClockwise,
  Eye,
  UserFocus,
} from '@phosphor-icons/react'
import { useActivityVersions } from '@components/Hooks/useActivityVersioning'
import HeaderMenu from './HeaderMenu'
import SaveIndicator, { type SaveState } from './SaveIndicator'
import { HBTN, HEADER_ICON, HLABEL, HMENU_ITEM } from './headerStyles'

const RECENT_VERSIONS = 4

/** Where the comments rail docks its toggle in the header group. */
export const COMMENTS_SLOT_ID = 'lh-editor-comments-slot'

function shortTime(value: string, locale: string): string {
  const date = new Date(value.endsWith('Z') || value.includes('+') ? value : `${value}Z`)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function NameVersionForm({ onSubmit, onCancel }: { onSubmit: (_label: string) => Promise<boolean>; onCancel: () => void }) {
  const { t } = useTranslation()
  const [label, setLabel] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!label.trim()) return
    setBusy(true)
    const ok = await onSubmit(label.trim())
    setBusy(false)
    if (ok) {
      toast.success(t('editor.history.named', 'Version named'))
      onCancel()
    } else {
      toast.error(t('editor.history.name_failed', 'Could not name this version. Try again in a moment.'))
    }
  }
  return (
    <form onSubmit={submit} className="p-1.5">
      <p className="px-0.5 text-[13px] font-semibold text-neutral-900">{t('editor.history.name_title', 'Name this version')}</p>
      <p className="mt-0.5 px-0.5 text-xs text-neutral-500">
        {t('editor.history.name_hint', 'Changes save automatically. A name makes this point easy to find later.')}
      </p>
      <input
        autoFocus
        maxLength={120}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder={t('editor.history.name_placeholder', 'e.g. Before review')}
        data-testid="name-version-input"
        className="mt-2 h-8 w-full rounded-lg bg-white px-2.5 text-[13px] ring-1 ring-inset ring-neutral-200 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900/15"
      />
      <div className="mt-2 flex justify-end gap-1.5">
        <button type="button" onClick={onCancel} className="h-7 rounded-lg px-2.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100">
          {t('common.cancel', 'Cancel')}
        </button>
        <button
          type="submit"
          disabled={busy || !label.trim()}
          className="inline-flex h-7 items-center gap-1 rounded-lg bg-neutral-900 px-2.5 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {busy && <CircleNotch size={12} className="animate-spin" />}
          {t('editor.history.name_save', 'Save name')}
        </button>
      </div>
    </form>
  )
}

function LiveEditingSection({ control, close }: { control: LiveEditingControl; close: () => void }) {
  const { t } = useTranslation()
  const [busy, setBusy] = React.useState(false)
  const options: { mode: LiveEditingControl['mode']; label: string }[] = [
    {
      mode: 'default',
      label: control.orgDefault
        ? t('editor.live_editing.default_on', 'Organization default (on)')
        : t('editor.live_editing.default_off', 'Organization default (off)'),
    },
    { mode: 'on', label: t('editor.live_editing.on', 'On for this activity') },
    { mode: 'off', label: t('editor.live_editing.off', 'Off for this activity') },
  ]
  const choose = async (mode: LiveEditingControl['mode']) => {
    if (mode === control.mode || busy) return
    setBusy(true)
    const ok = await control.onChange(mode)
    setBusy(false)
    if (ok) close()
    else toast.error(t('editor.live_editing.failed', 'Could not change live editing. Try again in a moment.'))
  }
  return (
    <div data-testid="live-editing-options">
      <div className="my-1 h-px bg-neutral-100" />
      <p className="flex items-center gap-1.5 px-2 pb-0.5 pt-1 text-[11px] font-medium text-neutral-400">
        <Broadcast size={12} />
        {t('editor.live_editing.title', 'Live collaboration & autosave')}
      </p>
      {options.map((option) => (
        <button
          key={option.mode}
          type="button"
          role="menuitemradio"
          aria-checked={control.mode === option.mode}
          disabled={busy}
          className={HMENU_ITEM}
          data-live-mode={option.mode}
          onClick={() => choose(option.mode)}
        >
          <span className="flex size-4 items-center justify-center text-neutral-700">
            {control.mode === option.mode && <Check size={14} weight="bold" />}
          </span>
          <span className="flex-1">{option.label}</span>
        </button>
      ))}
    </div>
  )
}

function HistoryMenuBody({
  activityUuid,
  close,
  canName,
  versioning,
  onName,
  onOpenHistory,
  liveEditing,
}: {
  activityUuid: string
  close: () => void
  canName: boolean
  versioning: { enabled: boolean; badge?: React.ReactNode }
  onName: (_label: string) => Promise<boolean>
  onOpenHistory: () => void
  liveEditing?: LiveEditingControl
}) {
  const { t, i18n } = useTranslation()
  const [naming, setNaming] = React.useState(false)
  // Same query (and limit) as the version history panel, so they share the cache
  const { versions, isLoading, mutate } = useActivityVersions(activityUuid, 20, versioning.enabled)
  const name = async (label: string) => {
    const ok = await onName(label)
    if (ok) void mutate()
    return ok
  }
  const open = () => {
    close()
    onOpenHistory()
  }

  if (naming) return <NameVersionForm onSubmit={name} onCancel={close} />

  return (
    <div>
      <button type="button" className={HMENU_ITEM} disabled={!canName || !versioning.enabled} onClick={() => setNaming(true)} data-testid="history-name-version">
        <BookmarkSimple size={HEADER_ICON} className="text-neutral-500" />
        <span className="flex-1">{t('editor.history.name_this', 'Name this version…')}</span>
      </button>
      <button type="button" className={HMENU_ITEM} disabled={!versioning.enabled} onClick={open} data-testid="history-open">
        <ClockCounterClockwise size={HEADER_ICON} className="text-neutral-500" />
        <span className="flex-1">{t('editor.versioning.version_history', 'Version history')}</span>
        {versioning.badge}
      </button>
      {versioning.enabled && (
        <>
          <div className="my-1 h-px bg-neutral-100" />
          <p className="px-2 pb-0.5 pt-1 text-[11px] font-medium text-neutral-400">
            {t('editor.history.recent', 'Recent versions')}
          </p>
          {isLoading && <p className="px-2 py-1.5 text-xs text-neutral-400">{t('common.loading', 'Loading…')}</p>}
          {!isLoading && versions.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-neutral-400">{t('editor.history.none', 'No earlier versions yet')}</p>
          )}
          {versions.slice(0, RECENT_VERSIONS).map((version) => (
            <button key={version.id} type="button" className={HMENU_ITEM} onClick={open}>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="font-medium text-neutral-800">
                    {t('editor.versioning.version', { number: version.version_number, defaultValue: 'Version {{number}}' })}
                  </span>
                  {version.label && (
                    <span className="truncate rounded-full bg-neutral-100 px-1.5 text-[11px] font-medium text-neutral-600">{version.label}</span>
                  )}
                </span>
                <span className="block truncate text-xs text-neutral-400">
                  {shortTime(version.created_at, i18n.language || 'en')}
                  {version.created_by_username ? ` · ${version.created_by_username}` : ''}
                </span>
              </span>
            </button>
          ))}
        </>
      )}
      {liveEditing && <LiveEditingSection control={liveEditing} close={close} />}
    </div>
  )
}

/**
 * Everything right of the formatting toolbar that is about the page itself:
 * who's here, whether it's saved, preview and history. One look and height
 * for every control, the same in collaborative and autosave mode.
 */
export default function EditorHeaderControls({
  activityUuid,
  presence,
  save,
  previewHref,
  onViewAs,
  canName,
  versioning,
  onNameVersion,
  onOpenHistory,
  conflict,
  liveEditing,
  manualSave,
  hideHistory = false,
}: {
  activityUuid: string
  /** Avatars of the others in the room (collaborative mode only). */
  presence?: React.ReactNode
  save: SaveState
  previewHref: string
  onViewAs: () => void
  /** False for read-only users. */
  canName: boolean
  versioning: { enabled: boolean; badge?: React.ReactNode }
  onNameVersion: (_label: string) => Promise<boolean>
  onOpenHistory: () => void
  /** Conflict prompt (autosave and manual mode), shown under the controls. */
  conflict?: React.ReactNode
  /** The activity's live editing override (History menu). */
  liveEditing?: LiveEditingControl
  /** Live editing off: a Save button (⌘S). */
  manualSave?: { dirty: boolean; onSave: () => void; conflict: boolean }
  /** No History menu (translations have no version history). */
  hideHistory?: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className="relative flex items-center gap-1" data-testid="editor-header-controls">
      <div className="flex items-center gap-1">
        <SaveIndicator state={save} />
        {presence}
      </div>
      <HeaderMenu icon={<Eye size={HEADER_ICON} />} label={t('editor.preview', 'Preview')} testId="header-preview" width={220}>
        {(close) => (
          <div>
            <Link href={previewHref} target="_blank" className={HMENU_ITEM} onClick={close}>
              <ArrowSquareOut size={HEADER_ICON} className="text-neutral-500" />
              <span className="flex-1">{t('editor.preview_open', 'Open learner view')}</span>
            </Link>
            <button
              type="button"
              className={HMENU_ITEM}
              onClick={() => {
                close()
                onViewAs()
              }}
            >
              <UserFocus size={HEADER_ICON} className="text-neutral-500" />
              <span className="flex-1">{t('editor.dynamic.view_as', 'View as')}</span>
            </button>
          </div>
        )}
      </HeaderMenu>
      {!hideHistory && (
      <HeaderMenu icon={<ClockCounterClockwise size={HEADER_ICON} />} label={t('editor.history.title', 'History')} testId="header-history" width={280}>
        {(close) => (
          <HistoryMenuBody
            activityUuid={activityUuid}
            close={close}
            canName={canName}
            versioning={versioning}
            onName={onNameVersion}
            onOpenHistory={onOpenHistory}
            liveEditing={liveEditing}
          />
        )}
      </HeaderMenu>
      )}
      {/* ActivityComments docks its "Comments (n)" button here */}
      <span id={COMMENTS_SLOT_ID} className="contents" />
      {manualSave && (
        <button
          type="button"
          onClick={manualSave.onSave}
          data-testid="manual-save"
          title={t('editor.save_shortcut', 'Save (⌘S)')}
          aria-label={t('editor.save', 'Save')}
          className={
            manualSave.dirty
              ? 'inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-sky-600 px-2 sm:px-2.5 text-[13px] font-semibold text-white shadow-[0_1px_1px_rgba(0,0,0,0.08),0_0_0_1px_rgba(2,132,199,0.9)] transition-colors hover:bg-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600/30'
              : HBTN
          }
        >
          <FloppyDisk size={HEADER_ICON} />
          <span className={HLABEL}>{t('editor.save', 'Save')}</span>
          <kbd className={`hidden rounded px-1 font-sans text-[11px] lg:inline ${manualSave.dirty ? 'bg-white/20' : 'bg-neutral-100 text-neutral-500'}`}>⌘S</kbd>
        </button>
      )}
      {conflict}
    </div>
  )
}
