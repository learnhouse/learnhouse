'use client'

import { ChartBar } from '@phosphor-icons/react'

type AnalyticsEmptyStateProps = {
  title: string
  description: string
  heightClassName?: string
}

export function AnalyticsEmptyState({
  title,
  description,
  heightClassName = 'h-[220px]',
}: AnalyticsEmptyStateProps) {
  return (
    <div className={`${heightClassName} flex items-center justify-center`}>
      <div className="max-w-xs text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-400">
          <ChartBar size={20} weight="duotone" />
        </div>
        <p className="text-sm font-semibold text-gray-700">{title}</p>
        <p className="mt-1 text-xs leading-5 text-gray-400">{description}</p>
      </div>
    </div>
  )
}
