'use client'
import React, { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { Braces } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { VariableDef } from './dynamicRules'

export interface VariableSuggestionListRef {
  onKeyDown: (event: KeyboardEvent) => boolean
}

interface Props {
  items: VariableDef[]
  command: (item: VariableDef) => void
}

// The menu that opens on "{{": every variable, its meaning and a sample value.
const VariableSuggestionList = forwardRef<VariableSuggestionListRef, Props>(({ items, command }, ref) => {
  const { t } = useTranslation()
  const [selected, setSelected] = useState(0)
  const [prevItems, setPrevItems] = useState(items)
  if (items !== prevItems) {
    setPrevItems(items)
    setSelected(0)
  }

  useImperativeHandle(ref, () => ({
    onKeyDown: (event) => {
      if (!items.length) return false
      if (event.key === 'ArrowDown') {
        setSelected((i) => (i + 1) % items.length)
        return true
      }
      if (event.key === 'ArrowUp') {
        setSelected((i) => (i - 1 + items.length) % items.length)
        return true
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        command(items[selected])
        return true
      }
      return false
    },
  }))

  useEffect(() => {
    document.getElementById(`lh-variable-option-${selected}`)?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  if (!items.length) {
    return (
      <div className="rounded-xl bg-white px-3 py-2 text-xs text-gray-400 shadow-lg ring-1 ring-black/10">
        {t('editor.dynamic.no_variable_match', 'No variable matches')}
      </div>
    )
  }

  return (
    <div className="max-h-72 w-72 overflow-y-auto rounded-xl bg-white p-1 shadow-lg ring-1 ring-black/10">
      <div className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
        {t('editor.dynamic.insert_variable', 'Insert a variable')}
      </div>
      {items.map((item, index) => (
        <button
          key={item.path}
          id={`lh-variable-option-${index}`}
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => command(item)}
          onMouseEnter={() => setSelected(index)}
          className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-sm ${
            index === selected ? 'bg-violet-50 text-violet-900' : 'text-gray-700'
          }`}
        >
          <Braces size={14} className="shrink-0 text-violet-500" />
          <span className="min-w-0 flex-1 truncate">
            {t(`editor.dynamic.variables.${item.path.replace('.', '_')}`, item.label)}
          </span>
          <span className="shrink-0 text-xs text-gray-400">{item.sample}</span>
        </button>
      ))}
    </div>
  )
})

VariableSuggestionList.displayName = 'VariableSuggestionList'

export default VariableSuggestionList
