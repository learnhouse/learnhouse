'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { EnvelopeSimple, Gear, NotePencil, PencilSimple, Phone, PushPin, PushPinSlash, Trash } from '@phosphor-icons/react'
import { Button, ConfirmDialog, EmptyState, Panel, SegmentedControl, TEXTAREA, formatRelative } from '@/design'
import { addOrgNote, deleteOrgNote, errorMessage, getOrgNotes, updateOrgNote } from '@services/ee/platform/api'
import { platformKeys } from '@services/ee/platform/keys'
import type { OrgNote } from '@services/ee/platform/types'
import { useAccessToken, usePlatformMe, shouldRetry } from '@components/Admin/hooks'
import { ListSkeleton, QueryError, formatDate } from '@components/Admin/Shared/AdminKit'
import { MarkdownPreview } from '@components/Admin/Emails/markdown'

type Kind = 'note' | 'call' | 'email'

const KIND_ICON: Record<string, React.ReactNode> = {
  note: <NotePencil size={14} weight="duotone" />,
  call: <Phone size={14} weight="duotone" />,
  email: <EnvelopeSimple size={14} weight="duotone" />,
  system: <Gear size={14} weight="duotone" />,
}

function NoteItem({
  note,
  canWrite,
  canEdit,
  canDelete,
  onPin,
  onSave,
  onDelete,
}: {
  note: OrgNote
  canWrite: boolean
  canEdit: boolean
  canDelete: boolean
  onPin: () => void
  onSave: (_body: string) => Promise<void>
  onDelete: () => void
}) {
  const { t, i18n } = useTranslation()
  const [editing, setEditing] = React.useState(false)
  const [body, setBody] = React.useState(note.body)
  const [saving, setSaving] = React.useState(false)

  return (
    <div className={`px-5 py-4 ${note.pinned ? 'bg-amber-50/40' : ''}`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 h-7 w-7 shrink-0 rounded-lg bg-neutral-100 text-neutral-500 flex items-center justify-center" title={t(`admin.org.note_kind.${note.kind}`, { defaultValue: note.kind })}>
          {KIND_ICON[note.kind] ?? KIND_ICON.note}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-neutral-400">
            <span className="font-semibold text-neutral-700">{note.author_label || t('admin.org.note_kind.system')}</span>
            <span aria-hidden="true">·</span>
            <span>{t(`admin.org.note_kind.${note.kind}`, { defaultValue: note.kind })}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={note.created_at} title={formatDate(note.created_at, i18n.language, true)}>
              {formatRelative(note.created_at, i18n.language)}
            </time>
            {note.pinned && (
              <span className="inline-flex items-center gap-1 text-amber-700">
                <PushPin size={11} weight="fill" />
                {t('admin.org.pinned')}
              </span>
            )}
          </div>
          {editing ? (
            <div className="mt-2 space-y-2">
              <textarea rows={4} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} className={TEXTAREA} />
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    setBody(note.body)
                    setEditing(false)
                  }}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  loading={saving}
                  disabled={!body.trim() || body === note.body}
                  onClick={async () => {
                    setSaving(true)
                    try {
                      await onSave(body.trim())
                      setEditing(false)
                    } finally {
                      setSaving(false)
                    }
                  }}
                >
                  {t('common.save')}
                </Button>
              </div>
            </div>
          ) : (
            // Safe renderer: React elements only (no innerHTML); {{…}} is left as typed.
            <MarkdownPreview source={note.body} values={{}} className="mt-1 text-sm text-neutral-800 break-words space-y-2" />
          )}
        </div>
        {!editing && (canWrite || canDelete) && (
          <div className="flex items-center gap-0.5 shrink-0">
            {canWrite && (
              <button
                type="button"
                onClick={onPin}
                title={note.pinned ? t('admin.org.unpin') : t('admin.org.pin')}
                aria-label={note.pinned ? t('admin.org.unpin') : t('admin.org.pin')}
                className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-neutral-400 hover:text-neutral-800 hover:bg-neutral-100"
              >
                {note.pinned ? <PushPinSlash size={14} /> : <PushPin size={14} />}
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                title={t('admin.org.edit_note')}
                aria-label={t('admin.org.edit_note')}
                className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-neutral-400 hover:text-neutral-800 hover:bg-neutral-100"
              >
                <PencilSimple size={14} />
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                onClick={onDelete}
                title={t('admin.org.delete_note')}
                aria-label={t('admin.org.delete_note')}
                className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-neutral-400 hover:text-rose-600 hover:bg-rose-50"
              >
                <Trash size={14} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function NotesSection({ orgId, focusComposer = 0 }: { orgId: string; focusComposer?: number }) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const qc = useQueryClient()
  const me = usePlatformMe()
  const canWrite = me.can('notes.write')
  const isManager = me.role === 'owner' || me.role === 'admin'
  const key = platformKeys.orgNotes(orgId)
  const q = useQuery({ queryKey: key, queryFn: () => getOrgNotes(token, orgId), enabled: !!token, retry: shouldRetry })
  const [body, setBody] = React.useState('')
  const [kind, setKind] = React.useState<Kind>('note')
  const [pinned, setPinned] = React.useState(false)
  const [adding, setAdding] = React.useState(false)
  const [toDelete, setToDelete] = React.useState<OrgNote | null>(null)
  const composerRef = React.useRef<HTMLTextAreaElement>(null)
  // "Add note" in the header opens this tab and puts the cursor in the box.
  React.useEffect(() => {
    if (focusComposer > 0) requestAnimationFrame(() => composerRef.current?.focus())
  }, [focusComposer, q.isLoading])

  const notes = React.useMemo(() => {
    const list = Array.isArray(q.data) ? [...q.data] : []
    return list.sort((a, b) => Number(b.pinned) - Number(a.pinned) || new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  }, [q.data])

  const refresh = () => {
    qc.invalidateQueries({ queryKey: key })
    qc.invalidateQueries({ queryKey: platformKeys.orgActivity(orgId) })
  }

  const add = async () => {
    if (!body.trim()) return
    setAdding(true)
    try {
      await addOrgNote(token, orgId, { body: body.trim(), kind, pinned })
      setBody('')
      setPinned(false)
      refresh()
    } catch (err) {
      toast.error(errorMessage(err, t('admin.common.error_desc')))
    } finally {
      setAdding(false)
    }
  }

  const togglePin = async (note: OrgNote) => {
    // Optimistic: pin state flips at once and rolls back on failure.
    qc.setQueryData<OrgNote[]>(key, (prev) => (Array.isArray(prev) ? prev.map((n) => (n.id === note.id ? { ...n, pinned: !n.pinned } : n)) : prev))
    try {
      await updateOrgNote(token, orgId, note.id, { pinned: !note.pinned })
    } catch (err) {
      toast.error(errorMessage(err, t('admin.common.error_desc')))
    } finally {
      refresh()
    }
  }

  const saveBody = async (note: OrgNote, next: string) => {
    try {
      await updateOrgNote(token, orgId, note.id, { body: next })
      refresh()
    } catch (err) {
      toast.error(errorMessage(err, t('admin.common.error_desc')))
      throw err
    }
  }

  const remove = async () => {
    if (!toDelete) return
    try {
      await deleteOrgNote(token, orgId, toDelete.id)
      toast.success(t('admin.org.note_deleted'))
      refresh()
    } catch (err) {
      toast.error(errorMessage(err, t('admin.common.error_desc')))
    }
  }

  if (q.isLoading) return <ListSkeleton rows={3} />
  if (q.error) return <QueryError error={q.error} onRetry={() => q.refetch()} />

  return (
    <div className="space-y-4">
      {canWrite && (
        <Panel padded className="space-y-3">
          <textarea
            ref={composerRef}
            rows={3}
            maxLength={5000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') add()
            }}
            placeholder={t('admin.org.note_placeholder')}
            className={TEXTAREA}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <SegmentedControl
                value={kind}
                onChange={setKind}
                ariaLabel={t('admin.org.note_kind_label')}
                options={(['note', 'call', 'email'] as const).map((k) => ({
                  key: k,
                  label: (
                    <span className="inline-flex items-center gap-1">
                      {KIND_ICON[k]}
                      {t(`admin.org.note_kind.${k}`)}
                    </span>
                  ),
                }))}
              />
              <label className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-600 cursor-pointer">
                <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="accent-neutral-900" />
                {t('admin.org.pin')}
              </label>
            </div>
            <Button variant="primary" onClick={add} disabled={!body.trim()} loading={adding}>
              {t('admin.org.add_note')}
            </Button>
          </div>
        </Panel>
      )}

      {notes.length === 0 ? (
        <Panel>
          <EmptyState icon={<NotePencil size={22} />} title={t('admin.org.no_notes_title')} description={t('admin.org.no_notes_desc')} />
        </Panel>
      ) : (
        <Panel divided>
          {notes.map((n) => {
            const own = me.userId !== undefined && n.author_user_id === me.userId
            return (
              <NoteItem
                key={n.id}
                note={n}
                // The API lets only the author change a note, pin included.
                canWrite={canWrite && own && n.kind !== 'system'}
                canEdit={canWrite && own && n.kind !== 'system'}
                canDelete={own || isManager}
                onPin={() => togglePin(n)}
                onSave={(next) => saveBody(n, next)}
                onDelete={() => setToDelete(n)}
              />
            )
          })}
        </Panel>
      )}

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={t('admin.org.delete_note_title')}
        message={t('admin.org.delete_note_desc')}
        confirmLabel={t('admin.org.delete_note')}
        onConfirm={remove}
      />
    </div>
  )
}
