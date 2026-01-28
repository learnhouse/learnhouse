'use client'
import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { updateDiscussion, DISCUSSION_LABELS, DiscussionWithAuthor } from '@services/communities/discussions'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { DiscussionEditor } from '@components/Objects/Communities/DiscussionEditor'
import { EmojiPicker } from '@components/Objects/Communities/EmojiPicker'
import { Loader2, AlertCircle, MessageSquare, HelpCircle, Lightbulb, Megaphone, Star, Check, Info } from 'lucide-react'

interface EditDiscussionModalProps {
  isOpen: boolean
  onClose: () => void
  discussion: DiscussionWithAuthor
  onUpdated: (updated: DiscussionWithAuthor) => void
}

// Get the icon component for a label
function getLabelIcon(iconName: string, size: number = 16) {
  switch (iconName) {
    case 'HelpCircle':
      return <HelpCircle size={size} />
    case 'Lightbulb':
      return <Lightbulb size={size} />
    case 'Megaphone':
      return <Megaphone size={size} />
    case 'Star':
      return <Star size={size} />
    default:
      return <MessageSquare size={size} />
  }
}

// Parse content - handles both JSON (tiptap) and plain text
function parseContent(content: string | null): any {
  if (!content) return null

  try {
    const parsed = JSON.parse(content)
    if (parsed && typeof parsed === 'object' && parsed.type === 'doc') {
      return parsed
    }
    return content
  } catch {
    return content
  }
}

const MAX_EDITS = 2

