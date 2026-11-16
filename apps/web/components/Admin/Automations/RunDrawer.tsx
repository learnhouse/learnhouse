'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { ArrowSquareOut, Buildings, CheckCircle, Tag, X, XCircle } from '@phosphor-icons/react'
import { Skeleton, formatRelative, recipes } from '@/design'
import { getAutomationRun, getTeam } from '@services/ee/platform/api'
import { platformKeys } from '@services/ee/platform/keys'
import type { Automation, AutomationRun } from '@services/ee/platform/types'
import { shouldRetry, useAccessToken } from '@components/Admin/hooks'
import { CopyLinkButton, KeyValue, PlanChip, adminPath, formatDate } from '@components/Admin/Shared/AdminKit'
import { DryRunPill, RunStatusPill } from './shared'
import { AutomationIcon } from './automationVisuals'

// One run, opened from `?section=runs&run=<id>` so it survives a reload and
// can be shared. Reads GET /automations/runs/{id}; on servers without it the
// row already loaded in the run list is shown instead.

export default function RunDrawer({
  runId,
  fallback,
  rule,
  onClose,
}: {
  runId: string | null
  fallback?: AutomationRun | null
  rule?: Automation | null
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const token = useAccessToken()
  const full = useQuery({
    queryKey: ['platform', 'automations', 'run', runId],
    queryFn: () => getAutomationRun(token, runId!),
    enabled: !!token && !!runId,
    retry: false,
    staleTime: 60_000,
  })
  // Runs only carry the actor's id: name them from the (cached) team list.
  const team = useQuery({
    queryKey: platformKeys.team(),
    queryFn: () => getTeam(token),
    enabled: !!token && !!runId && !!fallback?.actor_user_id && !fallback?.actor_label,
    retry: shouldRetry,
    staleTime: 5 * 60_000,
  })
  const run: AutomationRun | null = full.data ? { ...(fallback ?? {}), ...full.data } : fallback ?? null
  const results = Array.isArray(run?.results) ? run!.results : []
  const uuid = run?.automation_uuid ?? rule?.automation_uuid
  // A rule that tags the orgs it touches can link to that filtered org list.
  const tag = (Array.isArray(rule?.actions) ? rule!.actions : []).find((a) => a.type === 'add_tag')?.params?.tag
  const loading = !run && full.isLoading
  const actorName =
    run?.actor_label ||
    (Array.isArray(team.data?.members) ? team.data!.members.find((m) => m.user_id === run?.actor_user_id)?.username : undefined)

  return (
    <DialogPrimitive.Root open={!!runId} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 bg-[var(--adm-overlay)] data-[state=open]:animate-in data-[state=open]:fade-in-0"
          style={{ zIndex: 'var(--z-modal-backdrop)' as any }}
        />
        <DialogPrimitive.Content
          className="fixed inset-y-0 end-0 w-full sm:w-[520px] bg-[var(--adm-canvas)] shadow-2xl flex flex-col data-[state=open]:animate-in data-[state=open]:slide-in-from-right rtl:data-[state=open]:slide-in-from-left focus:outline-none"
          style={{ zIndex: 'var(--z-modal)' as any }}
          aria-describedby={undefined}
        >
          <div className="flex items-start gap-3 px-5 py-4 border-b border-neutral-100">
            <AutomationIcon automation={rule} size="lg" />
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-base font-semibold text-neutral-900 break-words">
                {t('admin.automations.run_title', { id: runId ?? '' })}
              </DialogPrimitive.Title>
              {run && (
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <RunStatusPill status={run.status} />
                  {run.dry_run && <DryRunPill />}
                  <span className="text-xs text-neutral-400">{formatRelative(run.started_at, i18n.language)}</span>
                </div>
              )}
            </div>
            <CopyLinkButton size="sm" href={uuid && runId ? adminPath.automation(uuid, runId) : undefined} />
            <DialogPrimitive.Close
              className="h-7 w-7 shrink-0 inline-flex items-center justify-center rounded-lg text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100"
              aria-label={t('common.close')}
            >
              <X size={16} />
            </DialogPrimitive.Close>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
            {loading ? (
              <div className="space-y-3">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-4 w-64" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : !run ? (
              <p className="text-sm text-neutral-500">{t('admin.automations.run_not_found')}</p>
            ) : (
              <>
                <section className="divide-y divide-neutral-100">
                  {(run.automation_name || rule?.name) && uuid && (
                    <KeyValue label={t('admin.automations.run_rule')}>
                      <Link href={adminPath.automation(uuid)} className="hover:underline underline-offset-2">
                        {run.automation_name || rule?.name}
                      </Link>
                    </KeyValue>
                  )}
                  <KeyValue label={t('admin.automations.run_started')}>{formatDate(run.started_at, i18n.language, true)}</KeyValue>
                  {run.finished_at && <KeyValue label={t('admin.automations.run_finished')}>{formatDate(run.finished_at, i18n.language, true)}</KeyValue>}
                  <KeyValue label={t('admin.automations.filter_trigger')}>
                    {t(`admin.automations.trigger.${run.trigger}`, { defaultValue: run.trigger })}
                  </KeyValue>
                  {run.actor_user_id ? (
                    <KeyValue label={t('admin.automations.run_actor')}>
                      <Link href={adminPath.user(run.actor_user_id)} className="hover:underline underline-offset-2">
                        {actorName || t('admin.automations.user_id', { id: run.actor_user_id })}
                      </Link>
                    </KeyValue>
                  ) : null}
                  <KeyValue label={t('admin.automations.run_counts')}>
                    <span className="tabular-nums">{t('admin.automations.matched_acted', { matched: run.matched ?? 0, acted: run.acted ?? 0 })}</span>
                  </KeyValue>
                </section>

                {run.error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 break-words">{run.error}</p>}

                <section>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <h3 className={recipes.eyebrow}>{t('admin.automations.run_results', { count: results.length })}</h3>
                    {typeof tag === 'string' && tag && (
                      <Link
                        href={`/admin/organizations?tag=${encodeURIComponent(tag)}`}
                        className="inline-flex items-center gap-1 text-xs font-medium text-sky-600 hover:underline underline-offset-2"
                      >
                        <Tag size={12} />
                        {t('admin.automations.orgs_tagged', { tag })}
                      </Link>
                    )}
                  </div>
                  {results.length === 0 ? (
                    <p className="text-sm text-neutral-500">
                      {full.isError && !(fallback?.results) ? t('admin.automations.run_results_unavailable') : t('admin.automations.run_results_empty')}
                    </p>
                  ) : (
                    <div className="divide-y divide-neutral-100">
                      {results.map((r) => (
                        <div key={r.org_id} className="py-3 first:pt-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <Buildings size={14} className="shrink-0 text-neutral-400" />
                            <Link href={adminPath.org(r.org_id)} className="text-sm font-medium text-neutral-900 hover:underline underline-offset-2 truncate">
                              {r.org_name || `#${r.org_id}`}
                            </Link>
                            <PlanChip plan={r.plan} />
                            <Link
                              href={adminPath.org(r.org_id, 'activity')}
                              aria-label={t('admin.automations.org_activity')}
                              title={t('admin.automations.org_activity')}
                              className="ms-auto shrink-0 text-neutral-400 hover:text-neutral-900"
                            >
                              <ArrowSquareOut size={14} />
                            </Link>
                          </div>
                          <ul className="mt-1.5 space-y-1 ps-6">
                            {(Array.isArray(r.actions) ? r.actions : []).map((a, i) => (
                              <li key={i} className="flex items-start gap-1.5 text-xs text-neutral-600">
                                {a.ok ? (
                                  <CheckCircle size={14} weight="fill" className="mt-px shrink-0 text-emerald-600" />
                                ) : (
                                  <XCircle size={14} weight="fill" className="mt-px shrink-0 text-rose-600" />
                                )}
                                <span className="min-w-0 break-words">
                                  <span className="font-medium text-neutral-900">{t(`admin.automations.actions.${a.type}`, { defaultValue: a.type })}</span>
                                  {a.message ? ` · ${a.message}` : ''}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                  {results.length >= 200 && <p className={`${recipes.meta} mt-2`}>{t('admin.automations.results_capped')}</p>}
                </section>
              </>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
