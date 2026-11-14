'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Eye, MagnifyingGlass } from '@phosphor-icons/react'
import { Button, EmptyState, Panel, SectionCard, recipes } from '@/design'
import { getTeam, previewAutomation } from '@services/ee/platform/api'
import { platformKeys } from '@services/ee/platform/keys'
import { shouldRetry, useAccessToken } from '@components/Admin/hooks'
import { PlanChip, QueryError, Switch } from '@components/Admin/Shared/AdminKit'
import OrgTargetPicker, { type OrgTarget } from './OrgTargetPicker'

// "Who would this touch?" — always a dry evaluation, nothing is changed or
// stored as a run.
export default function PreviewPanel({
  uuid,
  canRun,
  dirty,
  eventNote,
  events,
  eventLabel,
  onPreviewed,
}: {
  uuid: string
  canRun: boolean
  dirty: boolean
  /** Event rules: explains that the preview checks every org, the real rule only the event's org. */
  eventNote?: string
  /** Event rules: their events, for the optional "simulate this event" select. */
  events?: string[]
  eventLabel?: (_key: string) => string
  onPreviewed?: () => void
}) {
  const { t } = useTranslation()
  const token = useAccessToken()
  // Optional: preview a single organization (and, for event rules, one event).
  const [oneOrg, setOneOrg] = React.useState(false)
  const [target, setTarget] = React.useState<OrgTarget>({})
  const preview = useMutation({
    mutationFn: () =>
      previewAutomation(token, uuid, oneOrg && target.org ? { org_id: target.org.id, event_key: target.eventKey } : undefined),
    onSuccess: () => onPreviewed?.(),
  })
  const note = preview.data?.note || (preview.data && oneOrg && target.org ? null : eventNote)
  const matched = Array.isArray(preview.data?.matched) ? preview.data!.matched : []
  // "would follow as user 1" → "would follow as maya" when the id is a team member.
  const team = useQuery({
    queryKey: platformKeys.team(),
    queryFn: () => getTeam(token),
    enabled: !!token && matched.some((m) => (Array.isArray(m.would) ? m.would : []).some((w) => /\buser \d+\b/.test(w))),
    retry: shouldRetry,
    staleTime: 5 * 60_000,
  })
  const names = new Map((Array.isArray(team.data?.members) ? team.data!.members : []).map((m) => [String(m.user_id), m.username]))
  const readable = (w: string) => w.replace(/\buser (\d+)\b/g, (all, id) => names.get(id) ?? all)

  return (
    <div className="space-y-4">
      <SectionCard
        icon={<Eye size={18} />}
        title={t('admin.automations.preview_title')}
        description={t('admin.automations.preview_desc')}
        actions={
          canRun ? (
            <Button
              variant="primary"
              icon={<MagnifyingGlass size={14} />}
              loading={preview.isPending}
              disabled={oneOrg && !target.org}
              onClick={() => preview.mutate()}
            >
              {preview.data ? t('admin.automations.preview_again') : t('admin.automations.preview_run')}
            </Button>
          ) : undefined
        }
        bodyClassName="px-5 pb-5 pt-3 space-y-3"
      >
        {note && <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-700">{note}</p>}
        {dirty && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{t('admin.automations.preview_unsaved')}</p>}
        {canRun && (
          <div className="space-y-3">
            <label className="inline-flex items-center gap-2 text-sm text-neutral-700">
              <Switch checked={oneOrg} onChange={setOneOrg} label={t('admin.automations.preview_one_org')} />
              {t('admin.automations.preview_one_org')}
            </label>
            {oneOrg && (
              <div className="max-w-md">
                <OrgTargetPicker value={target} onChange={setTarget} events={events} eventLabel={eventLabel} />
              </div>
            )}
          </div>
        )}
      </SectionCard>

      {preview.error ? (
        <QueryError error={preview.error} onRetry={() => preview.mutate()} />
      ) : !preview.data ? (
        <Panel>
          <EmptyState
            icon={<Eye size={22} />}
            title={t('admin.automations.preview_empty_title')}
            description={canRun ? t('admin.automations.preview_empty_desc') : t('admin.automations.preview_no_permission')}
          />
        </Panel>
      ) : matched.length === 0 ? (
        <Panel>
          <EmptyState icon={<MagnifyingGlass size={22} />} title={t('admin.automations.preview_none_title')} description={t('admin.automations.preview_none_desc')} />
        </Panel>
      ) : (
        <Panel divided>
          <div className={`${recipes.tableHead} flex items-center justify-between`}>
            <span>{t('admin.automations.preview_count', { count: preview.data.total ?? matched.length })}</span>
            {(preview.data.total ?? 0) > matched.length && <span>{t('admin.automations.preview_showing', { count: matched.length })}</span>}
          </div>
          {matched.map((m) => (
            <div key={m.org_id} className="flex flex-col gap-1.5 px-5 py-3 sm:flex-row sm:items-start sm:gap-4">
              <div className="flex items-center gap-2 min-w-0 sm:w-64 shrink-0">
                <Link href={`/admin/organizations/${m.org_id}`} className="text-sm font-semibold text-neutral-900 hover:underline underline-offset-2 truncate">
                  {m.org_name || `#${m.org_id}`}
                </Link>
                <PlanChip plan={m.plan} />
              </div>
              <ul className="flex-1 min-w-0 space-y-0.5">
                {(Array.isArray(m.would) ? m.would : []).map((w, i) => (
                  <li key={i} className="text-xs text-neutral-600 break-words">
                    {readable(w)}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Panel>
      )}
    </div>
  )
}
