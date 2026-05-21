'use client'
import React, { useMemo, useState } from 'react'
import { CaretDown, MagnifyingGlass } from '@phosphor-icons/react'
import { ENDPOINTS, CATEGORIES, type EndpointDoc, type HttpMethod } from '@components/Admin/Developers/catalog'

const METHOD_CLS: Record<HttpMethod, string> = {
  GET: 'bg-emerald-400/10 text-emerald-300 border-emerald-400/20',
  POST: 'bg-sky-400/10 text-sky-300 border-sky-400/20',
  PUT: 'bg-amber-400/10 text-amber-300 border-amber-400/20',
  PATCH: 'bg-violet-400/10 text-violet-300 border-violet-400/20',
  DELETE: 'bg-red-400/10 text-red-300 border-red-400/20',
}

export default function EndpointList({
  selectedId,
  onSelect,
}: {
  selectedId: string
  onSelect: (id: string) => void
}) {
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
      <div className="relative p-3 border-b border-white/[0.06]">
        <MagnifyingGlass
          size={14}
          weight="bold"
          className="absolute left-6 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search endpoints…"
          className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/30"
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {CATEGORIES.map((cat) => {
          const items = byCategory[cat] ?? []
          if (items.length === 0) return null
          const isCollapsed = collapsed[cat]
          return (
            <section key={cat} className="border-b border-white/[0.04] last:border-b-0">
              <button
                onClick={() => toggleCategory(cat)}
                className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-white/[0.02] transition-colors"
              >
                <span className="text-xs uppercase tracking-wider text-white/50 font-semibold">
                  {cat}
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-[10px] text-white/40 tabular-nums">{items.length}</span>
                  <CaretDown
                    size={12}
                    weight="bold"
                    className={
                      'text-white/40 transition-transform ' + (isCollapsed ? '-rotate-90' : '')
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
                            'w-full flex items-start gap-2.5 px-3 py-2 text-left border-l-2 transition-colors ' +
                            (isActive
                              ? 'bg-white/[0.06] border-white'
                              : 'border-transparent hover:bg-white/[0.03]')
                          }
                        >
                          <span
                            className={
                              'shrink-0 mt-0.5 inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border font-mono w-12 ' +
                              METHOD_CLS[e.method]
                            }
                          >
                            {e.method}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm text-white truncate">{e.title}</span>
                            <span className="block text-[11px] text-white/40 font-mono truncate">
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
          <div className="px-3 py-10 text-center text-xs text-white/40">
            No endpoints match "{query}"
          </div>
        )}
      </div>
    </div>
  )
}
