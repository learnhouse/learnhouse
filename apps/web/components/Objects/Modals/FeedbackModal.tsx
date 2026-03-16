'use client'

import React, { useState, useRef } from 'react'
import {
  ChatCircleDots,
  PaperPlaneTilt,
  Check,
  Smiley,
  SmileyMeh,
  SmileySad,
  ImageSquare,
  X,
} from '@phosphor-icons/react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@components/ui/dialog'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import * as Sentry from '@sentry/nextjs'

interface FeedbackModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  theme?: 'light' | 'dark'
  userName?: string
  userEmail?: string
}

export function FeedbackModal({
  open,
  onOpenChange,
  theme = 'light',
  userName,
  userEmail,
}: FeedbackModalProps) {
  const { t } = useTranslation()
  const [feedbackMessage, setFeedbackMessage] = useState('')
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false)
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false)
  const [feedbackReaction, setFeedbackReaction] = useState<'happy' | 'neutral' | 'sad' | null>(null)
  const [feedbackImages, setFeedbackImages] = useState<{ file: File; preview: string }[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isDark = theme === 'dark'

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files) return

    const newImages: { file: File; preview: string }[] = []
    Array.from(files).forEach((file) => {
      if (file.type.startsWith('image/') && feedbackImages.length + newImages.length < 3) {
        newImages.push({
          file,
          preview: URL.createObjectURL(file),
        })
      }
    })
    setFeedbackImages((prev) => [...prev, ...newImages].slice(0, 3))
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  function removeImage(index: number) {
    setFeedbackImages((prev) => {
      const newImages = [...prev]
      URL.revokeObjectURL(newImages[index].preview)
      newImages.splice(index, 1)
      return newImages
    })
  }

  function resetForm() {
    setFeedbackMessage('')
    setFeedbackReaction(null)
    feedbackImages.forEach((img) => URL.revokeObjectURL(img.preview))
    setFeedbackImages([])
  }

  async function submitFeedback() {
    if (!feedbackMessage.trim() && !feedbackReaction) return

    setFeedbackSubmitting(true)
    try {
      const reactionEmoji = feedbackReaction === 'happy' ? '😊' : feedbackReaction === 'neutral' ? '😐' : feedbackReaction === 'sad' ? '😞' : ''
      const fullMessage = `${reactionEmoji ? `[${reactionEmoji}] ` : ''}${feedbackMessage}`

      const attachments: { filename: string; data: Uint8Array; contentType: string }[] = []
      for (const img of feedbackImages) {
        const arrayBuffer = await img.file.arrayBuffer()
        attachments.push({
          filename: img.file.name,
          data: new Uint8Array(arrayBuffer),
          contentType: img.file.type,
        })
      }

      Sentry.captureFeedback({
        message: fullMessage,
        name: userName || 'Anonymous',
        email: userEmail || undefined,
      }, {
        includeReplay: true,
        attachments: attachments.length > 0 ? attachments : undefined,
      })

      setFeedbackSubmitted(true)
      resetForm()
      setTimeout(() => {
        onOpenChange(false)
        setFeedbackSubmitted(false)
      }, 2000)
    } catch (error) {
      console.error('Failed to submit feedback:', error)
    } finally {
      setFeedbackSubmitting(false)
    }
  }

  function handleOpenChange(newOpen: boolean) {
    onOpenChange(newOpen)
    if (!newOpen) {
      resetForm()
      setFeedbackSubmitted(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn(
          'sm:max-w-md',
          isDark
            ? 'bg-[#0f0f10] border-white/10 text-white'
            : 'bg-white border-gray-200'
        )}
      >
        <DialogHeader className="p-6 pb-2">
          <DialogTitle
            className={cn(
              'flex items-center gap-2',
              isDark ? 'text-white' : 'text-gray-900'
            )}
          >
            <ChatCircleDots size={20} weight="fill" />
            {t('common.help_menu.feedback_title')}
          </DialogTitle>
          <DialogDescription className={isDark ? 'text-white/60' : 'text-gray-500'}>
            {t('common.help_menu.feedback_description')}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-2">
          {feedbackSubmitted ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div
                className={cn(
                  'w-12 h-12 rounded-full flex items-center justify-center mb-3',
                  isDark ? 'bg-green-500/20' : 'bg-green-100'
                )}
              >
                <Check
                  size={24}
                  weight="bold"
                  className={isDark ? 'text-green-500' : 'text-green-600'}
                />
              </div>
              <p className={cn('font-medium', isDark ? 'text-white/90' : 'text-gray-900')}>
                {t('common.help_menu.feedback_success')}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Reaction Selection */}
              <div>
                <p className={cn('text-sm mb-2', isDark ? 'text-white/60' : 'text-gray-600')}>
                  {t('common.help_menu.how_was_experience')}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setFeedbackReaction(feedbackReaction === 'happy' ? null : 'happy')}
                    className={cn(
                      'flex-1 flex flex-col items-center gap-1 p-3 rounded-lg border transition-all',
                      feedbackReaction === 'happy'
                        ? isDark
                          ? 'border-green-500 bg-green-500/10 text-green-500'
                          : 'border-green-500 bg-green-50 text-green-600'
                        : isDark
                          ? 'border-white/10 hover:border-white/20 text-white/60 hover:text-white'
                          : 'border-gray-200 hover:border-gray-300 text-gray-400 hover:text-gray-600'
                    )}
                  >
                    <Smiley size={28} weight={feedbackReaction === 'happy' ? 'fill' : 'regular'} />
                    <span className="text-xs">{t('common.help_menu.reaction_happy')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFeedbackReaction(feedbackReaction === 'neutral' ? null : 'neutral')}
                    className={cn(
                      'flex-1 flex flex-col items-center gap-1 p-3 rounded-lg border transition-all',
                      feedbackReaction === 'neutral'
                        ? isDark
                          ? 'border-yellow-500 bg-yellow-500/10 text-yellow-500'
                          : 'border-yellow-500 bg-yellow-50 text-yellow-600'
                        : isDark
                          ? 'border-white/10 hover:border-white/20 text-white/60 hover:text-white'
                          : 'border-gray-200 hover:border-gray-300 text-gray-400 hover:text-gray-600'
                    )}
                  >
                    <SmileyMeh size={28} weight={feedbackReaction === 'neutral' ? 'fill' : 'regular'} />
                    <span className="text-xs">{t('common.help_menu.reaction_neutral')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFeedbackReaction(feedbackReaction === 'sad' ? null : 'sad')}
                    className={cn(
                      'flex-1 flex flex-col items-center gap-1 p-3 rounded-lg border transition-all',
                      feedbackReaction === 'sad'
                        ? isDark
                          ? 'border-red-500 bg-red-500/10 text-red-500'
                          : 'border-red-500 bg-red-50 text-red-600'
                        : isDark
                          ? 'border-white/10 hover:border-white/20 text-white/60 hover:text-white'
                          : 'border-gray-200 hover:border-gray-300 text-gray-400 hover:text-gray-600'
                    )}
                  >
                    <SmileySad size={28} weight={feedbackReaction === 'sad' ? 'fill' : 'regular'} />
                    <span className="text-xs">{t('common.help_menu.reaction_sad')}</span>
                  </button>
                </div>
              </div>

              {/* Message Input */}
              <textarea
                value={feedbackMessage}
                onChange={(e) => setFeedbackMessage(e.target.value)}
                aria-label={t('common.help_menu.feedback_placeholder')}
                placeholder={t('common.help_menu.feedback_placeholder')}
                className={cn(
                  'w-full h-28 px-3 py-2 rounded-lg resize-none',
                  isDark
                    ? 'bg-white/5 border border-white/10 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/20'
                    : 'bg-gray-50 border border-gray-200 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300'
                )}
              />

              {/* Image Upload */}
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleImageUpload}
                  className="hidden"
                />
                {feedbackImages.length > 0 && (
                  <div className="flex gap-2 mb-2">
                    {feedbackImages.map((img, index) => (
                      <div key={index} className="relative group">
                        <img
                          src={img.preview}
                          alt={`Upload ${index + 1}`}
                          className={cn(
                            'w-16 h-16 object-cover rounded-lg border',
                            isDark ? 'border-white/10' : 'border-gray-200'
                          )}
                        />
                        <button
                          type="button"
                          onClick={() => removeImage(index)}
                          className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X size={12} weight="bold" className="text-white" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {feedbackImages.length < 3 && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className={cn(
                      'flex items-center gap-2 text-sm transition-colors',
                      isDark
                        ? 'text-white/50 hover:text-white'
                        : 'text-gray-500 hover:text-gray-700'
                    )}
                  >
                    <ImageSquare size={18} />
                    <span>{t('common.help_menu.attach_image')}</span>
                    <span className={isDark ? 'text-white/30' : 'text-gray-400'}>
                      ({feedbackImages.length}/3)
                    </span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {!feedbackSubmitted && (
          <DialogFooter className="p-6 pt-2">
            <button
              onClick={() => handleOpenChange(false)}
              className={cn(
                'px-4 py-2 text-sm transition-colors',
                isDark
                  ? 'text-white/60 hover:text-white'
                  : 'text-gray-600 hover:text-gray-900'
              )}
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={submitFeedback}
              disabled={(!feedbackMessage.trim() && !feedbackReaction) || feedbackSubmitting}
              className={cn(
                'flex items-center gap-2 px-4 py-2 text-sm rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
                isDark
                  ? 'bg-white text-black hover:bg-white/90'
                  : 'bg-black text-white hover:bg-gray-800'
              )}
            >
              {feedbackSubmitting ? (
                t('common.help_menu.sending')
              ) : (
                <>
                  <PaperPlaneTilt size={16} weight="fill" />
                  {t('common.help_menu.send_feedback')}
                </>
              )}
            </button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
