'use client'
import React from 'react'

/** Horizontal usage meter — ports the platform plan page's UsageBar. */
export default function UsageBar({
  label,
  icon,
  usage,
  limit,
  color,
}: {
  label: string
  icon: React.ReactNode
  usage: number
  limit: number | string
  color: string
}) {
  const isUnlimited = limit === 'unlimited' || limit === 0
  const numericLimit = typeof limit === 'number' ? limit : 0
  const pct = isUnlimited ? 0 : Math.min(100, Math.round((usage / numericLimit) * 100))
  const isHigh = pct >= 80
  const isFull = pct >= 100

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`p-1.5 rounded-lg ${color}`}>{icon}</div>
          <span className="text-[13px] font-semibold text-black">{label}</span>
        </div>
        <span className="text-[13px] font-medium text-black/50 whitespace-nowrap">
          {usage.toLocaleString()}
          {isUnlimited ? (
            <span className="text-black/25"> / unlimited</span>
          ) : (
            <span className="text-black/25"> / {numericLimit.toLocaleString()}</span>
          )}
        </span>
      </div>
      <div className="h-2 rounded-full bg-black/[0.04] overflow-hidden">
        {!isUnlimited ? (
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              isFull ? 'bg-red-500' : isHigh ? 'bg-amber-500' : 'bg-black'
            }`}
            style={{ width: `${Math.max(pct, 2)}%` }}
          />
        ) : (
          <div className="h-full rounded-full bg-black/[0.06]" style={{ width: '100%' }} />
        )}
      </div>
      {!isUnlimited && (
        <p
          className={`text-[11px] font-medium ${
            isFull ? 'text-red-500' : isHigh ? 'text-amber-600' : 'text-black/30'
          }`}
        >
          {isFull
            ? 'Limit reached — upgrade to continue'
            : isHigh
              ? `${numericLimit - usage} remaining — nearing limit`
              : `${numericLimit - usage} remaining`}
        </p>
      )}
    </div>
  )
}
