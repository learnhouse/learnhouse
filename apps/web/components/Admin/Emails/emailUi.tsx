'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Chip, StatusPill, type ChipTone, type Status } from '@/design'
import { listTemplates, opsKeys, type EmailTemplate } from '@services/ee/platform/ops'
import { shouldRetry, useAccessToken } from '@components/Admin/hooks'

// Chips, pills and queries the Emails page, the campaign drawer and the
// "Email admins" dialog share.

const CATEGORY_TONE: Record<string, ChipTone> = { transactional: 'sky', product: 'violet', marketing: 'amber' }

export function CategoryChip({ category }: { category?: string | null }) {
  const { t } = useTranslation()
  if (!category) return null
  return <Chip tone={CATEGORY_TONE[category] ?? 'neutral'}>{t(`admin.emails.category.${category}`, { defaultValue: category })}</Chip>
}

const CAMPAIGN_STATUS: Record<string, Status> = { draft: 'neutral', scheduled: 'info', sending: 'warning', sent: 'success', cancelled: 'danger' }

export function CampaignStatusPill({ status }: { status?: string | null }) {
  const { t } = useTranslation()
  const s = status || 'draft'
  return (
    <StatusPill status={CAMPAIGN_STATUS[s] ?? 'neutral'} dot>
      {t(`admin.emails.status.${s}`, { defaultValue: s })}
    </StatusPill>
  )
}

export function sendStatusTone(s: string): Status {
  if (s === 'sent') return 'success'
  if (s === 'failed') return 'danger'
  if (s === 'queued') return 'info'
  return 'warning'
}

export function SendStatusPill({ status }: { status: string }) {
  const { t } = useTranslation()
  return (
    <StatusPill status={sendStatusTone(status)} dot>
      {t(`admin.emails.send_status.${status}`, { defaultValue: status })}
    </StatusPill>
  )
}

export function useTemplates(enabled = true) {
  const token = useAccessToken()
  const q = useQuery({
    queryKey: opsKeys.templates(),
    queryFn: () => listTemplates(token),
    enabled: !!token && enabled,
    retry: shouldRetry,
    staleTime: 30_000,
  })
  const templates: EmailTemplate[] = Array.isArray(q.data) ? q.data : []
  return { ...q, templates }
}

/**
 * A server-rendered email shown in a fully sandboxed iframe: no scripts, no
 * same-origin access, so the HTML can't touch the console.
 */
export function EmailFrame({ html, title, height = 360 }: { html: string; title: string; height?: number }) {
  return (
    <iframe
      title={title}
      sandbox=""
      srcDoc={html}
      className="w-full rounded-xl ring-1 ring-inset ring-neutral-200 bg-[#fff]"
      style={{ height }}
    />
  )
}
