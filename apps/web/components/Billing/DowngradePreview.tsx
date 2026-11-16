'use client'
// What moving to Free changes, before it happens: the features that pause, the
// courses that turn private (and the one that stays public), schedules that
// stop, and members or admins above Free's limits (kept, but none can be
// added). Computed by the API (plan-overview `downgrade_preview`); this only
// lays it out. Used by the trial card and the cancel confirmation.
import React from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen, Eye, LockSimple, Pause, Users } from '@phosphor-icons/react'
import type { DowngradePreview as Preview } from '@services/orgs/planOverview'

const P = 'billing.downgrade_preview'
const MAX_FEATURES = 8

export default function DowngradePreview({ preview, className = '' }: { preview: Preview; className?: string }) {
  const { t } = useTranslation()
  const { features, courses, members, admins } = preview
  const shown = features.slice(0, MAX_FEATURES)
  const more = features.length - shown.length
  const name = (key: string) => t(`dashboard.organization.plan_usage.features.names.${key}`, { defaultValue: key })

  return (
    <div className={`flex flex-col gap-3 text-sm ${className}`} data-testid="downgrade-preview">
      <p className="text-neutral-500">{t(`${P}.intro`)}</p>
      <ul className="flex flex-col divide-y divide-neutral-100 rounded-xl ring-1 ring-inset ring-neutral-200/70">
        {courses.public > 0 && courses.public_cap > 0 && (
          <Row icon={<Eye size={15} />} tone="sky">
            {courses.kept && (
              <span>
                {t(`${P}.course_kept`, { course: courses.kept.name })}
                {courses.made_private.length > 0 && ' '}
              </span>
            )}
            {courses.made_private.length > 0 && <span>{t(`${P}.courses_private`, { count: courses.made_private.length })}</span>}
          </Row>
        )}
        {courses.drip_paused > 0 && (
          <Row icon={<Pause size={15} />} tone="amber">{t(`${P}.drip_paused`, { count: courses.drip_paused })}</Row>
        )}
        {shown.length > 0 && (
          <Row icon={<LockSimple size={15} />} tone="neutral">
            <span>{t(`${P}.features_pause`)}</span>
            <span className="mt-1.5 flex flex-wrap gap-1.5">
              {shown.map((key) => (
                <span key={key} className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-xs font-medium text-neutral-600">
                  {name(key)}
                </span>
              ))}
              {more > 0 && <span className="px-1 py-0.5 text-xs text-neutral-400">{t(`${P}.more`, { count: more })}</span>}
            </span>
          </Row>
        )}
        {(members.over || admins.over) && (
          <Row icon={<Users size={15} />} tone="neutral">
            {members.over && <span className="block">{t(`${P}.members_over`, { count: members.count, limit: members.limit })}</span>}
            {admins.over && <span className="block">{t(`${P}.admins_over`, { count: admins.count, limit: admins.limit })}</span>}
          </Row>
        )}
        <Row icon={<BookOpen size={15} />} tone="emerald">{t(`${P}.nothing_deleted`)}</Row>
      </ul>
    </div>
  )
}

const TONE: Record<string, string> = {
  sky: 'bg-sky-50 text-sky-600',
  amber: 'bg-amber-50 text-amber-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  neutral: 'bg-neutral-100 text-neutral-500',
}

function Row({ icon, tone, children }: { icon: React.ReactNode; tone: keyof typeof TONE; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 px-3.5 py-3">
      <span className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg ${TONE[tone]}`}>{icon}</span>
      <span className="min-w-0 flex-1 text-neutral-700 leading-relaxed">{children}</span>
    </li>
  )
}
