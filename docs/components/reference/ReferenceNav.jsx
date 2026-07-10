'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MagnifyingGlass, CaretRight, List, X } from '@phosphor-icons/react/dist/ssr'
import MethodBadge from './MethodBadge'
import TokenWidget from './TokenWidget'

function filterGroups(groups, query) {
  const q = query.trim().toLowerCase()
  if (!q) return groups
  return groups
    .map((group) => ({
      ...group,
      operations: group.operations.filter(
        (op) =>
          op.path.toLowerCase().includes(q) ||
          op.summary.toLowerCase().includes(q) ||
          op.method.toLowerCase().includes(q) ||
          group.title.toLowerCase().includes(q)
      ),
    }))
    .filter((group) => group.operations.length > 0)
}

/**
 * Left rail: token widget, search across every endpoint, grouped nav.
 * Scroll-spy highlights the operation currently in view.
 */
export default function ReferenceNav({ nav }) {
  const pathname = usePathname()
  const [query, setQuery] = useState('')
  const [activeId, setActiveId] = useState(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [expanded, setExpanded] = useState(() => new Set())

  const currentSlug = pathname?.startsWith('/reference/')
    ? pathname.split('/')[2] || null
    : null

  // Keep the current group expanded by default.
  useEffect(() => {
    if (currentSlug) setExpanded((prev) => new Set([...prev, currentSlug]))
    setMobileOpen(false)
  }, [pathname, currentSlug])

  // Scroll-spy over the operation articles of the current page.
  useEffect(() => {
    const articles = document.querySelectorAll('article.lh-ref-op[id]')
    if (!articles.length) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveId(entry.target.id)
        }
      },
      { rootMargin: '-15% 0px -70% 0px' }
    )
    articles.forEach((a) => observer.observe(a))
    return () => observer.disconnect()
  }, [pathname])

  const filtered = useMemo(() => filterGroups(nav.groups, query), [nav.groups, query])
  const searching = !!query.trim()

  const toggleGroup = (slug) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
  }

  return (
    <>
      <button
        className="lh-ref-nav-mobile-btn"
        onClick={() => setMobileOpen((v) => !v)}
        aria-label={mobileOpen ? 'Close endpoint list' : 'Open endpoint list'}
      >
        {mobileOpen ? <X size={16} weight="bold" /> : <List size={16} weight="bold" />}
        Endpoints
      </button>

      <aside className={`lh-ref-nav ${mobileOpen ? 'lh-ref-nav-open' : ''}`}>
        <div className="lh-ref-nav-token">
          <TokenWidget compact />
        </div>

        <div className="lh-ref-nav-search">
          <MagnifyingGlass size={14} className="lh-ref-nav-search-icon" />
          <input
            type="search"
            placeholder="Search endpoints…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
          />
        </div>

        <nav className="lh-ref-nav-list">
          <Link
            href="/reference"
            className={`lh-ref-nav-overview ${pathname === '/reference' ? 'lh-ref-nav-item-active' : ''}`}
          >
            Overview
          </Link>

          {filtered.map((group) => {
            const isOpen = searching || expanded.has(group.slug)
            const isCurrent = group.slug === currentSlug
            return (
              <div key={group.slug} className="lh-ref-nav-group">
                <button
                  className={`lh-ref-nav-group-btn ${isCurrent ? 'lh-ref-nav-group-current' : ''}`}
                  onClick={() => toggleGroup(group.slug)}
                >
                  <CaretRight
                    size={11}
                    weight="bold"
                    className={`lh-ref-nav-caret ${isOpen ? 'lh-ref-nav-caret-open' : ''}`}
                  />
                  {group.title}
                  <span className="lh-ref-nav-count">{group.operations.length}</span>
                </button>
                {isOpen && (
                  <div className="lh-ref-nav-ops">
                    {group.operations.map((op) => {
                      const active = isCurrent && activeId === op.id
                      return (
                        <Link
                          key={op.id}
                          href={`/reference/${group.slug}#${op.id}`}
                          className={`lh-ref-nav-item ${active ? 'lh-ref-nav-item-active' : ''}`}
                        >
                          <MethodBadge method={op.method} small />
                          <span className="lh-ref-nav-item-label">{op.summary}</span>
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}

          {searching && filtered.length === 0 && (
            <p className="lh-ref-nav-empty">No endpoints match “{query}”.</p>
          )}
        </nav>
      </aside>
      {mobileOpen && <div className="lh-ref-nav-overlay" onClick={() => setMobileOpen(false)} />}
    </>
  )
}
