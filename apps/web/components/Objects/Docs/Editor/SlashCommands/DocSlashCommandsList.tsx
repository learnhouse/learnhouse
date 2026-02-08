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
  DocSlashCommandItem,
  DocSlashCommandsListProps,
  DocSlashCommandsListRef,
} from './types'
import {
  categoryLabels,
  groupDocCommandsByCategory,
} from './docSlashCommandsConfig'

const DocSlashCommandsList = forwardRef<
  DocSlashCommandsListRef,
  DocSlashCommandsListProps
>(({ items, command }, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map())

  const flatItems = items

  useEffect(() => {
    setSelectedIndex(0)
  }, [items])

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
      if (item) {
        command(item)
      }
    },
    [flatItems, command]
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

  const groupedCommands = groupDocCommandsByCategory(items)

  if (items.length === 0) {
    return (
      <div className="slash-commands-menu">
        <div className="slash-commands-empty">No results found</div>
      </div>
    )
  }

  let overallIndex = 0

  return (
    <div className="slash-commands-menu" ref={containerRef}>
      {Array.from(groupedCommands.entries()).map(
        ([category, categoryItems]) => (
          <div key={category} className="slash-commands-category">
            <div className="slash-commands-category-label">
              {categoryLabels[category]}
            </div>
            {categoryItems.map((item) => {
              const currentIndex = overallIndex
              overallIndex++
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
                  }`}
                  onClick={() => selectItem(currentIndex)}
                  onMouseEnter={() => setSelectedIndex(currentIndex)}
                >
                  <div className="slash-commands-item-icon">{item.icon}</div>
                  <div className="slash-commands-item-content">
                    <div className="slash-commands-item-title">
                      {item.title}
                    </div>
                    <div className="slash-commands-item-description">
                      {item.description}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )
      )}
    </div>
  )
})

DocSlashCommandsList.displayName = 'DocSlashCommandsList'

export default DocSlashCommandsList
