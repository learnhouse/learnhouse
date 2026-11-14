'use client'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { Info, PencilSimple, Warning } from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { updateDiscussion, DiscussionWithAuthor } from '@services/communities/discussions'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { Button, FieldLabel } from '@components/Dashboard/Shared/DashKit/DashKit'
import { BodyField, LabelChoice, TitleField, validateDiscussionTitle } from '@components/Objects/Communities/DiscussionForm'

interface EditDiscussionModalProps {
  isOpen: boolean
  onClose: () => void
  discussion: DiscussionWithAuthor
  onUpdated: (updated: DiscussionWithAuthor) => void
  allowRichContent?: boolean
}

const MAX_EDITS = 2

function parseContent(content: string | null): any {
  if (!content) return null
  try {
    const parsed = JSON.parse(content)
    if (parsed && typeof parsed === 'object' && parsed.type === 'doc') return parsed
    // Legacy plain text becomes one paragraph in the editor.
    return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: content }] }] }
  } catch {
    return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: content }] }] }
  }
}

export function EditDiscussionModal({
  isOpen,
  onClose,
  discussion,
  onUpdated,
  allowRichContent = false,
}: EditDiscussionModalProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState<any>(null)
  const [label, setLabel] = useState('general')
  const [emoji, setEmoji] = useState<string | null>(null)
  const [editorKey, setEditorKey] = useState(0)

  // Only authors are held to the edit limit; moderators editing someone
  // else's post are not (the API enforces the same rule).
  const isAuthor = session?.data?.user?.id === discussion.author_id
  const remainingEdits = MAX_EDITS - (discussion.edit_count || 0)
  const canEdit = !isAuthor || remainingEdits > 0

  // Fill the form from the post each time the dialog opens.
  const [wasOpen, setWasOpen] = useState(false)
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen)
    if (isOpen) {
      setTitle(discussion.title || '')
      setContent(parseContent(discussion.content))
      setLabel(discussion.label || 'general')
      setEmoji(discussion.emoji || null)
      setError(null)
      setEditorKey((k) => k + 1)
    }
  }

  const titleError = validateDiscussionTitle(title, t)

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!canEdit) {
      setError(t('communities.edit_discussion.max_edits_reached', { count: MAX_EDITS }))
      return
    }
    if (titleError) return

    setIsSubmitting(true)
    setError(null)
    try {
      const result = await updateDiscussion(
        discussion.discussion_uuid,
        { title: title.trim(), content: content ? JSON.stringify(content) : null, label, emoji },
        accessToken
      )
      if (result) {
        onUpdated(result)
        toast.success(t('communities.learner.compose.saved'))
        onClose()
      }
    } catch (err: any) {
      const message =
        (err?.detail && typeof err.detail === 'object' && err.detail.message) ||
        (typeof err?.detail === 'string' && err.detail) ||
        err?.message ||
        t('communities.edit_discussion.failed_to_update')
      setError(message)
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal
      isDialogOpen={isOpen}
      onOpenChange={(open) => !open && !isSubmitting && onClose()}
      icon={<PencilSimple size={16} />}
      size="lg"
      preventClose={isSubmitting}
      closeOnOutsideClick={false}
      dialogTitle={t('communities.edit_discussion.title')}
      dialogDescription={t('communities.edit_discussion.description')}
      dialogContent={
        <form id="edit-discussion-form" onSubmit={handleSubmit} className="flex flex-col gap-5">
          {isAuthor &&
            (canEdit ? (
              <div className="flex items-center gap-2 rounded-xl bg-sky-50 ring-1 ring-inset ring-sky-200/70 px-3.5 py-2.5 text-xs text-sky-800">
                <Info size={15} className="shrink-0" />
                <span>{t('communities.edit_discussion.edits_remaining', { count: remainingEdits })}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-xl bg-amber-50 ring-1 ring-inset ring-amber-200/70 px-3.5 py-2.5 text-xs text-amber-800">
                <Warning size={15} className="shrink-0" />
                <span>{t('communities.edit_discussion.no_edits_remaining', { count: MAX_EDITS })}</span>
              </div>
            ))}

          <fieldset disabled={!canEdit} className="flex flex-col gap-5 disabled:opacity-60">
            <div>
              <FieldLabel>{t('communities.create_discussion.category_label')}</FieldLabel>
              <LabelChoice value={label} onChange={setLabel} />
            </div>
            <TitleField
              title={title}
              onTitleChange={setTitle}
              emoji={emoji}
              onEmojiChange={setEmoji}
              error={title.length > 0 || !!error ? titleError : null}
            />
            <BodyField key={editorKey} content={content} onChange={setContent} allowRichContent={allowRichContent} />
          </fieldset>

          {error && (
            <div className="flex items-center gap-2 rounded-xl bg-rose-50 ring-1 ring-inset ring-rose-200 px-3.5 py-2.5 text-sm text-rose-700">
              <Warning size={16} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </form>
      }
      footer={
        <>
          <Button onClick={onClose} disabled={isSubmitting}>
            {canEdit ? t('communities.edit_discussion.cancel') : t('communities.edit_discussion.close')}
          </Button>
          {canEdit && (
            <Button type="submit" form="edit-discussion-form" variant="primary" loading={isSubmitting} disabled={!!titleError}>
              {t('communities.edit_discussion.save')}
            </Button>
          )}
        </>
      }
    />
  )
}

export default EditDiscussionModal
