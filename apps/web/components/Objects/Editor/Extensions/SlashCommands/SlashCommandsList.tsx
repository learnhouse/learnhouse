'use client'

import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
  useRef,
  useCallback,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  SlashCommandItem,
  SlashCommandsListProps,
  SlashCommandsListRef,
} from './types'
import {
  categoryLabelKeys,
  groupCommandsByCategory,
} from './slashCommandsConfig'
import PlanBadge from '@components/Dashboard/Shared/PlanRestricted/PlanBadge'
import { planMeetsRequirement } from '@services/plans/plans'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'

const SlashCommandsList = forwardRef<SlashCommandsListRef, SlashCommandsListProps>(
  ({ items, command, currentPlan = 'free' }, ref) => {
    const { t } = useTranslation()
    const { track } = useLHAnalytics('editor')
    const [selectedIndex, setSelectedIndex] = useState(0)
    const containerRef = useRef<HTMLDivElement>(null)
    const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map())

    // Helper to check if a command is available based on plan
    const isCommandAvailable = useCallback((item: SlashCommandItem) => {
      if (!item.requiredPlan) return true
      return planMeetsRequirement(currentPlan, item.requiredPlan)
    }, [currentPlan])

    // Flatten items for keyboard navigation
    const flatItems = items

    // Reset selection when items change
    useEffect(() => {
      setSelectedIndex(0)
    }, [items])

    // Scroll selected item into view
    useEffect(() => {
      const selectedElement = itemRefs.current.get(selectedIndex)
      if (selectedElement) {
        selectedElement.scrollIntoView({
          block: 'nearest',
          behavior: 'smooth',
        })
      }
    }, [selectedIndex])

    const selectItem = useCallback(
      (index: number) => {
        const item = flatItems[index]
        if (item && isCommandAvailable(item)) {
          command(item)
          track(AnalyticsEvent.EditorBlockInserted, { block_id: item.id, category: item.category })
        }
      },
      [flatItems, command, isCommandAvailable, track]
    )

    useImperativeHandle(ref, () => ({
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key === 'ArrowUp') {
          setSelectedIndex((prev) =>
            prev <= 0 ? flatItems.length - 1 : prev - 1
          )
          return true
        }

        if (event.key === 'ArrowDown') {
          setSelectedIndex((prev) =>
            prev >= flatItems.length - 1 ? 0 : prev + 1
          )
          return true
        }

        if (event.key === 'Enter') {
          selectItem(selectedIndex)
          return true
        }

        return false
      },
    }))

    const groupedCommands = groupCommandsByCategory(items)

    if (items.length === 0) {
      return (
        <div className="w-[300px] rounded-xl bg-white p-4 text-center text-[13px] text-neutral-500 shadow-[0_12px_32px_rgba(0,0,0,0.1),0_0_0_1px_rgba(0,0,0,0.08)]">
          {t('editor.slash_menu.no_results')}
        </div>
      )
    }

    // Track overall index for keyboard navigation
    let overallIndex = 0

    return (
      <div
        ref={containerRef}
        role="listbox"
        aria-label={t('editor.blocks_v2.insert_block', 'Insert a block')}
        className="flex w-[min(320px,calc(100vw-24px))] flex-col overflow-hidden rounded-xl bg-white shadow-[0_12px_32px_rgba(0,0,0,0.1),0_0_0_1px_rgba(0,0,0,0.08)]"
      >
        <div className="max-h-[min(360px,60vh)] overflow-y-auto overscroll-contain p-1.5">
          {Array.from(groupedCommands.entries()).map(([category, categoryItems]) => (
            <div key={category} className="mb-1 last:mb-0">
              <div className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                {t(categoryLabelKeys[category])}
              </div>
              {categoryItems.map((item) => {
                const currentIndex = overallIndex
                overallIndex++
                const available = isCommandAvailable(item)
                const selected = currentIndex === selectedIndex
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    data-slash-item={item.id}
                    ref={(el) => {
                      if (el) {
                        itemRefs.current.set(currentIndex, el)
                      } else {
                        itemRefs.current.delete(currentIndex)
                      }
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-start transition-colors ${
                      selected ? 'bg-neutral-100' : 'hover:bg-neutral-50'
                    } ${!available ? 'cursor-not-allowed opacity-50' : ''}`}
                    onClick={() => available && selectItem(currentIndex)}
                    onMouseEnter={() => setSelectedIndex(currentIndex)}
                    disabled={!available}
                  >
                    <span
                      className={`flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-white text-neutral-600 shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_1px_1px_rgba(0,0,0,0.03)] ${!available ? 'grayscale' : ''}`}
                    >
                      {item.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-[13px] font-medium leading-tight text-neutral-900">
                        <span className={!available ? 'text-neutral-400' : ''}>{t(item.titleKey, item.title)}</span>
                        {item.requiredPlan && (
                          <PlanBadge currentPlan={currentPlan} requiredPlan={item.requiredPlan} size="sm" />
                        )}
                      </span>
                      <span className={`mt-0.5 block truncate text-[11px] leading-tight ${!available ? 'text-neutral-300' : 'text-neutral-500'}`}>
                        {t(item.descriptionKey, item.description)}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 border-t border-neutral-100 bg-neutral-50/60 px-3 py-1.5 text-[10px] text-neutral-400 max-md:hidden">
          <span><kbd className="font-sans font-semibold text-neutral-500">↑↓</kbd> {t('editor.blocks_v2.slash_navigate', 'navigate')}</span>
          <span><kbd className="font-sans font-semibold text-neutral-500">↵</kbd> {t('editor.blocks_v2.slash_insert', 'insert')}</span>
          <span><kbd className="font-sans font-semibold text-neutral-500">esc</kbd> {t('editor.blocks_v2.slash_close', 'close')}</span>
        </div>
      </div>
    )
  }
)

SlashCommandsList.displayName = 'SlashCommandsList'

export default SlashCommandsList
