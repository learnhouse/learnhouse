'use client'
import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { createDiscussion, DISCUSSION_LABELS, DiscussionLabelId } from '@services/communities/discussions'
import { mutateDiscussions } from '@components/Hooks/useDiscussions'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { DiscussionEditor } from '@components/Objects/Communities/DiscussionEditor'
import { EmojiPicker } from '@components/Objects/Communities/EmojiPicker'
import { Loader2, AlertCircle, MessageSquare, HelpCircle, Lightbulb, Megaphone, Star, Check } from 'lucide-react'

interface CreateDiscussionModalProps {
  isOpen: boolean
  onClose: () => void
  communityUuid: string
  orgSlug: string
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

export function CreateDiscussionModal({
  isOpen,
  onClose,
  communityUuid,
  orgSlug,
}: CreateDiscussionModalProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState<any>(null)
  const [titleError, setTitleError] = useState<string | null>(null)
  const [selectedLabel, setSelectedLabel] = useState<string>('general')
  const [selectedEmoji, setSelectedEmoji] = useState<string | null>(null)

  const accessToken = session?.data?.tokens?.access_token

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

    const validationError = validateTitle(title)
    if (validationError) {
      setTitleError(validationError)
      return
    }

    setIsSubmitting(true)
    setError(null)
    try {
      const result = await createDiscussion(
        communityUuid,
        {
          title: title.trim(),
          content: content ? JSON.stringify(content) : null,
          label: selectedLabel,
          emoji: selectedEmoji,
        },
        accessToken
      )

      if (result) {
        // Revalidate SWR cache to show new discussion immediately
        mutateDiscussions(communityUuid)
        // Reset form
        setTitle('')
        setContent(null)
        setSelectedLabel('general')
        setSelectedEmoji(null)
        onClose()
      }
    } catch (err: any) {
      const message =
        (err?.detail && typeof err.detail === 'object' && err.detail.message) ||
        (typeof err?.detail === 'string' && err.detail) ||
        err?.message ||
        t('communities.create_discussion.failed_to_create')
      setError(message)
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const isValid = !validateTitle(title)
  const hasContent = content && content.content && content.content.length > 0

  return (
    <Modal
      isDialogOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          setTitle('')
          setContent(null)
          setError(null)
          setTitleError(null)
          setSelectedLabel('general')
          setSelectedEmoji(null)
          onClose()
        }
      }}
      dialogTitle={t('communities.create_discussion.title')}
      dialogDescription={t('communities.create_discussion.description')}
      minWidth="lg"
      dialogContent={
        <form onSubmit={handleSubmit} className="space-y-5">
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
                  onClick={() => setSelectedLabel(label.id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${
                    selectedLabel === label.id
                      ? 'border-gray-900 bg-gray-50'
                      : 'border-gray-200 hover:border-gray-300 bg-white'
                  }`}
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
                triggerClassName={`flex items-center justify-center w-12 h-12 rounded-lg border-2 transition-colors flex-shrink-0 ${
                  selectedEmoji
                    ? 'border-gray-200 bg-gray-50'
                    : 'border-dashed border-gray-300 hover:border-gray-400'
                }`}
              />
              <div className="flex-1">
                <input
                  type="text"
                  name="title"
                  id="title"
                  value={title}
                  onChange={handleTitleChange}
                  placeholder={t('communities.create_discussion.title_placeholder')}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all h-12"
                />
              </div>
            </div>
            <p className="mt-1.5 text-xs text-gray-500">
              {selectedEmoji ? t('communities.create_discussion.emoji_selected') : t('communities.create_discussion.emoji_hint')}
            </p>
            {titleError && (
              <p className="mt-1 text-sm text-red-500">{titleError}</p>
            )}
          </div>

          {/* Content Editor */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('communities.create_discussion.details_label')}
            </label>
            <DiscussionEditor
              content={content}
              onChange={setContent}
              placeholder={t('communities.create_discussion.details_placeholder')}
              minHeight="180px"
            />
            <p className="mt-1.5 text-xs text-gray-500">
              {t('communities.create_discussion.editor_hint')}
            </p>
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
              {t('communities.create_discussion.cancel')}
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !isValid}
              className="px-4 py-2 text-sm font-medium text-white bg-neutral-900 hover:bg-neutral-800 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isSubmitting && <Loader2 size={16} className="animate-spin" />}
              {t('communities.create_discussion.submit')}
            </button>
          </div>
        </form>
      }
    />
  )
}

export default CreateDiscussionModal
