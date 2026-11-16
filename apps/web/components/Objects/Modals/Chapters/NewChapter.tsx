import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { INPUT, TEXTAREA } from '@components/Dashboard/Shared/DashKit/DashKit'
import { ActivityField, ModalFormActions, useModalFormId } from '@components/Objects/Modals/Activities/activityFormKit'
import { ChapterEmojiButton } from '@components/Dashboard/Pages/Course/EditCourseStructure/DraggableElements/ChapterEmojiButton'

// Name is all a chapter needs; the description is optional and can be added later.
function NewChapterModal({ submitChapter, course }: any) {
  const { t } = useTranslation()
  const formId = useModalFormId()
  const [chapterName, setChapterName] = useState('')
  const [chapterDescription, setChapterDescription] = useState('')
  const [emoji, setEmoji] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!chapterName.trim() || isSubmitting) return
    setIsSubmitting(true)
    try {
      await submitChapter({
        name: chapterName.trim(),
        description: chapterDescription.trim(),
        thumbnail_image: '',
        course_id: course.id,
        org_id: course.org_id,
        ...(emoji ? { extra_metadata: { emoji } } : {}),
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form id={formId} onSubmit={handleSubmit} className="space-y-4">
      <ActivityField
        label={t('dashboard.courses.structure.modals.new_chapter.form.name_label')}
        htmlFor="chapter-name"
        hint={t('dashboard.courses.editor.chapter_form.name_hint')}
      >
        <div className="flex items-center gap-2">
          {/* Optional emoji, shown before the chapter name everywhere. */}
          <ChapterEmojiButton emoji={emoji} onChange={setEmoji} />
          <input
            id="chapter-name"
            autoFocus
            value={chapterName}
            onChange={(e) => setChapterName(e.target.value)}
            type="text"
            required
            placeholder={t('dashboard.courses.editor.chapter_form.name_placeholder')}
            className={INPUT}
          />
        </div>
      </ActivityField>
      <ActivityField
        label={t('dashboard.courses.structure.modals.new_chapter.form.description_label')}
        htmlFor="chapter-desc"
        aside={<span className="text-xs text-neutral-400">{t('dashboard.courses.editor.chapter_form.optional')}</span>}
      >
        <textarea
          id="chapter-desc"
          rows={3}
          value={chapterDescription}
          onChange={(e) => setChapterDescription(e.target.value)}
          placeholder={t('dashboard.courses.editor.chapter_form.description_placeholder')}
          className={TEXTAREA}
        />
      </ActivityField>
      <ModalFormActions
        submitting={isSubmitting}
        canSubmit={!!chapterName.trim()}
        label={t('dashboard.courses.structure.modals.new_chapter.form.submit')}
      />
    </form>
  )
}

export default NewChapterModal
