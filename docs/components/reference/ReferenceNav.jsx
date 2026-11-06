'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  MagnifyingGlass,
  CaretRight,
  SidebarSimple,
  X,
  ClockCounterClockwise,
} from '@phosphor-icons/react/dist/ssr'
import MethodBadge from './MethodBadge'
import TokenWidget from './TokenWidget'
import { HISTORY_EVENT, readHistory } from './history'

function RecentRequests() {
  const [history, setHistory] = useState([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const load = () => setHistory(readHistory())
    load()
    window.addEventListener(HISTORY_EVENT, load)
    window.addEventListener('storage', load)
    return () => {
      window.removeEventListener(HISTORY_EVENT, load)
      window.removeEventListener('storage', load)
    }
  }, [])

  if (!history.length) return null

  return (
    <div className="lhr-nav-block">
      <button type="button" className="lhr-nav-group" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <ClockCounterClockwise size={13} weight="bold" className="lhr-nav-caret" />
        <span>Recent requests</span>
        <span className="lhr-nav-count">{history.length}</span>
      </button>
      {open && (
        <div className="lhr-nav-ops">
          {history.map((entry, i) => (
            <Link key={`${entry.ts}-${i}`} href={entry.href || '#'} className="lhr-nav-op">
              <MethodBadge method={entry.method} variant="bare" />
              <span className="lhr-nav-op-label" title={entry.path}>
                {entry.path.replace(/^\/api\/v1/, '')}
              </span>
              <span className={`lhr-nav-status ${entry.status < 300 ? 'is-ok' : 'is-err'}`}>
                {entry.status}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

function matches(op, group, q) {
  return (
    op.path.toLowerCase().includes(q) ||
    op.summary.toLowerCase().includes(q) ||
    op.method.toLowerCase() === q ||
    (q.length > 2 && op.method.toLowerCase().startsWith(q)) ||
    group.title.toLowerCase().includes(q)
  )
}

function filterGroups(groups, query) {
  const q = query.trim().toLowerCase()
  if (!q) return groups
  // "get courses" → method + text
  const [first, ...rest] = q.split(/\s+/)
  const methodFilter = ['get', 'post', 'put', 'patch', 'delete'].includes(first) && rest.length ? first : null
  const text = methodFilter ? rest.join(' ') : q
  return groups
    .map((group) => ({
      ...group,
      operations: group.operations.filter(
        (op) => (!methodFilter || op.method.toLowerCase() === methodFilter) && matches(op, group, text)
      ),
    }))
    .filter((group) => group.operations.length > 0)
}

function slugFromPath(pathname) {
  if (!pathname?.startsWith('/reference/')) return null
  const seg = pathname.split('/')[2] || null
  return seg === 'guides' ? null : seg
}

/**
 * Left rail: token, endpoint filter (path, method or summary), guides and
 * grouped endpoints. Scroll-spy highlights the operation in view.
 */
export default function ReferenceNav({ nav, guides }) {
  const pathname = usePathname()
  const currentSlug = slugFromPath(pathname)
  const [query, setQuery] = useState('')
  const [activeId, setActiveId] = useState(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [expanded, setExpanded] = useState(() => new Set(currentSlug ? [currentSlug] : []))
  const inputRef = useRef(null)

  // Keep the current group open as the visitor moves between pages.
  useEffect(() => {
    if (currentSlug) setExpanded((prev) => (prev.has(currentSlug) ? prev : new Set([...prev, currentSlug])))
    setMobileOpen(false)
    setActiveId(null)
  }, [pathname, currentSlug])

  // "/" focuses the filter, Escape clears it.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      e.preventDefault()
      setMobileOpen(true)
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Scroll-spy over the operation headings of the current page.
  useEffect(() => {
    const headings = document.querySelectorAll('.lhr-op-title[id]')
    if (!headings.length) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveId(entry.target.id)
        }
      },
      { rootMargin: '-10% 0px -75% 0px' }
    )
    headings.forEach((h) => observer.observe(h))
    return () => observer.disconnect()
  }, [pathname])

  // Keep the active item visible inside the rail.
  useEffect(() => {
    if (!activeId) return
    const el = document.querySelector(`.lhr-nav [data-op="${CSS.escape(activeId)}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  const filtered = useMemo(() => filterGroups(nav.groups, query), [nav.groups, query])
  const searching = !!query.trim()
  const matchCount = searching ? filtered.reduce((n, g) => n + g.operations.length, 0) : 0

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
      <div className="lhr-nav-mobilebar">
        <button
          type="button"
          className="lhr-btn lhr-btn-secondary"
          onClick={() => setMobileOpen((v) => !v)}
          aria-expanded={mobileOpen}
          aria-controls="lhr-nav"
        >
          {mobileOpen ? <X size={15} weight="bold" /> : <SidebarSimple size={15} weight="bold" />}
          Browse API
        </button>
      </div>

      <aside
        id="lhr-nav"
        className={`lhr-nav ${mobileOpen ? 'is-open' : ''}`}
        data-pagefind-ignore
        aria-label="API reference"
      >
        <div className="lhr-nav-top">
          <div className="lhr-nav-filter">
            <MagnifyingGlass size={14} className="lhr-nav-filter-icon" />
            <input
              ref={inputRef}
              type="search"
              placeholder="Filter endpoints"
              aria-label="Filter endpoints by path, method or summary"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
              spellCheck={false}
            />
            {!searching && <kbd className="lhr-kbd">/</kbd>}
          </div>
          {searching && (
            <p className="lhr-nav-matches" aria-live="polite">
              {matchCount} endpoint{matchCount === 1 ? '' : 's'}
            </p>
          )}
        </div>

        <nav className="lhr-nav-list">
          {!searching && (
            <>
              <div className="lhr-nav-block">
                <Link
                  href="/reference"
                  className={`lhr-nav-link ${pathname === '/reference' ? 'is-active' : ''}`}
                >
                  Overview
                </Link>
              </div>
              <div className="lhr-nav-block">
                <p className="lhr-label lhr-nav-label">Guides</p>
                {guides.map((g) => {
                  const href = `/reference/guides/${g.slug}`
                  return (
                    <Link key={g.slug} href={href} className={`lhr-nav-link ${pathname === href ? 'is-active' : ''}`}>
                      {g.title}
                    </Link>
                  )
                })}
              </div>
              <p className="lhr-label lhr-nav-label">Endpoints</p>
            </>
          )}

          {filtered.map((group) => {
            const isOpen = searching || expanded.has(group.slug)
            const isCurrent = group.slug === currentSlug
            return (
              <div key={group.slug} className="lhr-nav-block lhr-nav-block-tight">
                <button
                  type="button"
                  className={`lhr-nav-group ${isCurrent ? 'is-current' : ''}`}
                  onClick={() => toggleGroup(group.slug)}
                  aria-expanded={isOpen}
                >
                  <CaretRight size={11} weight="bold" className={`lhr-nav-caret ${isOpen ? 'is-open' : ''}`} />
                  <span>{group.title}</span>
                  <span className="lhr-nav-count">{group.operations.length}</span>
                </button>
                {isOpen && (
                  <div className="lhr-nav-ops">
                    {group.operations.map((op) => {
                      const active = isCurrent && activeId === op.id
                      return (
                        <Link
                          key={op.id}
                          href={`/reference/${group.slug}#${op.id}`}
                          data-op={op.id}
                          className={`lhr-nav-op ${active ? 'is-active' : ''}`}
                          title={`${op.method} ${op.path}`}
                          onClick={() => setMobileOpen(false)}
                        >
                          <MethodBadge method={op.method} variant="bare" />
                          <span className="lhr-nav-op-label">{op.summary}</span>
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}

          {searching && filtered.length === 0 && (
            <p className="lhr-nav-empty">No endpoint matches “{query}”.</p>
          )}

          {!searching && <RecentRequests />}
        </nav>

        <div className="lhr-nav-foot">
          <p className="lhr-label">Your token</p>
          <TokenWidget compact />
        </div>
      </aside>
      {mobileOpen && <div className="lhr-nav-scrim" onClick={() => setMobileOpen(false)} aria-hidden="true" />}
    </>
  )
}
