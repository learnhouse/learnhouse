'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'

/** i18n prefix shared by every dossier section. */
export const P = 'dashboard.users.analytics'

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-xl nice-shadow p-5 ${className}`}>{children}</div>
  )
}

export function SectionTitle({ icon, title, count }: { icon: React.ReactNode; title: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <span className="text-gray-500">{icon}</span>
      <h3 className="font-bold text-lg tracking-tight">{title}</h3>
      {count !== undefined && (
        <span className="text-xs font-semibold text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">{count}</span>
      )}
    </div>
  )
}

export function KpiTile({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string }) {
  return (
    <Card className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-gray-400">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-bold tracking-tight">{value}</div>
      {sub && <div className="text-xs text-gray-400">{sub}</div>}
    </Card>
  )
}

export function ProgressBar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct || 0))
  return (
    <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
      <div
        className="h-full bg-gradient-to-r from-blue-400 to-blue-600 rounded-full transition-all"
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}

export function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation()
  const color: Record<string, string> = {
    STATUS_COMPLETED: 'bg-green-100 text-green-700',
    STATUS_IN_PROGRESS: 'bg-blue-100 text-blue-700',
    STATUS_PAUSED: 'bg-amber-100 text-amber-700',
    STATUS_CANCELLED: 'bg-gray-100 text-gray-600',
    GRADED: 'bg-green-100 text-green-700',
    SUBMITTED: 'bg-blue-100 text-blue-700',
    PENDING: 'bg-amber-100 text-amber-700',
    LATE: 'bg-red-100 text-red-700',
    NOT_SUBMITTED: 'bg-gray-100 text-gray-600',
  }
  const key = status?.replace('STATUS_', '').toLowerCase()
  const label = key ? t(`${P}.status.${key}`, { defaultValue: key.replace('_', ' ') }) : '—'
  return (
    <span className={`text-xs font-semibold rounded-full px-2 py-0.5 capitalize ${color[status] || 'bg-gray-100 text-gray-600'}`}>
      {label}
    </span>
  )
}

export function Empty({ label }: { label: string }) {
  return <div className="text-sm text-gray-400 py-8 text-center">{label}</div>
}
