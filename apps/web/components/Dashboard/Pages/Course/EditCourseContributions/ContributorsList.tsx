'use client'
// People credited on the course, with trust (publish without review) and block.
import React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { HandHeart, Prohibit, ShieldCheck } from '@phosphor-icons/react'
import { Button, Chip, EmptyState, Panel, Skeleton, formatRelative, recipes } from '@/design'
import { Switch } from '@components/ui/switch'
import { listCourseContributors, updateContributor, type Contributor } from '@services/courses/contributions'
import { ContributorAvatars, contributorName } from '@components/Objects/Contributions/contributorUi'
import { contributionKeys } from './EditCourseContributions'

export default function ContributorsList({
  courseUuid,
  token,
  canManage,
  trustedPublish,
}: {
  courseUuid: string
  token: string
  canManage: boolean
  trustedPublish: boolean
}) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: contributionKeys.contributors(courseUuid),
    queryFn: () => listCourseContributors(courseUuid, token, true),
    enabled: !!token,
  })
  const items = data?.items ?? []

  const update = async (c: Contributor, patch: { trusted?: boolean; blocked?: boolean }) => {
    try {
      await updateContributor(courseUuid, c.user.id, patch, token)
      queryClient.invalidateQueries({ queryKey: ['contributions'] })
    } catch (e: any) {
      toast.error(e?.message || t('contributions.errors.generic'))
    }
  }

  if (isLoading) return <Skeleton className="h-32 w-full rounded-2xl" />
  if (!items.length) {
    return (
      <Panel>
        <EmptyState
          icon={<HandHeart size={22} />}
          title={t('dashboard.courses.contributions.empty.contributors')}
          description={t('dashboard.courses.contributions.empty.contributors_hint')}
        />
      </Panel>
    )
  }
  return (
    <div className="space-y-3">
      {!trustedPublish && <p className="text-xs text-neutral-500">{t('dashboard.courses.contributions.contributors.trusted_off')}</p>}
      <Panel divided>
        <div className={`${recipes.tableHead} hidden sm:grid sm:grid-cols-[1fr_120px_140px_200px]`}>
          <span>{t('dashboard.courses.contributions.contributors.person')}</span>
          <span>{t('dashboard.courses.contributions.contributors.accepted')}</span>
          <span>{t('dashboard.courses.contributions.contributors.last')}</span>
          <span className="text-end">{t('dashboard.courses.contributions.contributors.trust')}</span>
        </div>
        {items.map((c) => (
          <div key={c.user.user_uuid} className="grid grid-cols-1 items-center gap-2 px-5 py-3.5 hover:bg-neutral-50/70 sm:grid-cols-[1fr_120px_140px_200px]">
            <div className="flex min-w-0 items-center gap-3">
              <ContributorAvatars users={[c.user]} size={32} />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-neutral-900">{contributorName(c.user)}</div>
                <div className="truncate text-xs text-neutral-500">@{c.user.username}</div>
              </div>
              {c.blocked && <Chip tone="rose">{t('dashboard.courses.contributions.contributors.blocked')}</Chip>}
              {c.trusted && <Chip tone="emerald" icon={<ShieldCheck size={12} />}>{t('dashboard.courses.contributions.contributors.trusted')}</Chip>}
            </div>
            <span className="text-sm tabular-nums text-neutral-700">{t('dashboard.courses.contributions.contributors.edits', { count: c.accepted_count })}</span>
            <span className="text-sm text-neutral-500">{formatRelative(c.last_contribution_at, i18n.language) ?? '—'}</span>
            <div className="flex items-center gap-3 sm:justify-end">
              <label className="inline-flex items-center gap-2 text-xs font-medium text-neutral-600">
                <Switch
                  checked={c.trusted}
                  disabled={!canManage || c.blocked}
                  onCheckedChange={(v) => update(c, { trusted: v })}
                  aria-label={t('dashboard.courses.contributions.contributors.trusted')}
                />
                {t('dashboard.courses.contributions.contributors.trusted')}
              </label>
              {canManage && (
                <Button size="sm" icon={<Prohibit size={13} />} onClick={() => update(c, { blocked: !c.blocked })}>
                  {c.blocked ? t('dashboard.courses.contributions.contributors.unblock') : t('dashboard.courses.contributions.contributors.block')}
                </Button>
              )}
            </div>
          </div>
        ))}
      </Panel>
    </div>
  )
}
