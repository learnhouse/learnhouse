'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  ArrowClockwise,
  ArrowRight,
  BookOpen,
  Buildings,
  CalendarPlus,
  ClockCounterClockwise,
  Globe,
  Handshake,
  Heartbeat,
  Pulse,
  PushPin,
  ShieldStar,
  Users,
} from '@phosphor-icons/react'
import { AIMark, Button, SectionCard, StatCard, formatRelative } from '@/design'
import { errorMessage, getAiCredits, getOrgActivity, getOrgAnalytics, getOrgNotes, recomputeHealth } from '@services/ee/platform/api'
import { platformKeys } from '@services/ee/platform/keys'
import type { OrgProfile } from '@services/ee/platform/types'
import { useAccessToken, usePlatformMe, shouldRetry } from '@components/Admin/hooks'
import { Avatar, KeyValue, QueryError, asList, formatDate, healthStatus } from '@components/Admin/Shared/AdminKit'
import { AuditEventList } from '@components/Admin/Shared/AuditEventList'
import { MarkdownPreview } from '@components/Admin/Emails/markdown'
import { PocProgress } from '@components/Admin/Pocs/pocUi'
import { useInvalidateOrg } from '../orgQueries'
import OrgTasksCard from './OrgTasksCard'
import SignalsCard from './SignalsCard'

// "At a glance": the numbers, what needs attention (POC clock, health), what
// the team said (pinned notes) and what happened lately. Every block links to
// the tab with the full story.

const HEALTH_RING: Record<string, string> = {
  success: 'text-emerald-600',
  warning: 'text-amber-600',
  danger: 'text-rose-600',
  neutral: 'text-neutral-400',
}

/** "2 hr. ago" style: short enough for a stat tile. */
function shortRelative(value: string | null | undefined, locale: string): string | null {
  if (!value) return null
  const time = new Date(value).getTime()
  if (isNaN(time)) return null
  const s = Math.round((time - Date.now()) / 1000)
  const abs = Math.abs(s)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' })
  if (abs < 60) return rtf.format(s, 'second')
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour')
  if (abs < 86400 * 30) return rtf.format(Math.round(s / 86400), 'day')
  if (abs < 86400 * 365) return rtf.format(Math.round(s / (86400 * 30)), 'month')
  return rtf.format(Math.round(s / (86400 * 365)), 'year')
}

function SeeAll({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-xs font-semibold text-neutral-500 hover:text-neutral-900">
      {label}
      <ArrowRight size={12} className="rtl:rotate-180" />
    </button>
  )
}

