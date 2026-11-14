'use client'

// A play activity whose play can't run: Plays are unavailable for the org
// (no Enterprise, no license, plan, feature off) or the linked play is gone.
// It must not hold learners back, so they mark it complete themselves (the
// API allows it exactly in this case); editors get a way to relink it.

import React, { useState } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ArrowsClockwise, CheckCircle, Lightning } from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg, useOrgMembership } from '@components/Contexts/OrgContext'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { Button, buttonClass } from '@/design'
import { queryKeys } from '@lib/query/keys'
import { useTrail } from '@/hooks/queries/useTrail'
import { markActivityAsComplete } from '@services/courses/activity'

export default function PlayUnavailable({
  activity,
  course,
  orgslug,
  reason = 'unavailable',
}: {
  activity: any
  course?: any
  orgslug?: string
  /** enterprise: Plays need Enterprise; missing: the linked play is gone; unavailable: anything else. */
  reason?: 'enterprise' | 'missing' | 'unavailable'
}) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const token: string | undefined = session?.data?.tokens?.access_token
  const { isUserPartOfTheOrg } = useOrgMembership() as any
  const { isAdmin } = useAdminStatus()
  const queryClient = useQueryClient()
  const { data: trail } = useTrail(org?.id) as { data: any }
  const [saving, setSaving] = useState(false)

  const courseUuid: string = course?.course_uuid ?? ''
  const cleanCourse = courseUuid.replace(/^course_/, '')
  const done = !!trail?.runs
    ?.find((r: any) => (r.course?.course_uuid ?? r.course_uuid ?? '').replace(/^course_/, '') === cleanCourse)
    ?.steps?.some((s: any) => s.activity_id === activity?.id && s.complete)

  const markDone = async () => {
    if (saving || !token) return
    setSaving(true)
    try {
      const updated = await markActivityAsComplete(orgslug ?? org?.slug, courseUuid, activity.activity_uuid, token)
      if (updated?.runs) queryClient.setQueryData(queryKeys.trail.org(org?.id), updated)
      else await queryClient.invalidateQueries({ queryKey: queryKeys.trail.org(org?.id) })
    } catch {
      toast.error(t('activities.failed_mark_complete'))
    } finally {
      setSaving(false)
    }
  }

  const title =
    reason === 'missing'
      ? t('play_activity.learner.missing_title', 'This play is no longer available')
      : reason === 'enterprise'
        ? t('play_activity.needs_enterprise', 'This activity needs LearnHouse Enterprise')
        : t('play_activity.learner.unavailable', 'This play is not available')

  return (
    <div className="lh-play-activity flex flex-col items-center justify-center gap-4 rounded-2xl bg-white px-6 py-12 text-center nice-shadow max-sm:-mx-4 max-sm:rounded-none max-sm:shadow-none max-sm:border-y max-sm:border-black/[0.05]">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-400">
        <Lightning size={22} weight="duotone" />
      </span>
      <div>
        <p className="text-base font-semibold text-neutral-900">{title}</p>
        {isUserPartOfTheOrg && token && (
          <p className="mt-1 max-w-sm text-sm text-neutral-500">
            {done
              ? t('play_activity.learner.unavailable_done', 'You marked this activity complete.')
              : t('play_activity.learner.unavailable_body', 'You can mark it complete to keep going.')}
          </p>
        )}
      </div>
      {isUserPartOfTheOrg && token && (
        done ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 px-3 py-1.5 text-sm font-semibold text-teal-700 ring-1 ring-inset ring-teal-200">
            <CheckCircle size={16} weight="fill" />
            {t('common.completed')}
          </span>
        ) : (
          <Button variant="primary" loading={saving} onClick={markDone}>
            {t('activities.mark_as_complete')}
          </Button>
        )
      )}
      {isAdmin && cleanCourse && reason !== 'enterprise' && (
        <Link href={`/dash/courses/course/${cleanCourse}/content`} className={buttonClass('secondary', 'sm')}>
          <ArrowsClockwise size={14} />
          {t('play_activity.change_play', 'Change play')}
        </Link>
      )}
    </div>
  )
}
