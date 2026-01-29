'use client'

import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
  useRef,
  useCallback,
} from 'react'
import {
  SlashCommandItem,
  SlashCommandsListProps,
  SlashCommandsListRef,
} from './types'
import {
  categoryLabels,
  groupCommandsByCategory,
} from './slashCommandsConfig'
import PlanBadge from '@components/Dashboard/Shared/PlanRestricted/PlanBadge'
import { planMeetsRequirement } from '@services/plans/plans'

const SlashCommandsList = forwardRef<SlashCommandsListRef, SlashCommandsListProps>(
  ({ items, command, currentPlan = 'free' }, ref) => {
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
        }
      },
      [flatItems, command, isCommandAvailable]
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
        <div className="slash-commands-menu">
          <div className="slash-commands-empty">No results found</div>
        </div>
      )
    }

    // Track overall index for keyboard navigation
    let overallIndex = 0

    return (
      <div className="slash-commands-menu" ref={containerRef}>
        {Array.from(groupedCommands.entries()).map(([category, categoryItems]) => (
          <div key={category} className="slash-commands-category">
            <div className="slash-commands-category-label">
              {categoryLabels[category]}
            </div>
            {categoryItems.map((item) => {
              const currentIndex = overallIndex
              overallIndex++
              const available = isCommandAvailable(item)
              return (
                <button
                  key={item.id}
                  ref={(el) => {
                    if (el) {
                      itemRefs.current.set(currentIndex, el)
                    } else {
                      itemRefs.current.delete(currentIndex)
                    }
                  }}
                  className={`slash-commands-item ${
                    currentIndex === selectedIndex ? 'is-selected' : ''
                  } ${!available ? 'opacity-50 cursor-not-allowed' : ''}`}
                  onClick={() => available && selectItem(currentIndex)}
                  onMouseEnter={() => setSelectedIndex(currentIndex)}
                  disabled={!available}
                >
                  <div className={`slash-commands-item-icon ${!available ? 'grayscale' : ''}`}>{item.icon}</div>
                  <div className="slash-commands-item-content">
                    <div className="slash-commands-item-title flex items-center gap-2">
                      <span className={!available ? 'text-gray-400' : ''}>{item.title}</span>
                      {item.requiredPlan && (
                        <PlanBadge
                          currentPlan={currentPlan}
                          requiredPlan={item.requiredPlan}
                          size="sm"
                        />
                      )}
                    </div>
                    <div className={`slash-commands-item-description ${!available ? 'text-gray-400' : ''}`}>
                      {item.description}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    )
  }
)

SlashCommandsList.displayName = 'SlashCommandsList'

export default SlashCommandsList
