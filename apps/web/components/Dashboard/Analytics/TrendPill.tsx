'use client'
import React from 'react'
import { ArrowDownRight, ArrowUpRight } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'

/** Change vs the previous period of the same length, as a small pill. */
export default function TrendPill({ change }: { change: number | null }) {
  const { t } = useTranslation()
  if (change === null) return null
  const up = change > 0
  const flat = change === 0
  return (
    <span
      title={t('analytics.overview.vs_previous_period')}
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums ${
        flat ? 'bg-gray-50 text-gray-400' : up ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-500'
      }`}
    >
      {!flat && (up ? <ArrowUpRight size={10} weight="bold" /> : <ArrowDownRight size={10} weight="bold" />)}
      {Math.abs(change)}%
    </span>
  )
}
