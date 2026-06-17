'use client'

import { useEffect, useState, useRef } from 'react'

export default function TOC({ headings = [] }) {
  const [activeId, setActiveId] = useState('')
  const observerRef = useRef(null)

  useEffect(() => {
    if (!headings.length) return

    const handleIntersect = (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          setActiveId(entry.target.id)
          break
        }
      }
    }

    observerRef.current = new IntersectionObserver(handleIntersect, {
      rootMargin: '-80px 0px -70% 0px',
      threshold: 0,
    })

    for (const h of headings) {
      const el = document.getElementById(h.id)
      if (el) observerRef.current.observe(el)
    }

    return () => observerRef.current?.disconnect()
  }, [headings])

  if (!headings.length) return null

  return (
    <div className="lh-toc-inner">
      <p className="lh-toc-title">On this page</p>
      <ul className="lh-toc-list">
        {headings.map((heading) => (
          <li key={heading.id}>
            <a
              href={`#${heading.id}`}
              className={`lh-toc-link ${heading.depth > 2 ? 'lh-toc-link-nested' : ''} ${activeId === heading.id ? 'lh-toc-link-active' : ''}`}
              onClick={(e) => {
                e.preventDefault()
                const el = document.getElementById(heading.id)
                if (el) {
                  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  setActiveId(heading.id)
                  history.replaceState(null, '', `#${heading.id}`)
                }
              }}
            >
              {typeof heading.value === 'string' ? heading.value : heading.id}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}
