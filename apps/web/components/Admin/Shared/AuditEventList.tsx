'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { Code, FlowArrow, Gear, Key, Robot, User } from '@phosphor-icons/react'
import { Panel, formatRelative } from '@/design'
import type { AuditEvent } from '@services/ee/platform/types'
import { adminPath, formatDate } from './AdminKit'

// One audit trail list, shared by the Activity page, the org Activity tab and
// the Overview "recent activity" card.

const KIND_ICON: Record<string, React.ReactNode> = {
  session: <User size={14} weight="duotone" />,
  token: <Key size={14} weight="duotone" />,
  mcp: <Robot size={14} weight="duotone" />,
  automation: <FlowArrow size={14} weight="duotone" />,
  system: <Gear size={14} weight="duotone" />,
}

export function AuditEventRow({ event, showOrg = true, expandable = true }: { event: AuditEvent; showOrg?: boolean; expandable?: boolean }) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const hasDetails = expandable && !!event.details && Object.keys(event.details).length > 0
  return (
    <div className="px-5 py-3">
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 h-7 w-7 shrink-0 rounded-lg bg-neutral-100 text-neutral-500 flex items-center justify-center"
          title={t(`admin.activity.kind.${event.actor_kind}`, { defaultValue: event.actor_kind })}
        >
          {KIND_ICON[event.actor_kind] ?? <Code size={14} />}
        </span>
        <div className="min-w-0 flex-1">
          {/* Permalink: opens the event in the activity drawer. */}
          <Link href={adminPath.event(`platform:${event.id}`)} className="text-sm text-neutral-900 break-words hover:underline underline-offset-2">
            {(event as { title?: string | null }).title || event.summary || event.action}
          </Link>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-neutral-400">
            {event.actor_user_id ? (
              <Link href={adminPath.user(event.actor_user_id)} className="font-medium text-neutral-500 hover:text-neutral-800">
                {event.actor_label || t(`admin.activity.kind.${event.actor_kind}`, { defaultValue: event.actor_kind })}
              </Link>
            ) : (
              <span className="font-medium text-neutral-500">{event.actor_label || t(`admin.activity.kind.${event.actor_kind}`, { defaultValue: event.actor_kind })}</span>
            )}
            <span aria-hidden="true">·</span>
            <code className="font-mono text-[11px] text-neutral-500" dir="ltr">
              {event.action}
            </code>
            {showOrg && event.org_id ? (
              <>
                <span aria-hidden="true">·</span>
                <Link href={`/admin/organizations/${event.org_id}`} className="hover:text-neutral-700 underline-offset-2 hover:underline">
                  {event.org_name || `#${event.org_id}`}
                </Link>
              </>
            ) : null}
            <span aria-hidden="true">·</span>
            <time dateTime={event.created_at} title={formatDate(event.created_at, i18n.language, true)}>
              {formatRelative(event.created_at, i18n.language) ?? '–'}
            </time>
          </div>
        </div>
        {hasDetails && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="shrink-0 text-xs font-medium text-neutral-400 hover:text-neutral-700"
          >
            {open ? t('admin.activity.hide_details') : t('admin.activity.details')}
          </button>
        )}
      </div>
      {open && hasDetails && (
        <pre dir="ltr" className="mt-2 ms-10 max-h-64 overflow-auto rounded-lg bg-neutral-50 p-3 text-[11px] leading-relaxed text-neutral-700 ring-1 ring-inset ring-neutral-200/70">
          {JSON.stringify(event.details, null, 2)}
        </pre>
      )}
    </div>
  )
}

export function AuditEventList({ events, showOrg = true, bare }: { events: AuditEvent[]; showOrg?: boolean; bare?: boolean }) {
  const rows = (Array.isArray(events) ? events : []).map((e) => <AuditEventRow key={e.id} event={e} showOrg={showOrg} />)
  if (bare) return <div className="divide-y divide-neutral-100">{rows}</div>
  return <Panel divided>{rows}</Panel>
}
