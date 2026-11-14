'use client'
import React, { useRef, useState, useCallback, useEffect } from 'react'
import Link, { type LinkProps } from 'next/link'
import { CaretLeft, CaretRight } from '@phosphor-icons/react'
import { PlanLevel } from '@services/plans/plans'
import PlanBadge from '@components/Dashboard/Shared/PlanRestricted/PlanBadge'
import { usePlan } from '@components/Hooks/usePlan'
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'
import { useTranslation } from 'react-i18next'
import { TabIcon } from '../tabIcon'

export interface DashTabItem {
  key: string
  label: string
  icon: React.ReactNode
  href?: string
  onClick?: () => void
  active: boolean
  disabled?: boolean
  disabledTooltip?: React.ReactNode
  requiresPlan?: PlanLevel
  // Shows a small amber dot: the tab holds unsaved edits.
  dirty?: boolean
}

interface DashTabBarProps {
  tabs: DashTabItem[]
  className?: string
  // Passed to the tab links. Full prefetch by default: every tab body is a
  // client page that loads its own data, so its payload is tiny, and with it
  // a tab switch needs no server round trip (and shows no loading flash).
  prefetch?: LinkProps['prefetch']
}

// Underline tabs, as in the assignment editor. The row scrolls sideways when
// it overflows (phones, long tab lists); the edges fade out instead of using a
// gradient overlay, so the bar works on any header background.
export function DashTabBar({ tabs, className = '', prefetch = true }: DashTabBarProps) {
  const { t } = useTranslation()
  const currentPlan = usePlan()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollStart, setCanScrollStart] = useState(false)
  const [canScrollEnd, setCanScrollEnd] = useState(false)
  const [isRtl, setIsRtl] = useState(false)

  // scrollLeft runs negative in RTL, so compare magnitudes.
  const updateScrollState = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const offset = Math.abs(el.scrollLeft)
    setCanScrollStart(offset > 4)
    setCanScrollEnd(offset + el.clientWidth < el.scrollWidth - 4)
    setIsRtl(getComputedStyle(el).direction === 'rtl')
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    updateScrollState()
    el.addEventListener('scroll', updateScrollState, { passive: true })
    const ro = new ResizeObserver(updateScrollState)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', updateScrollState)
      ro.disconnect()
    }
  }, [updateScrollState])

  // Next.js reuses the component across subpage navigations, so bring the
  // newly active tab back into view whenever it changes.
  const activeKey = tabs.find((tab) => tab.active)?.key
  // Measured with client rects so it works the same in LTR and RTL.
  useEffect(() => {
    const container = scrollRef.current
    const activeEl = container?.querySelector('[data-tab-active]') as HTMLElement | null
    if (!container || !activeEl) return
    const c = container.getBoundingClientRect()
    const a = activeEl.getBoundingClientRect()
    if (a.left < c.left) container.scrollBy({ left: a.left - c.left - 8 })
    else if (a.right > c.right) container.scrollBy({ left: a.right - c.right + 8 })
  }, [activeKey])

  const scroll = useCallback(
    (towards: 'start' | 'end') => {
      const el = scrollRef.current
      if (!el) return
      const step = towards === 'end' ? 160 : -160
      el.scrollBy({ left: isRtl ? -step : step, behavior: 'smooth' })
    },
    [isRtl]
  )

  const fadeDir = isRtl ? 'to left' : 'to right'
  const maskImage =
    canScrollStart || canScrollEnd
      ? `linear-gradient(${fadeDir}, ${canScrollStart ? 'transparent' : '#000'} 0, #000 40px, #000 calc(100% - 40px), ${canScrollEnd ? 'transparent' : '#000'} 100%)`
      : undefined

  const edgeButton =
    'pointer-events-auto flex items-center justify-center w-6 h-6 rounded-full bg-white nice-shadow text-neutral-500 hover:text-neutral-900 transition-colors'

  return (
    <div className={`relative min-w-0 ${className}`}>
      <div
        ref={scrollRef}
        role="tablist"
        className="flex gap-1 sm:gap-5 overflow-x-auto scrollbar-hide"
        style={maskImage ? { maskImage, WebkitMaskImage: maskImage } : undefined}
      >
        {tabs.map((tab) => {
          const inner = (
            <>
              <span className="shrink-0 [&>svg]:size-4"><TabIcon icon={tab.icon} /></span>
              <span className="flex items-center whitespace-nowrap">
                {tab.label}
                {tab.requiresPlan && <PlanBadge currentPlan={currentPlan} requiredPlan={tab.requiresPlan} />}
              </span>
              {tab.dirty && (
                <span
                  className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"
                  aria-label={t('dashboard.courses.save.unsaved')}
                  title={t('dashboard.courses.save.unsaved')}
                />
              )}
            </>
          )
          const base =
            'flex items-center gap-2 px-2 sm:px-0.5 py-3 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap'

          if (tab.disabled) {
            const el = (
              <div
                className={`${base} border-transparent text-neutral-400 opacity-60 cursor-not-allowed`}
                aria-disabled="true"
              >
                {inner}
              </div>
            )
            return tab.disabledTooltip ? (
              <ToolTip key={tab.key} content={tab.disabledTooltip}>
                {el}
              </ToolTip>
            ) : (
              <div key={tab.key}>{el}</div>
            )
          }

          const tabClass = `${base} ${
            tab.active
              ? 'border-neutral-900 text-neutral-900'
              : 'border-transparent text-neutral-500 hover:text-neutral-800'
          }`
          const activeProps = tab.active ? { 'data-tab-active': '' } : {}

          if (tab.href) {
            return (
              <Link
                key={tab.key}
                href={tab.href}
                prefetch={prefetch}
                role="tab"
                aria-selected={tab.active}
                className={tabClass}
                {...activeProps}
              >
                {inner}
              </Link>
            )
          }

          if (tab.onClick) {
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={tab.active}
                onClick={tab.onClick}
                className={tabClass}
                {...activeProps}
              >
                {inner}
              </button>
            )
          }

          return null
        })}
      </div>

      <div
        className={`absolute start-0 inset-y-0 flex items-center pointer-events-none transition-opacity duration-200 ${
          canScrollStart ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <button
          type="button"
          onClick={() => scroll('start')}
          aria-label={t('dashboard.tab_bar.scroll_left')}
          tabIndex={canScrollStart ? 0 : -1}
          className={`${edgeButton} ${canScrollStart ? '' : 'invisible'}`}
        >
          <CaretLeft size={13} weight="bold" className="rtl:rotate-180" />
        </button>
      </div>
      <div
        className={`absolute end-0 inset-y-0 flex items-center justify-end pointer-events-none transition-opacity duration-200 ${
          canScrollEnd ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <button
          type="button"
          onClick={() => scroll('end')}
          aria-label={t('dashboard.tab_bar.scroll_right')}
          tabIndex={canScrollEnd ? 0 : -1}
          className={`${edgeButton} ${canScrollEnd ? '' : 'invisible'}`}
        >
          <CaretRight size={13} weight="bold" className="rtl:rotate-180" />
        </button>
      </div>
    </div>
  )
}
