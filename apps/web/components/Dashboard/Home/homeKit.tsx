'use client'
import React from 'react'
import Link from 'next/link'
import { ArrowRight } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { Chip, ChipTone } from '@components/Dashboard/Shared/DashKit/DashKit'

const PLAN_TONES: Record<string, ChipTone> = {
  free: 'neutral',
  oss: 'emerald',
  standard: 'sky',
  pro: 'violet',
  enterprise: 'amber',
}

export function PlanChip({ plan, withSuffix = false }: { plan: string; withSuffix?: boolean }) {
  const { t } = useTranslation()
  const label = plan === 'oss' ? 'OSS' : withSuffix ? `${plan} ${t('dashboard.home.plan')}` : plan
  return (
    <Chip tone={PLAN_TONES[plan] || 'neutral'} className="capitalize">
      {label}
    </Chip>
  )
}

// Quiet "View all →" link for a card's header.
export function CardLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="group inline-flex items-center gap-1 h-8 px-2.5 -me-2.5 rounded-lg text-xs font-semibold text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 transition-colors whitespace-nowrap"
    >
      {children}
      <ArrowRight size={12} weight="bold" className="rtl:rotate-180" />
    </Link>
  )
}

// Placeholder rows for list cards while they load.
export function ListSkeleton({ rows = 4, media = 'thumb' }: { rows?: number; media?: 'thumb' | 'avatar' }) {
  return (
    <ul className="divide-y divide-neutral-100" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 px-5 py-3 animate-pulse">
          {media === 'thumb' ? (
            <div className="w-16 sm:w-20 aspect-video rounded-lg bg-neutral-100 shrink-0" />
          ) : (
            <div className="w-9 h-9 rounded-full bg-neutral-100 shrink-0" />
          )}
          <div className="flex-1 min-w-0 space-y-2">
            <div className="h-3 w-2/5 rounded bg-neutral-100" />
            <div className="h-2.5 w-1/4 rounded bg-neutral-100" />
          </div>
          <div className="hidden sm:block h-6 w-16 rounded-full bg-neutral-100" />
        </li>
      ))}
    </ul>
  )
}
