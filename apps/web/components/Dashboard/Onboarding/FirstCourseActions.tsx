'use client'
import React from 'react'
import { CircleNotch, FileText } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { buttonClass } from '@/design'
import { AIButton } from '@components/Objects/AI/AIBrand'
import { useFirstCourse } from './useFirstCourse'

/**
 * The launch plan's first step, done in one click: a ready draft from the
 * template (opens in the editor) or the AI course builder. Replaces the
 * "Do it" link that only led to a chooser.
 */
export default function FirstCourseActions({ onStart }: { onStart?: () => void }) {
  const { t } = useTranslation()
  const { canUseAI, busy, startTemplate, startAI, aiModal } = useFirstCourse('launch_plan')
  return (
    <>
      <button
        type="button"
        onClick={() => {
          onStart?.()
          startTemplate()
        }}
        disabled={!!busy}
        className={buttonClass('primary', 'sm')}
        data-first-course="template"
      >
        {busy === 'template' ? <CircleNotch size={12} className="animate-spin" /> : <FileText size={12} weight="bold" />}
        {t('onb2.first_course.template_short')}
      </button>
      {canUseAI && (
        <AIButton
          size="sm"
          variant="soft"
          onClick={() => {
            onStart?.()
            startAI()
          }}
          data-first-course="ai"
        >
          {t('onb2.first_course.ai_short')}
        </AIButton>
      )}
      {aiModal}
    </>
  )
}
