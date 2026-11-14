'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { useTranslation } from 'react-i18next'
import { ListBullets, SidebarSimple } from '@phosphor-icons/react'
import { Dialog, DialogContent, DialogTitle } from '@components/ui/dialog'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { computeHeadingIds } from './headingIds'

interface TableOfContentsProps {
  editor: Editor | null
}

interface OutlineItem {
  id: string
  text: string
  /** 0, 1 or 2: indentation under the shallowest heading level present. */
  depth: number
}

// Only h1–h3 make the outline; deeper headings are detail.
const MAX_LEVEL = 3
const MIN_HEADINGS = 2

const storageKey = (userUuid?: string) => `lh:toc-collapsed:${userUuid || 'anon'}`

function readCollapsed(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function writeCollapsed(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? '1' : '0')
  } catch {
    /* private mode: the toggle still works for this page view */
  }
}

/** Distance from the top of the viewport under which a heading counts as read. */
function stickyOffset(): number {
  return document.documentElement.classList.contains('lh-focus-open') ? 96 : 150
}

function prefersReducedMotion(): boolean {
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/**
 * "On this page": a compact, sticky outline of the lesson's h1–h3. The heading
 * being read is highlighted (IntersectionObserver), a click scrolls to it and
 * puts it in the URL, and a thin bar shows how far through the lesson the
 * reader is. It collapses to a slim rail (remembered per learner), hides
 * itself on lessons with fewer than two headings and becomes an "On this
 * page" button that opens a sheet where the column doesn't fit (CSS
 * container query on .canva-content-wrapper, so it also follows focus mode
 * and an open AI panel).
 */
const TableOfContents = ({ editor }: TableOfContentsProps) => {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const key = storageKey(session?.data?.user?.user_uuid)
  const [items, setItems] = useState<OutlineItem[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  // Per learner: the stored value is re-read when the signed-in user changes.
  const [stored, setStored] = useState(() => ({ key, value: typeof window === 'undefined' ? false : readCollapsed(key) }))
  if (stored.key !== key) setStored({ key, value: readCollapsed(key) })
  const collapsed = stored.key === key ? stored.value : false
  const [sheetOpen, setSheetOpen] = useState(false)
  // While a click scrolls smoothly, the observer would light up every heading
  // passed on the way: hold the clicked one until the scroll settles.
  const lockUntil = useRef(0)

  // Outline from the document (same ids as the heading renderer).
  useEffect(() => {
    if (!editor) return
    const update = () => {
      const all = computeHeadingIds(editor.state.doc).filter((h) => h.level <= MAX_LEVEL && h.text)
      const top = all.reduce((m, h) => Math.min(m, h.level), MAX_LEVEL)
      setItems(all.map((h) => ({ id: h.id, text: h.text, depth: Math.min(2, h.level - top) })))
    }
    update()
    editor.on('update', update)
    return () => {
      editor.off('update', update)
    }
  }, [editor])

  const headingEl = useCallback(
    (id: string): HTMLElement | null => {
      const root = editor?.view?.dom as HTMLElement | undefined
      if (!root) return null
      try {
        return root.querySelector<HTMLElement>(`#${CSS.escape(id)}`)
      } catch {
        return null
      }
    },
    [editor]
  )

  const enabled = items.length >= MIN_HEADINGS

  // Which heading is being read: the last one above the sticky offset.
  const pickActive = useCallback(() => {
    if (Date.now() < lockUntil.current) return
    // A heading in the upper fifth of the reading area already owns it.
    const offset = stickyOffset() + Math.min(160, window.innerHeight * 0.2)
    let current: string | null = null
    for (const item of items) {
      const el = headingEl(item.id)
      if (!el) continue
      if (el.getBoundingClientRect().top <= offset) current = item.id
      else break
    }
    // At the end of the lesson the last sections may never reach the band:
    // the reader has got there, so the last heading is the one being read.
    const body = editor?.view?.dom as HTMLElement | undefined
    if (body && body.getBoundingClientRect().bottom <= window.innerHeight + 2 && items.length) {
      current = items[items.length - 1].id
    }
    setActiveId(current ?? items[0]?.id ?? null)
  }, [items, headingEl, editor])

  useEffect(() => {
    if (!enabled || typeof IntersectionObserver === 'undefined') return
    const offset = stickyOffset()
    const observer = new IntersectionObserver(() => pickActive(), {
      // A band across the upper part of the screen: a heading entering or
      // leaving it is a change of section.
      rootMargin: `-${offset}px 0px -55% 0px`,
      threshold: [0, 1],
    })
    for (const item of items) {
      const el = headingEl(item.id)
      if (el) observer.observe(el)
    }
    pickActive()
    return () => observer.disconnect()
  }, [enabled, items, headingEl, pickActive])

  // Reading progress through the lesson body. Captures scrolls of any element,
  // so it follows the focus-mode layer as well as the window.
  useEffect(() => {
    if (!enabled || !editor) return
    let frame = 0
    const measure = () => {
      frame = 0
      const dom = editor.view?.dom as HTMLElement | undefined
      if (!dom) return
      const rect = dom.getBoundingClientRect()
      const vh = window.innerHeight
      const range = rect.height - vh * 0.6
      const value = range <= 0 ? (rect.bottom <= vh ? 1 : 0) : Math.min(1, Math.max(0, -rect.top / range))
      setProgress(Math.round(value * 100))
      // The observer only fires on crossings; a long jump (Home/End) may skip
      // them, so settle the active heading here too.
      if (Date.now() >= lockUntil.current) pickActive()
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    measure()
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      document.removeEventListener('scroll', onScroll, { capture: true })
      window.removeEventListener('resize', onScroll)
    }
  }, [enabled, editor, pickActive])

  const goTo = useCallback(
    (id: string, smooth = true) => {
      const el = headingEl(id)
      if (!el) return
      const behavior: 'smooth' | 'auto' = smooth && !prefersReducedMotion() ? 'smooth' : 'auto'
      lockUntil.current = Date.now() + (behavior === 'smooth' ? 900 : 50)
      setActiveId(id)
      el.scrollIntoView({ behavior, block: 'start' })
      try {
        window.history.replaceState(window.history.state, '', `#${id}`)
      } catch {
        /* sandboxed frame: the scroll is what matters */
      }
    },
    [headingEl]
  )

  // Opening a link to a heading (#heading-…) lands on it once the lesson renders.
  const landed = useRef(false)
  useEffect(() => {
    if (landed.current || !enabled) return
    const hash = decodeURIComponent(window.location.hash.slice(1))
    if (!hash || !items.some((i) => i.id === hash)) return
    landed.current = true
    requestAnimationFrame(() => goTo(hash, false))
    // Content above the lesson (images, the course header) can still settle:
    // land again once it has.
    window.setTimeout(() => {
      try {
        goTo(hash, false)
      } catch {
        /* the lesson was left in the meantime */
      }
    }, 700)
  }, [enabled, items, goTo])

  // A #heading link followed on the page (a note's quote, the address bar).
  useEffect(() => {
    if (!enabled) return
    const onHash = () => {
      const hash = decodeURIComponent(window.location.hash.slice(1))
      if (hash && items.some((i) => i.id === hash)) goTo(hash)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [enabled, items, goTo])

  const toggle = (next: boolean) => {
    setStored({ key, value: next })
    writeCollapsed(key, next)
  }

  const activeItem = useMemo(() => items.find((i) => i.id === activeId) ?? null, [items, activeId])

  if (!enabled) return null

  const list = (onPick?: () => void, large = false) => (
    <ol className="lh-toc-list relative m-0 list-none! p-0! border-s border-neutral-200">
      {items.map((item) => {
        const active = item.id === activeId
        return (
          <li key={item.id} className="m-0 list-none! p-0">
            <a
              href={`#${item.id}`}
              aria-current={active ? 'location' : undefined}
              onClick={(e) => {
                e.preventDefault()
                onPick?.()
                // Let a closing sheet hand the page back before scrolling.
                if (onPick) setTimeout(() => goTo(item.id), 180)
                else goTo(item.id)
              }}
              className={`-ms-px block border-s-2 py-1 pe-1 leading-snug no-underline! transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/15 rounded-e-md ${
                large ? 'text-[15px] py-2' : 'text-[13px]'
              } ${
                active
                  ? 'border-lh-accent text-neutral-900 font-semibold'
                  : 'border-transparent text-neutral-500 hover:text-neutral-900 hover:border-neutral-300'
              }`}
              style={{ paddingInlineStart: `${12 + item.depth * 12}px` }}
            >
              <span className="line-clamp-2" dir="auto">{item.text}</span>
            </a>
          </li>
        )
      })}
    </ol>
  )

  const progressBar = (
    <div
      className="h-[3px] w-full overflow-hidden rounded-full bg-neutral-100"
      role="progressbar"
      aria-label={t('activities.toc.progress', { defaultValue: 'Reading progress' })}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={progress}
    >
      <div className="h-full rounded-full bg-lh-accent transition-[width] duration-200 ease-out" style={{ width: `${progress}%` }} />
    </div>
  )

  return (
    <aside className="lh-toc" data-collapsed={collapsed ? 'true' : undefined}>
      {/* Wide: a column beside the lesson. */}
      <div className="lh-toc-col">
        {collapsed ? (
          <button
            type="button"
            onClick={() => toggle(false)}
            aria-expanded={false}
            aria-label={t('activities.toc.show', { defaultValue: 'Show outline' })}
            title={t('activities.toc.show', { defaultValue: 'Show outline' })}
            className="group flex w-8 flex-col items-center gap-2 rounded-lg py-2 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/15"
          >
            <ListBullets size={16} weight="bold" />
            {/* The rail keeps the reading progress, vertically. */}
            <span className="relative block h-16 w-[3px] overflow-hidden rounded-full bg-neutral-200/80" aria-hidden>
              <span className="absolute inset-x-0 top-0 rounded-full bg-lh-accent" style={{ height: `${progress}%` }} />
            </span>
          </button>
        ) : (
          <nav aria-label={t('activities.toc.title', { defaultValue: 'On this page' })} className="flex flex-col gap-2.5">
            <div className="flex items-center gap-2 ps-3">
              <span className="text-xs font-semibold text-neutral-800">{t('activities.toc.title', { defaultValue: 'On this page' })}</span>
              <span className="text-[11px] font-medium tabular-nums text-neutral-400">{progress}%</span>
              <button
                type="button"
                onClick={() => toggle(true)}
                aria-expanded
                aria-label={t('activities.toc.hide', { defaultValue: 'Hide outline' })}
                title={t('activities.toc.hide', { defaultValue: 'Hide outline' })}
                className="ms-auto grid size-7 place-items-center rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/15"
              >
                <SidebarSimple size={15} weight="bold" className="[&:dir(rtl)]:-scale-x-100" />
              </button>
            </div>
            <div className="ps-3 pe-1">{progressBar}</div>
            <div className="lh-toc-scroll overflow-y-auto overscroll-contain pe-1">{list()}</div>
          </nav>
        )}
      </div>

      {/* Narrow (phones, focus mode with a side panel…): a button and a sheet. */}
      <div className="lh-toc-compact">
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="relative flex max-w-full items-center gap-2 h-8 ps-2.5 pe-3 overflow-hidden rounded-full bg-white text-neutral-700 ring-1 ring-black/[0.07] shadow-[0_1px_2px_rgba(0,0,0,0.05),0_4px_12px_-6px_rgba(0,0,0,0.12)] text-[13px] font-medium"
          aria-haspopup="dialog"
        >
          <ListBullets size={15} weight="bold" className="shrink-0 text-neutral-500" />
          {/* Reading progress along the bottom edge of the button. */}
          <span className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] bg-neutral-100" aria-hidden>
            <span className="block h-full bg-lh-accent transition-[width] duration-200" style={{ width: `${progress}%` }} />
          </span>
          <span className="shrink-0">{t('activities.toc.title', { defaultValue: 'On this page' })}</span>
          {activeItem && (
            <span className="min-w-0 truncate text-neutral-400 font-normal" dir="auto">· {activeItem.text}</span>
          )}
        </button>
      </div>
      <Dialog open={sheetOpen} onOpenChange={setSheetOpen}>
        <DialogContent className="flex max-h-[80dvh] flex-col p-0 bg-white sm:max-w-md">
          <div className="shrink-0 px-5 pt-7 pb-3 border-b border-black/[0.05]">
            <DialogTitle className="text-base font-semibold text-neutral-900">
              {t('activities.toc.title', { defaultValue: 'On this page' })}
            </DialogTitle>
            <div className="mt-2.5 flex items-center gap-3">
              <div className="flex-1">{progressBar}</div>
              <span className="text-xs font-medium tabular-nums text-neutral-500">{progress}%</span>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-3">{list(() => setSheetOpen(false), true)}</div>
        </DialogContent>
      </Dialog>
    </aside>
  )
}

export default TableOfContents
