'use client'
import React from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Copy, Check, Code, WarningCircle, X } from '@phosphor-icons/react'
import { Button, Chip, EmptyState, Eyebrow, Skeleton, StatusPill, recipes } from '@/design'
import { queryKeys } from '@/lib/query/keys'
import { intlLocale } from '@/lib/format'
import { getAuditLogEntry } from '@services/ee/audit_logs'
import { actorName, formatValue, humanizeField, outcomeStatus, type AuditEntry } from './auditFormat'
import { ActorAvatar, AuditSentence, targetTypeLabel, useAuditText } from './auditUi'

type Props = {
  orgId?: number
  token?: string
  entryId: number | null
  onClose: () => void
  onOpen: (_id: number) => void
}

function parseDate(value: string): Date {
  return new Date(value.endsWith('Z') || value.includes('+') ? value : `${value}Z`)
}

function Row({ label, children, mono = false }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-3 py-2 text-sm">
      <dt className="text-neutral-500">{label}</dt>
      <dd className={`text-neutral-800 min-w-0 break-words ${mono ? 'font-mono text-xs leading-5' : ''}`} dir={mono ? 'ltr' : undefined}>
        {children}
      </dd>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <Eyebrow as="h3">{title}</Eyebrow>
      {children}
    </section>
  )
}

function CopyButton({ value }: { value: string }) {
  const text = useAuditText()
  const [copied, setCopied] = React.useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(value).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
      className={`inline-flex items-center gap-1 ms-2 text-[11px] font-semibold text-neutral-400 hover:text-neutral-700 ${recipes.focusRing} rounded`}
      aria-label={text('actions.copy')}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? text('actions.copied') : text('actions.copy')}
    </button>
  )
}

function Changes({ entry }: { entry: AuditEntry }) {
  const text = useAuditText()
  const changes = entry.changes || {}
  const fields = Object.keys(changes)
  if (fields.length === 0) return <p className="text-sm text-neutral-400">{text('drawer.no_changes')}</p>
  const empty = text('drawer.empty_value')
  return (
    <div className="rounded-xl ring-1 ring-neutral-200/70 overflow-hidden divide-y divide-neutral-100">
      <div className="hidden sm:grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_minmax(0,1fr)] gap-3 px-3 py-2 bg-neutral-50 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
        <span>{text('drawer.field')}</span>
        <span>{text('drawer.before')}</span>
        <span>{text('drawer.after')}</span>
      </div>
      {fields.map((field) => {
        const change = changes[field]
        return (
          <div key={field} className="grid grid-cols-1 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_minmax(0,1fr)] gap-1 sm:gap-3 px-3 py-2.5 text-sm">
            <span className="font-medium text-neutral-700 break-words">{humanizeField(field)}</span>
            <span className="flex items-start gap-1.5 min-w-0">
              <span className="sm:hidden text-[11px] text-neutral-400 pt-0.5 shrink-0">{text('drawer.before')}</span>
              <span className="rounded-md bg-rose-50 text-rose-800 px-1.5 py-0.5 break-words min-w-0 line-through decoration-rose-300">
                {formatValue(change?.from, empty)}
              </span>
            </span>
            <span className="flex items-start gap-1.5 min-w-0">
              <span className="sm:hidden text-[11px] text-neutral-400 pt-0.5 shrink-0">{text('drawer.after')}</span>
              <span className="rounded-md bg-emerald-50 text-emerald-800 px-1.5 py-0.5 break-words min-w-0">
                {formatValue(change?.to, empty)}
              </span>
            </span>
          </div>
        )
      })}
    </div>
  )
}

