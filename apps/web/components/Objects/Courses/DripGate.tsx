'use client'

import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import { DripIcon, useDripLabel } from '@components/Objects/Courses/DripBadge'

type DripGateProps = {
  activityName: string
  dripReason: string
  dripUnlockAt?: string | null
  courseHref: string
}

/** Full-page notice for an activity whose chapter the drip schedule hasn't released yet. */
export default function DripGate(props: DripGateProps) {
  const { t } = useTranslation()
  const { label, detail } = useDripLabel()({
    drip_reason: props.dripReason,
    drip_unlock_at: props.dripUnlockAt,
  })

  const explanation =
    props.dripReason === 'enrollment'
      ? t('course.drip.gate_enrollment', 'This course releases its chapters over time, starting when you begin the course. Start it from the course page to unlock your schedule.')
      : props.dripReason === 'previous'
        ? t('course.drip.gate_previous', 'Finish every lesson of the previous chapter and this one opens right away.')
        : t('course.drip.gate_schedule', 'This course releases its chapters over time. Come back when this one opens.')

  return (
    <GeneralWrapperStyled>
      <div
        data-testid="drip-gate"
        className="max-w-2xl mx-auto my-16 bg-white rounded-2xl border border-gray-200/80 shadow-sm p-8 text-center"
      >
        <div className="mx-auto w-14 h-14 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mb-4">
          <DripIcon reason={props.dripReason} size={24} />
        </div>
        {props.activityName && (
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">{props.activityName}</p>
        )}
        <h1 className="text-xl font-semibold text-gray-900">{label}</h1>
        {detail && <p className="text-sm font-medium text-amber-600 mt-1">{detail}</p>}
        <p className="text-sm text-gray-500 mt-4 mb-6 leading-relaxed">{explanation}</p>
        <Link
          href={props.courseHref}
          className="inline-flex items-center justify-center px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-semibold hover:bg-gray-800 transition-colors"
        >
          {t('course.back_to_course', 'Back to course')}
        </Link>
      </div>
    </GeneralWrapperStyled>
  )
}
