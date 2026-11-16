'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { UseQueryResult } from '@tanstack/react-query'
import { Handshake, Plus } from '@phosphor-icons/react'
import { Button, EmptyState, Panel, SectionCard, Skeleton } from '@/design'
import type { OrgProfile } from '@services/ee/platform/types'
import { usePlatformMe } from '@components/Admin/hooks'
import Link from 'next/link'
import { Avatar, KeyValue, LifecycleChip, PlanChip, QueryError, adminPath, formatDate } from '@components/Admin/Shared/AdminKit'
import { PocActionButtons, PocActionDialog, type PocActionKind } from '@components/Admin/Pocs/PocActions'
import { PocDaysLeft, PocOutcomeChip, PocProgress } from '@components/Admin/Pocs/pocUi'
import StartPocDialog from '@components/Admin/Pocs/StartPocDialog'

export default function PocSection({ org, profileQ }: { org: any; orgId: string; profileQ: UseQueryResult<OrgProfile, unknown> }) {
  const { t, i18n } = useTranslation()
  const me = usePlatformMe()
  const canManage = me.can('pocs.manage')
  const [startOpen, setStartOpen] = React.useState(false)
  const [action, setAction] = React.useState<PocActionKind | null>(null)
  const profile = profileQ.data

  if (profileQ.isLoading) {
    return (
      <Panel padded className="space-y-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </Panel>
    )
  }
  if (profileQ.error) return <QueryError error={profileQ.error} onRetry={() => profileQ.refetch()} />

  const target = {
    id: org.id,
    name: org.name,
    plan: org.plan,
    poc_plan: profile?.poc_plan,
    poc_previous_plan: profile?.poc_previous_plan,
    poc_ends_at: profile?.poc_ends_at,
    lifecycle: profile?.lifecycle,
    poc_outcome: profile?.poc_outcome,
  }
  const hadPoc = !!profile?.poc_started_at
  const live = profile?.lifecycle === 'poc'
  const presetOrg = { id: org.id, name: org.name, slug: org.slug, org_uuid: org.org_uuid, logo_image: org.logo_image, plan: org.plan }

  if (!hadPoc && !live) {
    return (
      <>
        <Panel>
          <EmptyState
            icon={<Handshake size={22} />}
            title={t('admin.org.no_poc_title')}
            description={t('admin.org.no_poc_desc')}
            action={
              canManage ? (
                <Button variant="primary" icon={<Plus size={14} weight="bold" />} onClick={() => setStartOpen(true)}>
                  {t('admin.pocs.start')}
                </Button>
              ) : undefined
            }
          />
        </Panel>
        <StartPocDialog open={startOpen} onOpenChange={setStartOpen} presetOrg={presetOrg} />
      </>
    )
  }

  const owner = profile?.account_owner
  return (
    <div className="space-y-5">
      <SectionCard
        icon={<Handshake size={18} />}
        title={live ? t('admin.org.poc_running') : t('admin.org.poc_last')}
        description={live ? t('admin.org.poc_running_desc') : t('admin.org.poc_last_desc')}
        actions={
          canManage ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <PocActionButtons org={target} onAction={setAction} />
              {!live && profile?.lifecycle !== 'closed' && (
                <Button size="sm" icon={<Plus size={13} />} onClick={() => setStartOpen(true)}>
                  {t('admin.org.start_new_poc')}
                </Button>
              )}
            </div>
          ) : undefined
        }
      >
        {live && (
          <div className="mb-5">
            <PocProgress startedAt={profile?.poc_started_at} endsAt={profile?.poc_ends_at} />
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-10">
          <div className="divide-y divide-neutral-100">
            <KeyValue label={t('admin.org.lifecycle')}>
              <LifecycleChip lifecycle={profile?.lifecycle} />
            </KeyValue>
            <KeyValue label={live ? t('admin.org.time_left') : t('admin.pocs.outcome')}>
              {live ? <PocDaysLeft endsAt={profile?.poc_ends_at} /> : <PocOutcomeChip outcome={profile?.poc_outcome} />}
            </KeyValue>
            <KeyValue label={t('admin.org.poc_plan')}>
              <PlanChip plan={profile?.poc_plan || org.plan} />
            </KeyValue>
            {profile?.poc_outcome !== 'won' && (
              <KeyValue label={t('admin.org.restores_to')}>
                <PlanChip plan={profile?.poc_previous_plan || 'free'} />
              </KeyValue>
            )}
            {profile?.poc_outcome === 'won' && (
              <KeyValue label={t('admin.pocs.outcome')}>
                {profile.poc_ended_at ? t('admin.pocs.converted_on', { date: formatDate(profile.poc_ended_at, i18n.language) }) : t('admin.pocs.converted_label')}
              </KeyValue>
            )}
            <KeyValue label={t('admin.org.poc_started')}>{formatDate(profile?.poc_started_at, i18n.language)}</KeyValue>
            <KeyValue label={t('admin.org.poc_ends')}>{formatDate(profile?.poc_ends_at, i18n.language)}</KeyValue>
            <KeyValue label={t('admin.org.poc_extensions')}>{profile?.poc_extensions ?? 0}</KeyValue>
          </div>
          <div className="divide-y divide-neutral-100 mt-2.5 lg:mt-0">
            <KeyValue label={t('admin.pocs.goal')}>{profile?.poc_goal || '–'}</KeyValue>
            <KeyValue label={t('admin.pocs.contact_name')}>{profile?.poc_contact_name || '–'}</KeyValue>
            <KeyValue label={t('admin.pocs.contact_email')}>
              {profile?.poc_contact_email ? (
                <a href={`mailto:${profile.poc_contact_email}`} className="underline-offset-2 hover:underline" dir="ltr">
                  {profile.poc_contact_email}
                </a>
              ) : (
                '–'
              )}
            </KeyValue>
            <KeyValue label={t('admin.pocs.owner')}>
              {owner ? (
                <Link href={adminPath.user(owner.user_id ?? profile?.account_owner_user_id ?? '')} className="inline-flex items-center gap-1.5 hover:underline underline-offset-2">
                  <Avatar user={owner} size={20} />
                  {owner.username}
                </Link>
              ) : (
                '–'
              )}
            </KeyValue>
            {!live && profile?.poc_outcome !== 'won' && (profile?.poc_ended_at || profile?.closed_at) && <KeyValue label={t('admin.org.closed_at')}>{formatDate(profile?.poc_ended_at || profile?.closed_at, i18n.language)}</KeyValue>}
            {!live && profile?.closed_reason && <KeyValue label={t('admin.pocs.reason')}>{profile.closed_reason}</KeyValue>}
          </div>
        </div>
      </SectionCard>
      <PocActionDialog kind={action} org={action ? target : null} onClose={() => setAction(null)} />
      <StartPocDialog open={startOpen} onOpenChange={setStartOpen} presetOrg={presetOrg} />
    </div>
  )
}
