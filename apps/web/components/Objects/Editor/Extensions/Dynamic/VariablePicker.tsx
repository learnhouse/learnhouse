'use client'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Braces, Eye, EyeOff, Search, Settings2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { normalizeForSearch, searchMatchesAny } from '@/lib/search/normalize'
import { VARIABLES, VariableDef } from './dynamicRules'
import { setShowVariableValues, useShowVariableValues } from './variableDisplay'

const GROUPS: VariableDef['group'][] = ['user', 'course', 'progress', 'date', 'custom']

interface VariablePickerProps {
  customDefs: VariableDef[]
  onPick: (def: VariableDef) => void
  onManageCustom: () => void
  onClose: () => void
}

// The toolbar's variable menu: every variable, grouped, searchable, with a
// sample value, plus the org's custom variables and the way to manage them.
export default function VariablePicker({ customDefs, onPick, onManageCustom, onClose }: VariablePickerProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const showValues = useShowVariableValues()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  const all = useMemo(() => [...VARIABLES, ...customDefs], [customDefs])
  const visible = useMemo(() => {
    const q = query.trim()
    if (!q) return all
    return all.filter(
      (v) => searchMatchesAny([v.label, v.description ?? ''], q) || normalizeForSearch(v.path).includes(normalizeForSearch(q))
    )
  }, [all, query])

  return (
    <div
      ref={ref}
      className="absolute end-0 top-full z-50 mt-2 w-80 rounded-xl bg-white text-sm text-gray-700 shadow-xl ring-1 ring-black/10"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
        <Search size={14} className="text-gray-400" />
        <input
          autoFocus
          className="w-full py-1 outline-none"
          value={query}
          placeholder={t('editor.dynamic.picker.search', 'Search variables')}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            if (e.key === 'Enter' && visible[0]) onPick(visible[0])
          }}
        />
      </div>

      <div className="max-h-80 overflow-y-auto p-1">
        {GROUPS.map((group) => {
          const items = visible.filter((v) => v.group === group)
          if (group !== 'custom' && items.length === 0) return null
          return (
            <div key={group} className="pb-1">
              <div className="px-2 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                {t(`editor.dynamic.variable_groups.${group}`, group)}
              </div>
              {items.map((v) => (
                <button
                  key={v.path}
                  type="button"
                  onClick={() => onPick(v)}
                  title={v.description || `{{${v.path}}}`}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start hover:bg-violet-50"
                >
                  <Braces size={13} className="shrink-0 text-violet-500" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      {v.group === 'custom' ? v.label : t(`editor.dynamic.variables.${v.path.replace('.', '_')}`, v.label)}
                    </span>
                    <span className="block truncate font-mono text-[11px] text-gray-400">{`{{${v.path}}}`}</span>
                  </span>
                  <span className="max-w-[90px] shrink-0 truncate text-xs text-gray-400">{v.sample}</span>
                </button>
              ))}
              {group === 'custom' && items.length === 0 && !query && (
                <p className="px-2 py-1.5 text-xs text-gray-400">
                  {t('editor.dynamic.picker.no_custom', 'Your own values, like a support email or a meeting link, set once for every course.')}
                </p>
              )}
            </div>
          )
        })}
        {visible.length === 0 && (
          <p className="px-3 py-4 text-center text-xs text-gray-400">{t('editor.dynamic.no_variable_match', 'No variable matches')}</p>
        )}
      </div>

      <div className="flex items-center gap-1 border-t border-gray-100 p-1.5">
        <button
          type="button"
          onClick={onManageCustom}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-50"
        >
          <Settings2 size={13} /> {t('editor.dynamic.picker.manage_custom', 'Custom variables')}
        </button>
        <button
          type="button"
          onClick={() => setShowVariableValues(!showValues)}
          className="ms-auto inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-100"
          title={t('editor.dynamic.picker.show_values_hint', 'Show sample values in the editor instead of variable names')}
        >
          {showValues ? <EyeOff size={13} /> : <Eye size={13} />}
          {showValues
            ? t('editor.dynamic.picker.show_names', 'Show names')
            : t('editor.dynamic.picker.show_values', 'Show values')}
        </button>
      </div>
    </div>
  )
}