export default function OverviewSection({
  org,
  orgId,
  profile,
  profileError,
  onOpenSection,
  onExtendPoc,
}: {
  org: any
  orgId: string
  profile?: OrgProfile
  profileError?: unknown
  onOpenSection: (_section: string) => void
  onExtendPoc?: () => void
}) {
  const { t, i18n } = useTranslation()
  const token = useAccessToken()
  const me = usePlatformMe()
  const invalidate = useInvalidateOrg(orgId)
  const canAudit = me.can('audit.read')

  const creditsQ = useQuery({ queryKey: platformKeys.aiCredits(orgId), queryFn: () => getAiCredits(token, orgId), enabled: !!token, retry: shouldRetry })
  const weekQ = useQuery({
    queryKey: platformKeys.orgAnalytics(orgId, 7),
    queryFn: () => getOrgAnalytics(token, orgId, 7),
    enabled: !!token,
    retry: shouldRetry,
  })
  const notesQ = useQuery({ queryKey: platformKeys.orgNotes(orgId), queryFn: () => getOrgNotes(token, orgId), enabled: !!token, retry: shouldRetry })
  const activityQ = useQuery({
    queryKey: platformKeys.orgActivity(orgId),
    queryFn: () => getOrgActivity(token, orgId),
    enabled: !!token && canAudit,
    retry: shouldRetry,
  })

  const dau: any[] = Array.isArray(weekQ.data?.daily_active_users?.data) ? weekQ.data!.daily_active_users.data : []
  const peakActive = dau.length ? Math.max(...dau.map((d) => Number(d.dau) || 0)) : null
  const credits = creditsQ.data?.remaining_credits
  const pinned = (Array.isArray(notesQ.data) ? notesQ.data : []).filter((n) => n.pinned).slice(0, 3)
  const recent = asList(activityQ.data).slice(0, 5)
  const admins: any[] = Array.isArray(org.admin_users) ? org.admin_users : []
  const domains: string[] = Array.isArray(org.custom_domains) ? org.custom_domains : []
  const health = profile?.health_score
  const band = healthStatus(health)
  const lastActivityShort = shortRelative(profile?.last_activity_at, i18n.language)

  const recompute = async () => {
    try {
      await recomputeHealth(token, orgId)
      toast.success(t('admin.org.health_updated'))
      invalidate()
    } catch (err) {
      toast.error(errorMessage(err, t('admin.common.error_desc')))
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard icon={<Users size={18} />} iconClass="bg-sky-50 text-sky-600" label={t('admin.org.tabs.members')} value={(org.user_count ?? 0).toLocaleString()} onClick={() => onOpenSection('people')} />
        <StatCard icon={<BookOpen size={18} />} iconClass="bg-emerald-50 text-emerald-600" label={t('admin.org_detail.tabs.courses')} value={(org.course_count ?? 0).toLocaleString()} onClick={() => onOpenSection('content')} />
        <StatCard
          icon={<Pulse size={18} />}
          iconClass="bg-violet-50 text-violet-600"
          label={t('admin.org.peak_active_7d')}
          value={weekQ.isLoading ? null : peakActive === null ? '–' : peakActive.toLocaleString()}
          onClick={() => onOpenSection('content')}
        />
        <StatCard
          icon={<AIMark size={18} alt="" />}
          iconClass="bg-amber-50 text-amber-600"
          label={t('admin.org.ai_credits_left')}
          value={creditsQ.isLoading ? null : typeof credits === 'number' ? credits.toLocaleString() : credits ?? '–'}
          onClick={() => onOpenSection('plan')}
        />
        {/* Odd one out: spans both columns on phones instead of sitting alone in half a row. */}
        <div className="col-span-2 lg:col-span-1 min-w-0 grid">
          <StatCard icon={<ClockCounterClockwise size={18} />} iconClass="bg-rose-50 text-rose-600" label={t('admin.org.last_activity')} value={lastActivityShort ?? '–'} />
        </div>
      </div>

      {profile?.lifecycle === 'poc' && (
        <SectionCard
          icon={<Handshake size={18} />}
          title={t('admin.org.poc_running')}
          description={profile.poc_goal || t('admin.org.poc_running_desc')}
          actions={
            <>
              {onExtendPoc && (
                <Button size="sm" icon={<CalendarPlus size={13} />} onClick={onExtendPoc}>
                  {t('admin.pocs.extend')}
                </Button>
              )}
              <SeeAll label={t('admin.org.poc_details')} onClick={() => onOpenSection('poc')} />
            </>
          }
        >
          <PocProgress startedAt={profile.poc_started_at} endsAt={profile.poc_ends_at} />
        </SectionCard>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
        <div className="xl:col-span-2 space-y-5 min-w-0">
          {canAudit && (
            <SectionCard
              icon={<ClockCounterClockwise size={18} />}
              title={t('admin.org.recent_activity')}
              description={t('admin.org.recent_activity_desc')}
              actions={<SeeAll label={t('admin.org.see_all')} onClick={() => onOpenSection('activity')} />}
              bodyClassName="pt-3 pb-2"
            >
              {activityQ.error ? (
                <div className="px-5 pb-3">
                  <QueryError error={activityQ.error} compact />
                </div>
              ) : activityQ.isLoading ? (
                <p className="px-5 pb-3 text-sm text-neutral-400">{t('common.loading')}</p>
              ) : recent.length === 0 ? (
                <p className="px-5 pb-3 text-sm text-neutral-400">{t('admin.org.no_activity_title')}</p>
              ) : (
                <AuditEventList events={recent} showOrg={false} bare />
              )}
            </SectionCard>
          )}

          <OrgTasksCard orgId={org.id} />

          <SectionCard
            icon={<PushPin size={18} />}
            title={t('admin.org.pinned_notes')}
            description={t('admin.org.pinned_notes_desc')}
            actions={<SeeAll label={t('admin.org.all_notes')} onClick={() => onOpenSection('notes')} />}
            bodyClassName="pt-3 pb-2"
          >
            {notesQ.error ? (
              <div className="px-5 pb-3">
                <QueryError error={notesQ.error} compact />
              </div>
            ) : pinned.length === 0 ? (
              <p className="px-5 pb-3 text-sm text-neutral-400">{t('admin.org.no_pinned')}</p>
            ) : (
              <ul className="divide-y divide-neutral-100">
                {pinned.map((n) => (
                  <li key={n.id} className="px-5 py-3">
                    <div className="line-clamp-3">
                      <MarkdownPreview source={n.body} values={{}} className="text-sm text-neutral-800 break-words space-y-1" />
                    </div>
                    <p className="mt-1 text-xs text-neutral-400">
                      {n.author_label} · {formatRelative(n.created_at, i18n.language)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>

        <div className="space-y-5 min-w-0">
          <SectionCard
            icon={<Heartbeat size={18} />}
            title={t('admin.common.health')}
            description={t('admin.org.health_drivers')}
          >
            {profileError && !profile ? (
              <QueryError error={profileError} compact />
            ) : (
              <div className="flex items-center gap-4">
                <span className={`text-4xl font-bold tabular-nums ${HEALTH_RING[band]}`}>{health ?? '–'}</span>
                <div className="min-w-0">
                  <p className={`text-sm font-semibold ${HEALTH_RING[band]}`}>{t(`admin.org.health_band.${band}`)}</p>
                  <p className="text-xs text-neutral-500">{t(`admin.org.health_band_desc.${band}`)}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-neutral-400">
                    {profile?.health_computed_at && <span>{t('admin.org.health_computed', { when: formatRelative(profile.health_computed_at, i18n.language) })}</span>}
                    {profile && (
                      <button type="button" onClick={recompute} className="inline-flex items-center gap-1 font-semibold text-neutral-500 hover:text-neutral-900">
                        <ArrowClockwise size={11} />
                        {t('admin.org.recompute')}
                      </button>
                    )}
                  </p>
                </div>
              </div>
            )}
          </SectionCard>

          <SignalsCard orgId={org.id} />

          <SectionCard icon={<Buildings size={18} />} title={t('admin.org.about')} description={t('admin.org.details_desc')}>
            <div className="divide-y divide-neutral-100">
              <KeyValue label={t('admin.org_detail.email')}>{org.email || '–'}</KeyValue>
              <KeyValue label={t('admin.org_detail.created')}>{formatDate(org.creation_date, i18n.language)}</KeyValue>
              <KeyValue label={t('admin.org_detail.custom_domains')}>
                {domains.length ? (
                  <span className="flex flex-col items-end gap-0.5">
                    {domains.map((d) => (
                      <span key={d} className="inline-flex items-center gap-1" dir="ltr">
                        <Globe size={12} className="text-emerald-600" />
                        {d}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="text-neutral-400">–</span>
                )}
              </KeyValue>
              <KeyValue label={t('admin.org_detail.admins')}>
                {admins.length ? (
                  <span className="flex flex-col items-end gap-1">
                    {admins.slice(0, 4).map((u) => (
                      <span key={u.username} className="inline-flex items-center gap-1.5">
                        <Avatar user={u} size={18} />
                        {u.username}
                      </span>
                    ))}
                    {admins.length > 4 && (
                      <button type="button" onClick={() => onOpenSection('people')} className="text-xs text-neutral-400 hover:text-neutral-700">
                        +{admins.length - 4}
                      </button>
                    )}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-neutral-400">
                    <ShieldStar size={12} />–
                  </span>
                )}
              </KeyValue>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  )
}
