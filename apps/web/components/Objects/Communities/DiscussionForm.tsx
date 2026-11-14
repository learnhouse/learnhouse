'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Check } from '@phosphor-icons/react'
import { DISCUSSION_LABELS } from '@services/communities/discussions'
import { FieldLabel, INPUT } from '@components/Dashboard/Shared/DashKit/DashKit'
import { DiscussionEditor } from './DiscussionEditor'
import { EmojiPicker } from './EmojiPicker'
import { LabelIcon } from './communityUi'

export const TITLE_MIN = 5
export const TITLE_MAX = 200

export function validateDiscussionTitle(value: string, t: (_k: string) => string) {
  if (!value.trim()) return t('communities.create_discussion.title_required')
  if (value.trim().length < TITLE_MIN) return t('communities.create_discussion.title_min_length')
  if (value.length > TITLE_MAX) return t('communities.create_discussion.title_max_length')
  return null
}

/** Labels as a single row of chips: one is always selected. */
export function LabelChoice({ value, onChange }: { value: string; onChange: (_id: string) => void }) {
  const { t } = useTranslation()
  return (
    <div role="radiogroup" aria-label={t('communities.create_discussion.category_label')} className="flex flex-wrap gap-1.5">
      {DISCUSSION_LABELS.map((label) => {
        const selected = value === label.id
        return (
          <button
            key={label.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(label.id)}
            className={`inline-flex items-center gap-1.5 h-8 ps-2.5 pe-3 rounded-full text-xs font-semibold transition-all ${
              selected
                ? 'bg-neutral-900 text-white shadow-sm'
                : 'bg-white text-neutral-600 ring-1 ring-inset ring-neutral-900/10 hover:ring-neutral-900/25 hover:text-neutral-900'
            }`}
          >
            {selected ? <Check size={13} weight="bold" /> : <LabelIcon label={label.id} size={13} />}
            {t(`communities.labels.${label.id}`, { defaultValue: label.name })}
          </button>
        )
      })}
    </div>
  )
}

/** Emoji + title on one line, as the thread shows them. */
export function TitleField({
  title,
  onTitleChange,
  emoji,
  onEmojiChange,
  error,
  autoFocus,
  below,
}: {
  title: string
  onTitleChange: (_v: string) => void
  emoji: string | null
  onEmojiChange: (_v: string | null) => void
  error?: string | null
  autoFocus?: boolean
  /** Slot under the input, e.g. similar discussions. */
  below?: React.ReactNode
}) {
  const { t } = useTranslation()
  return (
    <div>
      <FieldLabel error={error ?? undefined} hint={`${title.length}/${TITLE_MAX}`}>
        {t('communities.create_discussion.title_label')}
      </FieldLabel>
      <div className="flex gap-2">
        <EmojiPicker
          value={emoji}
          onChange={onEmojiChange}
          triggerClassName={`flex items-center justify-center w-9 h-9 rounded-lg transition-colors shrink-0 ${
            emoji ? 'bg-neutral-100 ring-1 ring-inset ring-neutral-200' : 'border border-dashed border-neutral-300 hover:border-neutral-400'
          }`}
        />
        <input
          type="text"
          value={title}
          maxLength={TITLE_MAX + 20}
          autoFocus={autoFocus}
          aria-label={t('communities.create_discussion.title_label')}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder={t('communities.create_discussion.title_placeholder')}
          className={`${INPUT} flex-1`}
          dir="auto"
        />
      </div>
      <p className="mt-1.5 text-xs text-neutral-400">{t('communities.learner.compose.title_hint')}</p>
      {below}
    </div>
  )
}

export function BodyField({
  content,
  onChange,
  allowRichContent,
  placeholder,
}: {
  content: any
  onChange: (_c: any) => void
  allowRichContent: boolean
  placeholder?: string
}) {
  const { t } = useTranslation()
  return (
    <div>
      <FieldLabel hint={t('communities.learner.compose.optional')}>{t('communities.learner.compose.details')}</FieldLabel>
      <div className="rounded-lg ring-1 ring-inset ring-neutral-200 focus-within:ring-2 focus-within:ring-neutral-900/15 overflow-hidden">
        <DiscussionEditor
          content={content}
          onChange={onChange}
          placeholder={placeholder ?? t('communities.create_discussion.details_placeholder')}
          minHeight="160px"
          allowRichContent={allowRichContent}
        />
      </div>
      <p className="mt-1.5 text-xs text-neutral-400">
        {allowRichContent ? t('communities.create_discussion.rich_content_hint') : t('communities.create_discussion.editor_hint')}
      </p>
    </div>
  )
}
