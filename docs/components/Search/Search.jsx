'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/ssr'

// Pagefind's index is generated after the build (scripts/pagefind.mjs) and
// served from /_pagefind. It's loaded the first time someone searches, so it
// costs nothing on page load.
let pagefindPromise = null
function loadPagefind() {
  // Keep the bundler from trying to resolve a file that only exists after build.
  const load = new Function('url', 'return import(url)')
  pagefindPromise ??= load('/_pagefind/pagefind.js').then(async (pf) => {
    await pf.options?.({ excerptLength: 18 })
    return pf
  })
  return pagefindPromise
}

// Pagefind excerpts are text with <mark> around matches; render them without raw HTML.
function Excerpt({ html }) {
  const decode = (s) =>
    s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  const parts = html.split(/(<mark>.*?<\/mark>)/g)
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('<mark>') ? <mark key={i}>{decode(part)}</mark> : <span key={i}>{decode(part)}</span>,
      )}
    </>
  )
}

export default function Search({ className = '', placeholder = 'Search the docs…' }) {
  const router = useRouter()
  const inputRef = useRef(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [error, setError] = useState(false)

  // ⌘K / Ctrl+K and "/" focus the search box.
  useEffect(() => {
    const onKey = (e) => {
      const typing = /input|textarea|select/i.test(document.activeElement?.tagName || '')
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      return
    }
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const pf = await loadPagefind()
        const search = await pf.debouncedSearch(query, {}, 120)
        if (!search || cancelled) return
        const data = await Promise.all(search.results.slice(0, 8).map((r) => r.data()))
        if (!cancelled) {
          setResults(data)
          setActive(0)
          setError(false)
        }
      } catch {
        if (!cancelled) setError(true)
      }
    }, 60)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query])

  const go = useCallback(
    (url) => {
      setOpen(false)
      setQuery('')
      inputRef.current?.blur()
      router.push(url.replace(/\.html$/, ''))
    },
    [router],
  )

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault()
      go(results[active].url)
    } else if (e.key === 'Escape') {
      setOpen(false)
      inputRef.current?.blur()
    }
  }

  return (
    <div className={`lh-search ${className}`}>
      <MagnifyingGlass className="lh-search-icon" size={14} weight="bold" aria-hidden />
      <input
        ref={inputRef}
        type="search"
        value={query}
        placeholder={placeholder}
        aria-label="Search the docs"
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => {
          setOpen(true)
          loadPagefind().catch(() => setError(true))
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
      />
      <kbd className="lh-search-kbd" aria-hidden>
        ⌘K
      </kbd>
      {open && query.trim() && (
        <div className="lh-search-results" role="listbox">
          {error && <div className="lh-search-empty">Search isn’t available in development. Run a production build.</div>}
          {!error && results.length === 0 && <div className="lh-search-empty">No results for “{query}”</div>}
          {results.map((r, i) => (
            <button
              key={r.url}
              type="button"
              role="option"
              aria-selected={i === active}
              className={`lh-search-result ${i === active ? 'lh-search-result-active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                go(r.url)
              }}
            >
              <span className="lh-search-result-title">{r.meta?.title || r.url}</span>
              <span className="lh-search-result-excerpt">
                <Excerpt html={r.excerpt || ''} />
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