export default function AuditLogDrawer({ orgId, token, entryId, onClose, onOpen }: Props) {
  const { t, i18n } = useTranslation()
  const text = useAuditText()
  const [rawFor, setRawFor] = React.useState<number | null>(null)
  const panelRef = React.useRef<HTMLDivElement>(null)
  const open = entryId !== null

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: [...queryKeys.org.auditLogs(orgId ?? 0), 'entry', entryId],
    queryFn: () => getAuditLogEntry(orgId as number, token as string, entryId as number),
    enabled: open && !!orgId && !!token,
    staleTime: 60_000,
  })

  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const previous = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
  }, [open, entryId, onClose])

  if (!open || typeof document === 'undefined') return null

  const entry = data?.entry
  const showRaw = rawFor !== null && rawFor === entryId
  const locale = intlLocale(i18n.language)
  const fullFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'medium' })
  const shortFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' })
  const names = { system: text('actor.system'), unknown: text('actor.unknown'), scim: text('actor.scim'), support: text('actor.support') }
  const details = Object.entries((entry?.details || {}) as Record<string, unknown>).filter(
    ([k]) => !['learner_name'].includes(k)
  )
  const device = entry?.client
    ? [entry.client.browser, entry.client.os, entry.client.device ? text(`device.${entry.client.device}`, entry.client.device) : null]
        .filter(Boolean)
        .join(' · ')
    : null

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="audit-drawer-title">
      <button type="button" aria-label={text('actions.close')} className="absolute inset-0 bg-neutral-900/30 backdrop-blur-[1px] cursor-default" onClick={onClose} />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative h-full w-full sm:max-w-xl bg-white shadow-2xl flex flex-col outline-none animate-in fade-in duration-150"
      >
        <header className="flex items-start gap-3 px-4 sm:px-6 pt-5 pb-4 border-b border-neutral-100">
          <div className="flex-1 min-w-0">
            <p id="audit-drawer-title" className="text-xs font-semibold text-neutral-400">{text('drawer.title')}</p>
            {entry ? (
              <>
                <p className="mt-1 text-base text-neutral-700 leading-snug break-words">
                  <AuditSentence entry={entry} />
                </p>
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <StatusPill status={outcomeStatus(entry.outcome)} dot>{text(`outcome.${entry.outcome || 'success'}`)}</StatusPill>
                  <Chip tone={entry.via === 'atlas' || entry.via === 'mcp' ? 'violet' : entry.via === 'api_token' ? 'sky' : 'neutral'}>
                    {text(`via.${entry.via || 'ui'}`)}
                  </Chip>
                  <Chip>{text(`category.${entry.category || 'other'}`)}</Chip>
                  <span className="text-xs text-neutral-400 tabular-nums">{shortFmt.format(parseDate(entry.created_at))}</span>
                </div>
              </>
            ) : (
              <Skeleton className="mt-2 h-5 w-64" />
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label={text('actions.close')}>
            <X size={16} />
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto overscroll-contain px-4 sm:px-6 py-5 flex flex-col gap-6">
          {isLoading ? (
            <div className="flex flex-col gap-3" aria-busy="true" aria-label={text('drawer.loading')}>
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : isError || !entry ? (
            <EmptyState
              icon={<WarningCircle size={22} />}
              title={text('error.title')}
              description={text('error.description')}
              action={<Button variant="secondary" size="sm" onClick={() => refetch()}>{text('actions.retry')}</Button>}
            />
          ) : (
            <>
              {entry.reason && (
                <div className="rounded-xl bg-amber-50 text-amber-900 text-sm px-3 py-2">
                  <span className="font-semibold">{text('drawer.reason')}:</span> {entry.reason.replace(/_/g, ' ')}
                </div>
              )}

              <Section title={text('drawer.changes')}>
                <Changes entry={entry} />
              </Section>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <Section title={text('drawer.actor')}>
                  <div className="flex items-center gap-2.5 min-w-0">
                    <ActorAvatar entry={entry} name={actorName(entry, names)} size={36} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-neutral-900 truncate">{actorName(entry, names)}</p>
                      {entry.actor_email && <p className="text-xs text-neutral-500 truncate" dir="ltr">{entry.actor_email}</p>}
                    </div>
                  </div>
                  <dl className="divide-y divide-neutral-100">
                    {entry.actor_role && <Row label={text('drawer.role')}>{entry.actor_role}</Row>}
                    {entry.user_id != null && <Row label={text('drawer.id')} mono>{entry.user_id}</Row>}
                    {typeof entry.details?.api_token === 'string' && (
                      <Row label={text('via.api_token')}>{entry.details.api_token as string}</Row>
                    )}
                  </dl>
                </Section>

                <Section title={text('drawer.target')}>
                  <dl className="divide-y divide-neutral-100">
                    <Row label={text('drawer.type')}>
                      {entry.target_type || entry.resource
                        ? targetTypeLabel(t, String(entry.target_type || entry.resource))
                        : text('drawer.unknown')}
                    </Row>
                    {entry.target_name && <Row label={text('drawer.name')}>{entry.target_name}</Row>}
                    {(entry.target_id || entry.resource_id) && (
                      <Row label={text('drawer.id')} mono>{entry.target_id || entry.resource_id}</Row>
                    )}
                  </dl>
                </Section>
              </div>

              <Section title={text('drawer.context')}>
                <dl className="divide-y divide-neutral-100">
                  <Row label={text('drawer.time')}>{fullFmt.format(parseDate(entry.created_at))}</Row>
                  <Row label={text('drawer.ip')} mono>{entry.ip_address || '—'}</Row>
                  <Row label={text('drawer.device')}>
                    {device || '—'}
                    {entry.user_agent && <span className="block text-[11px] text-neutral-400 font-mono mt-0.5 break-all" dir="ltr">{entry.user_agent}</span>}
                  </Row>
                  {entry.request_id && (
                    <Row label={text('drawer.request_id')} mono>
                      {entry.request_id}
                      <CopyButton value={entry.request_id} />
                    </Row>
                  )}
                  {entry.method && (
                    <Row label={text('drawer.http')} mono>
                      {entry.method} {entry.path} {entry.status_code ? `→ ${entry.status_code}` : ''}
                    </Row>
                  )}
                </dl>
              </Section>

              {details.length > 0 && (
                <Section title={text('drawer.details')}>
                  <dl className="divide-y divide-neutral-100">
                    {details.map(([key, value]) => (
                      <Row key={key} label={humanizeField(key)} mono={typeof value === 'object'}>
                        {formatValue(value, text('drawer.empty_value'))}
                      </Row>
                    ))}
                  </dl>
                </Section>
              )}

              <Section title={text('drawer.related')}>
                {data.related.length === 0 ? (
                  <p className="text-sm text-neutral-400">{text('drawer.related_empty')}</p>
                ) : (
                  <ul className="rounded-xl ring-1 ring-neutral-200/70 divide-y divide-neutral-100 overflow-hidden">
                    {data.related.map((rel) => (
                      <li key={rel.id}>
                        <button
                          type="button"
                          onClick={() => onOpen(rel.id)}
                          className={`w-full text-start flex items-center gap-3 px-3 py-2.5 hover:bg-neutral-50 ${recipes.focusRing} focus-visible:ring-inset focus-visible:ring-offset-0`}
                        >
                          <span className="flex-1 min-w-0">
                            <span className="block text-sm text-neutral-600 break-words"><AuditSentence entry={rel} /></span>
                            <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-400">
                              <span className="tabular-nums">{shortFmt.format(parseDate(rel.created_at))}</span>
                              <span>·</span>
                              <span>
                                {rel.request_id && rel.request_id === entry.request_id ? text('drawer.same_request') : text('drawer.same_target')}
                              </span>
                            </span>
                          </span>
                          <ArrowRight size={14} className="text-neutral-300 shrink-0 rtl:rotate-180" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <div>
                <Button variant="ghost" size="sm" icon={<Code size={14} />} onClick={() => setRawFor(showRaw ? null : entryId)}>
                  {showRaw ? text('actions.hide_raw') : text('actions.view_raw')}
                </Button>
                {showRaw && (
                  <pre className="mt-2 bg-neutral-900 text-emerald-300 rounded-xl p-4 text-xs font-mono overflow-auto max-h-80" dir="ltr">
                    {JSON.stringify(entry, null, 2)}
                  </pre>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
