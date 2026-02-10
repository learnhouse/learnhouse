'use client'
import React, { useState, useMemo } from 'react'
import { ArrowsOutSimple, CaretLeft, CaretRight } from '@phosphor-icons/react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@components/ui/dialog'

interface CourseWidgetCardProps {
  icon: React.ReactNode
  title: string
  subtitle: string
  /** Compact card content */
  children: React.ReactNode
  /** Expanded modal content — if not provided, children are rendered in modal */
  modalContent?: React.ReactNode
  /** Optional extra classes on the card */
  className?: string
  /** If true, card won't be clickable / expandable */
  noExpand?: boolean
}

export default function CourseWidgetCard({
  icon,
  title,
  subtitle,
  children,
  modalContent,
  className = '',
  noExpand = false,
}: CourseWidgetCardProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <div
        onClick={noExpand ? undefined : () => setOpen(true)}
        className={`
          bg-white rounded-xl nice-shadow p-5 min-h-[300px] overflow-hidden min-w-0
          ${noExpand ? '' : 'cursor-pointer group hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200'}
          ${className}
        `}
      >
        {/* Header */}
        <div className="flex items-start gap-3 mb-4">
          {icon}
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
            <p className="text-xs text-gray-400">{subtitle}</p>
          </div>
          {!noExpand && (
            <div className="opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="p-1.5 rounded-lg bg-gray-100 text-gray-400">
                <ArrowsOutSimple size={12} weight="bold" />
              </div>
            </div>
          )}
        </div>

        {/* Compact content */}
        {children}
      </div>

      {/* Expanded modal */}
      {!noExpand && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-hidden flex flex-col p-0">
            <DialogHeader className="px-6 pt-6 pb-3 border-b border-gray-100">
              <DialogTitle className="flex items-center gap-3 text-base">
                {icon}
                {title}
              </DialogTitle>
              <DialogDescription>{subtitle}</DialogDescription>
            </DialogHeader>
            <div className="overflow-y-auto flex-1 px-6 py-6">
              {modalContent ?? children}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

/** Reusable icon badge for widget headers */
export function WidgetIcon({
  icon: Icon,
  bg,
  color,
  weight = 'bold',
}: {
  icon: React.ComponentType<any>
  bg: string
  color: string
  weight?: string
}) {
  return (
    <div className={`p-2 rounded-lg ${bg} shrink-0`}>
      <Icon size={18} weight={weight} className={color} />
    </div>
  )
}

/** Animated counter that counts up from 0 */
export function AnimatedNumber({ value, suffix = '' }: { value: number; suffix?: string }) {
  const [display, setDisplay] = React.useState(0)
  const ref = React.useRef<HTMLSpanElement>(null)

  React.useEffect(() => {
    if (value === 0) { setDisplay(0); return }
    const duration = 600
    const start = performance.now()
    const from = 0

    function tick(now: number) {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      // ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(Math.round(from + (value - from) * eased))
      if (progress < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [value])

  return <span ref={ref}>{display.toLocaleString()}{suffix}</span>
}

/** Mini progress ring (SVG circle) */
export function ProgressRing({
  percent,
  size = 64,
  strokeWidth = 5,
  color = '#6366f1',
  bgColor = '#f3f4f6',
}: {
  percent: number
  size?: number
  strokeWidth?: number
  color?: string
  bgColor?: string
}) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (Math.min(percent, 100) / 100) * circumference

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={bgColor}
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className="transition-all duration-700 ease-out"
      />
    </svg>
  )
}

/** Pagination hook — returns sliced page + controls */
export function usePagination<T>(items: T[], pageSize = 10) {
  const [page, setPage] = useState(0)
  const totalPages = Math.max(Math.ceil(items.length / pageSize), 1)
  const safeP = Math.min(page, totalPages - 1)

  const pageItems = useMemo(
    () => items.slice(safeP * pageSize, (safeP + 1) * pageSize),
    [items, safeP, pageSize]
  )

  return {
    pageItems,
    page: safeP,
    totalPages,
    total: items.length,
    setPage,
    hasPrev: safeP > 0,
    hasNext: safeP < totalPages - 1,
    prev: () => setPage((p) => Math.max(0, p - 1)),
    next: () => setPage((p) => Math.min(totalPages - 1, p + 1)),
    from: safeP * pageSize + 1,
    to: Math.min((safeP + 1) * pageSize, items.length),
  }
}

/** Pagination controls bar */
export function PaginationBar({
  page,
  totalPages,
  total,
  from,
  to,
  hasPrev,
  hasNext,
  prev,
  next,
  setPage,
}: ReturnType<typeof usePagination>) {
  if (totalPages <= 1) return null

  // Build page numbers: show first, last, current ± 1
  const pages: (number | 'dots')[] = []
  for (let i = 0; i < totalPages; i++) {
    if (i === 0 || i === totalPages - 1 || Math.abs(i - page) <= 1) {
      pages.push(i)
    } else if (pages[pages.length - 1] !== 'dots') {
      pages.push('dots')
    }
  }

  return (
    <div className="flex items-center justify-between pt-4 border-t border-gray-100">
      <span className="text-xs text-gray-400">
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={prev}
          disabled={!hasPrev}
          className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <CaretLeft size={14} weight="bold" className="text-gray-500" />
        </button>
        {pages.map((p, i) =>
          p === 'dots' ? (
            <span key={`dots-${i}`} className="px-1 text-xs text-gray-300">…</span>
          ) : (
            <button
              key={p}
              onClick={() => setPage(p)}
              className={`min-w-[28px] h-7 rounded-lg text-xs font-medium transition-colors ${
                p === page
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              {p + 1}
            </button>
          )
        )}
        <button
          onClick={next}
          disabled={!hasNext}
          className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <CaretRight size={14} weight="bold" className="text-gray-500" />
        </button>
      </div>
    </div>
  )
}

/** Tiny inline sparkline */
export function Sparkline({
  data,
  width = 80,
  height = 24,
  color = '#6366f1',
}: {
  data: number[]
  width?: number
  height?: number
  color?: string
}) {
  if (data.length < 2) return null
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width
      const y = height - ((v - min) / range) * (height - 2) - 1
      return `${x},${y}`
    })
    .join(' ')

  return (
    <svg width={width} height={height} className="inline-block">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