export function EditDiscussionModal({
  isOpen,
  onClose,
  discussion,
  onUpdated,
}: EditDiscussionModalProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState<any>(null)
  const [titleError, setTitleError] = useState<string | null>(null)
  const [selectedLabel, setSelectedLabel] = useState<string>('general')
  const [selectedEmoji, setSelectedEmoji] = useState<string | null>(null)

  const accessToken = session?.data?.tokens?.access_token
  const remainingEdits = MAX_EDITS - (discussion.edit_count || 0)
  const canEdit = remainingEdits > 0

  // Initialize form with discussion data
  useEffect(() => {
    if (isOpen && discussion) {
      setTitle(discussion.title || '')
      setContent(parseContent(discussion.content))
      setSelectedLabel(discussion.label || 'general')
      setSelectedEmoji(discussion.emoji || null)
      setError(null)
      setTitleError(null)
    }
  }, [isOpen, discussion])

  const validateTitle = (value: string) => {
    if (!value.trim()) {
      return t('communities.create_discussion.title_required')
    }
    if (value.trim().length < 5) {
      return t('communities.create_discussion.title_min_length')
    }
    if (value.length > 200) {
      return t('communities.create_discussion.title_max_length')
    }
    return null
  }

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setTitle(value)
    setTitleError(validateTitle(value))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!canEdit) {
      setError(t('communities.edit_discussion.max_edits_reached', { count: MAX_EDITS }))
      return
    }

    const validationError = validateTitle(title)
    if (validationError) {
      setTitleError(validationError)
      return
    }

    setIsSubmitting(true)
    setError(null)
    try {
      const result = await updateDiscussion(
        discussion.discussion_uuid,
        {
          title: title.trim(),
          content: content ? JSON.stringify(content) : null,
          label: selectedLabel,
          emoji: selectedEmoji,
        },
        accessToken
      )

      if (result) {
        onUpdated(result)
        onClose()
      }
    } catch (err: any) {
      console.error('Failed to update discussion:', err)
      if (err?.detail?.code === 'EDIT_LIMIT_REACHED') {
        setError(err.detail.message || t('communities.edit_discussion.max_edits_reached', { count: MAX_EDITS }))
      } else if (err?.detail?.code === 'MODERATION_BLOCKED') {
        setError(err.detail.message || t('communities.edit_discussion.content_not_allowed'))
      } else if (typeof err?.detail === 'string') {
        setError(err.detail)
      } else {
        setError(t('communities.edit_discussion.failed_to_update'))
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const isValid = !validateTitle(title)

  return (
    <Modal
      isDialogOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          onClose()
        }
      }}
      dialogTitle={t('communities.edit_discussion.title')}
      dialogDescription={t('communities.edit_discussion.description')}
      minWidth="lg"
      dialogContent={
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Edit count warning */}
          {canEdit ? (
            <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-100 rounded-lg text-blue-700 text-sm">
              <Info size={16} className="flex-shrink-0" />
              <span>
                {t('communities.edit_discussion.edits_remaining', { count: remainingEdits })}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-100 rounded-lg text-amber-700 text-sm">
              <AlertCircle size={16} className="flex-shrink-0" />
              <span>
                {t('communities.edit_discussion.no_edits_remaining', { count: MAX_EDITS })}
              </span>
            </div>
          )}

          {/* Label Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('communities.create_discussion.category_label')}
            </label>
            <div className="flex flex-wrap gap-2">
              {DISCUSSION_LABELS.map((label) => (
                <button
                  key={label.id}
                  type="button"
                  disabled={!canEdit}
                  onClick={() => setSelectedLabel(label.id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${
                    selectedLabel === label.id
                      ? 'border-gray-900 bg-gray-50'
                      : 'border-gray-200 hover:border-gray-300 bg-white'
                  } ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <span style={{ color: label.color }}>
                    {getLabelIcon(label.icon, 16)}
                  </span>
                  <span className={`text-sm ${selectedLabel === label.id ? 'font-medium text-gray-900' : 'text-gray-600'}`}>
                    {t(`communities.labels.${label.id}`)}
                  </span>
                  {selectedLabel === label.id && (
                    <Check size={14} className="text-gray-900" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Title with Emoji */}
          <div>
            <label
              htmlFor="title"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              {t('communities.create_discussion.title_label')} *
            </label>
            <div className="flex gap-3">
              {/* Emoji Picker */}
              <EmojiPicker
                value={selectedEmoji}
                onChange={setSelectedEmoji}
                disabled={!canEdit}
                triggerClassName={`flex items-center justify-center w-12 h-12 rounded-lg border-2 transition-colors flex-shrink-0 ${
                  selectedEmoji
                    ? 'border-gray-200 bg-gray-50'
                    : 'border-dashed border-gray-300 hover:border-gray-400'
                } ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}
              />
              <div className="flex-1">
                <input
                  type="text"
                  name="title"
                  id="title"
                  value={title}
                  onChange={handleTitleChange}
                  disabled={!canEdit}
                  placeholder={t('communities.create_discussion.title_placeholder')}
                  className={`w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all h-12 ${
                    !canEdit ? 'bg-gray-100 cursor-not-allowed' : ''
                  }`}
                />
              </div>
            </div>
            {titleError && (
              <p className="mt-1 text-sm text-red-500">{titleError}</p>
            )}
          </div>

          {/* Content Editor */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('communities.create_discussion.details_label')}
            </label>
            <div className={!canEdit ? 'opacity-50 pointer-events-none' : ''}>
              <DiscussionEditor
                content={content}
                onChange={setContent}
                placeholder={t('communities.create_discussion.details_placeholder')}
                minHeight="180px"
                editable={canEdit}
              />
            </div>
          </div>

          {/* Error message */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-lg text-red-700 text-sm">
              <AlertCircle size={16} className="flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              {canEdit ? t('communities.edit_discussion.cancel') : t('communities.edit_discussion.close')}
            </button>
            {canEdit && (
              <button
                type="submit"
                disabled={isSubmitting || !isValid}
                className="px-4 py-2 text-sm font-medium text-white bg-neutral-900 hover:bg-neutral-800 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isSubmitting && <Loader2 size={16} className="animate-spin" />}
                {t('communities.edit_discussion.save')}
              </button>
            )}
          </div>
        </form>
      }
    />
  )
}

export default EditDiscussionModal
