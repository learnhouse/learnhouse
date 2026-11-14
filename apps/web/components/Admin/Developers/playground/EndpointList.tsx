'use client'
import React, { useMemo, useState } from 'react'
import { CaretDown, MagnifyingGlass } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { ENDPOINTS, CATEGORIES, type EndpointDoc, type HttpMethod } from '@components/Admin/Developers/catalog'

const METHOD_CLS: Record<HttpMethod, string> = {
  GET: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15',
  POST: 'bg-sky-50 text-sky-700 ring-sky-600/15',
  PUT: 'bg-amber-50 text-amber-800 ring-amber-600/15',
  PATCH: 'bg-neutral-100 text-neutral-700 ring-neutral-900/10',
  DELETE: 'bg-rose-50 text-rose-700 ring-rose-600/15',
}

export default function EndpointList({
  selectedId,
  onSelect,
}: {
  selectedId: string
  onSelect: (id: string) => void
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return ENDPOINTS
    return ENDPOINTS.filter((e) =>
      [e.title, e.pathTemplate, e.method, e.category, e.description]
        .join(' ')
        .toLowerCase()
        .includes(q),
    )
  }, [query])

  const byCategory = useMemo(() => {
    const m: Record<string, EndpointDoc[]> = {}
    for (const c of CATEGORIES) m[c] = []
    for (const e of matches) (m[e.category] = m[e.category] ?? []).push(e)
    return m
  }, [matches])

  const toggleCategory = (c: string) =>
    setCollapsed((s) => ({ ...s, [c]: !s[c] }))

  return (
    <div className="flex flex-col h-full">
      <div className="relative p-3 border-b border-neutral-100">
        <MagnifyingGlass
          size={14}
          weight="bold"
          className="absolute start-6 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('admin.developers.endpoint_list.search')}
          className="w-full h-9 bg-white rounded-xl ring-1 ring-inset ring-neutral-200 ps-8 pe-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900/15"
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {CATEGORIES.map((cat) => {
          const items = byCategory[cat] ?? []
          if (items.length === 0) return null
          const isCollapsed = collapsed[cat]
          return (
            <section key={cat} className="border-b border-neutral-100 last:border-b-0">
              <button
                onClick={() => toggleCategory(cat)}
                className="w-full flex items-center justify-between px-3 py-2.5 text-start hover:bg-neutral-50 transition-colors"
              >
                <span className="text-[11px] uppercase tracking-wide text-neutral-400 font-semibold">
                  {cat}
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-[10px] text-neutral-400 tabular-nums">{items.length}</span>
                  <CaretDown
                    size={12}
                    weight="bold"
                    className={
                      'text-neutral-400 transition-transform ' + (isCollapsed ? '-rotate-90 rtl:rotate-90' : '')
                    }
                  />
                </span>
              </button>
              {!isCollapsed && (
                <ul>
                  {items.map((e) => {
                    const isActive = e.id === selectedId
                    return (
                      <li key={e.id}>
                        <button
                          onClick={() => onSelect(e.id)}
                          className={
                            'w-full flex items-start gap-2.5 px-3 py-2 text-start border-s-2 transition-colors ' +
                            (isActive
                              ? 'bg-neutral-100 border-neutral-900'
                              : 'border-transparent hover:bg-neutral-50')
                          }
                        >
                          <span
                            className={
                              'shrink-0 mt-0.5 inline-flex items-center justify-center px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider ring-1 ring-inset font-mono w-12 ' +
                              METHOD_CLS[e.method]
                            }
                          >
                            {e.method}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm text-neutral-900 truncate">{e.title}</span>
                            <span className="block text-[11px] text-neutral-400 font-mono truncate" dir="ltr">
                              /{e.pathTemplate}
                            </span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          )
        })}

        {Object.values(byCategory).every((v) => v.length === 0) && (
          <div className="px-3 py-10 text-center text-xs text-neutral-400">
            {t('admin.developers.endpoint_list.no_match', { query })}
          </div>
        )}
      </div>
    </div>
  )
}
