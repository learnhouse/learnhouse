'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Bell, DiscordLogo, EnvelopeSimple, NotionLogo, SlackLogo, WebhooksLogo } from '@phosphor-icons/react'
import type { Icon as PhosphorIcon } from '@phosphor-icons/react'
import { StatusPill, type Status } from '@/design'
import { IconTile, type Tone } from '@components/Admin/Shared/OpsKit'

// One face per channel kind (list cards, pickers, the delivery log) and one
// color per delivery status, so every notifications tab reads the same.

export const KIND_META: Record<string, { icon: PhosphorIcon; tone: Tone }> = {
  discord: { icon: DiscordLogo, tone: 'indigo' },
  slack: { icon: SlackLogo, tone: 'pink' },
  notion: { icon: NotionLogo, tone: 'neutral' },
  webhook: { icon: WebhooksLogo, tone: 'orange' },
  email: { icon: EnvelopeSimple, tone: 'sky' },
  inbox: { icon: Bell, tone: 'rose' },
}

export function KindIcon({ kind, size = 'md' }: { kind?: string | null; size?: 'sm' | 'md' | 'lg' }) {
  const meta = KIND_META[kind ?? ''] ?? KIND_META.inbox
  const Icon = meta.icon
  return <IconTile icon={<Icon size={size === 'sm' ? 14 : size === 'lg' ? 22 : 18} weight="fill" />} tone={meta.tone} size={size} />
}

const STATUS: Record<string, Status> = {
  sent: 'success',
  failed: 'danger',
  queued: 'info',
  batched: 'info',
  skipped: 'neutral',
  digest: 'ai',
}

export function DeliveryStatusPill({ status }: { status: string }) {
  const { t } = useTranslation()
  return (
    <StatusPill status={STATUS[status] ?? 'neutral'} dot>
      {t(`admin.notifications.status.${status}`, { defaultValue: status })}
    </StatusPill>
  )
}

/** The masked config as a short, readable line ("https://…/•••• abcd"). */
export function maskedSummary(kind: string, config: Record<string, unknown> | null | undefined, t: (_k: string, _o?: Record<string, unknown>) => string): string {
  const c = config ?? {}
  if (kind === 'notion') return [c.database_id ? String(c.database_id) : '', c.token ? String(c.token) : ''].filter(Boolean).join(' · ')
  if (kind === 'email') {
    const roles = Array.isArray(c.roles) ? (c.roles as string[]) : []
    const ids = Array.isArray(c.user_ids) ? (c.user_ids as number[]) : []
    const parts: string[] = []
    if (roles.length) parts.push(roles.map((r) => t(`admin.roles.${r}`, { defaultValue: r })).join(', '))
    if (ids.length) parts.push(t('admin.notifications.channels.people_count', { count: ids.length }))
    return parts.join(' · ') || t('admin.notifications.channels.no_recipients')
  }
  return c.url ? String(c.url) : ''
}
