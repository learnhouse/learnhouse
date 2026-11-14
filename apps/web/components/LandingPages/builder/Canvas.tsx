'use client'
/**
 * The canvas: the real renderer at the chosen breakpoint width, with
 * selection and hover outlines, a small toolbar on the selected element, and
 * drag-and-drop with snapping drop indicators.
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, ArrowElbowLeftUp, Copy, Plus, Trash } from '@phosphor-icons/react'
import { useOrgTheme } from '@/lib/theme/useOrgTheme'
import { themeFontsHref, themeRootProps } from '@/lib/theme/orgTheme'
import type { Breakpoint, LandingDoc, LandingNode } from '../model/types'
import { CONTAINER_TYPES, INLINE_TEXT } from '../model/types'
import { CANVAS_WIDTHS } from '../model/style'
import { findNode, locate } from '../model/tree'
import LandingRenderer from '../render/LandingRenderer'
import { TypeIcon } from './catalog'

export interface DropTarget {
  parentId: string | null
  index: number
  /** Indicator geometry relative to the frame. */
  rect: { left: number; top: number; width: number; height: number }
  orientation: 'horizontal' | 'vertical'
  label: string
}

export type DragPayload = { kind: 'new'; node: LandingNode } | { kind: 'move'; id: string }

export const DRAG_MIME = 'application/x-lh-landing'

/** The node being dragged (dataTransfer is not readable during dragover). */
export const dragState: { payload: DragPayload | null } = { payload: null }

interface CanvasProps {
  doc: LandingDoc
  breakpoint: Breakpoint
  selectedId: string | null
  hoverId: string | null
  editingId: string | null
  highlight?: Set<string>
  orgslug: string
  org: any
  accessToken?: string
  onSelect: (id: string | null) => void
  onHover: (id: string | null) => void
  onEdit: (id: string | null) => void
  onTextCommit: (id: string, field: string, value: string) => void
  onDrop: (payload: DragPayload, parentId: string | null, index: number) => void
  onAction: (action: 'duplicate' | 'delete' | 'up' | 'down' | 'parent') => void
  onAddFirst: () => void
}

interface Box {
  left: number
  top: number
  width: number
  height: number
}

/** `el`'s box in the frame's own (unscaled) pixels. */
function boxOf(el: Element, frame: Element, scale = 1): Box {
  const r = el.getBoundingClientRect()
  const f = frame.getBoundingClientRect()
  return { left: (r.left - f.left) / scale, top: (r.top - f.top) / scale, width: r.width / scale, height: r.height / scale }
}

function elFor(frame: HTMLElement | null, id: string | null): HTMLElement | null {
  if (!frame || !id) return null
  return frame.querySelector<HTMLElement>(`[data-lhp-id="${CSS.escape(id)}"]`)
}

export default function Canvas(props: CanvasProps) {
  const { t } = useTranslation()
  const { doc, breakpoint, selectedId, hoverId, editingId } = props
  const frameRef = React.useRef<HTMLDivElement>(null)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const [tick, force] = React.useReducer((x: number) => x + 1, 0)
  const [drop, setDrop] = React.useState<DropTarget | null>(null)
  // The page renders at its real width (desktop 1280+, tablet 820, phone 390)
  // and is scaled down to fit, so breakpoints match what visitors get.
  const [avail, setAvail] = React.useState(0)
  const [frameH, setFrameH] = React.useState(600)
  const [pageDir, setPageDir] = React.useState<'ltr' | 'rtl'>('ltr')
  React.useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    setPageDir(document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr')
    const pad = () => {
      const cs = getComputedStyle(el)
      setAvail(el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight))
    }
    pad()
    const ro = new ResizeObserver(pad)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  React.useEffect(() => {
    const el = frameRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setFrameH(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const nominal = breakpoint === 'base' ? Math.min(1440, Math.max(1280, avail)) : CANVAS_WIDTHS[breakpoint]
  const scale = avail > 0 && avail < nominal ? avail / nominal : 1
  const orgTheme = useOrgTheme()
  const themeRoot = themeRootProps(orgTheme)
  const fontsHref = themeFontsHref(orgTheme)

  React.useEffect(() => {
    if (!fontsHref || document.getElementById('lh-theme-fonts')) return
    const link = document.createElement('link')
    link.id = 'lh-theme-fonts'
    link.rel = 'stylesheet'
    link.href = fontsHref
    document.head.appendChild(link)
  }, [fontsHref])

  // Re-measure outlines on layout changes (images loading, data arriving).
  React.useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    let raf = 0
    const tick = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(force)
    }
    const ro = new ResizeObserver(tick)
    ro.observe(frame)
    const mo = new MutationObserver(tick)
    mo.observe(frame, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'class'] })
    const scroller = scrollRef.current
    scroller?.addEventListener('scroll', tick, { passive: true })
    window.addEventListener('resize', tick)
    return () => {
      ro.disconnect()
      mo.disconnect()
      scroller?.removeEventListener('scroll', tick)
      window.removeEventListener('resize', tick)
      cancelAnimationFrame(raf)
    }
  }, [])

  // Keep the selection in view when it changes from the layers panel or keys.
  React.useEffect(() => {
    const el = elFor(frameRef.current, selectedId)
    if (!el || !scrollRef.current) return
    const r = el.getBoundingClientRect()
    const s = scrollRef.current.getBoundingClientRect()
    if (r.bottom < s.top + 40 || r.top > s.bottom - 40) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [selectedId])

  const targetId = (e: React.SyntheticEvent): string | null => {
    const el = (e.target as HTMLElement).closest?.('[data-lhp-id]') as HTMLElement | null
    return el && frameRef.current?.contains(el) ? el.getAttribute('data-lhp-id') : null
  }

  const onClickCapture = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[contenteditable=true]')) return
    const inRenderer = (e.target as HTMLElement).closest('.lhp-root')
    if (!inRenderer) return
    // Links, buttons and forms never navigate or submit on the canvas.
    e.preventDefault()
    e.stopPropagation()
    const id = targetId(e)
    props.onSelect(id)
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    const id = targetId(e)
    if (!id) return
    let node = findNode(doc, id)
    // Double-clicking a button's label edits the button.
    if (node && !INLINE_TEXT[node.type]) {
      const btn = (e.target as HTMLElement).closest('[data-lhp-type=button]')
      if (btn) node = findNode(doc, btn.getAttribute('data-lhp-id') || '')
    }
    if (node && INLINE_TEXT[node.type]) props.onEdit(node.id)
  }

  /* ── drag and drop ──────────────────────────────────────────────────── */

  const computeDrop = (clientX: number, clientY: number, payload: DragPayload): DropTarget | null => {
    const frame = frameRef.current
    if (!frame) return null
    const dragged = payload.kind === 'new' ? payload.node : findNode(doc, payload.id)
    if (!dragged) return null
    const f = frame.getBoundingClientRect()
    const isSection = dragged.type === 'section' || dragged.type === 'symbol'
    const rootEls = Array.from(frame.querySelectorAll<HTMLElement>('.lhp-root > [data-lhp-id]'))

    const between = (els: HTMLElement[], parentId: string | null, vertical: boolean, parentLabel: string): DropTarget => {
      let index = els.length
      for (let i = 0; i < els.length; i++) {
        const r = els[i].getBoundingClientRect()
        const mid = vertical ? r.top + r.height / 2 : r.left + r.width / 2
        if ((vertical ? clientY : clientX) < mid) {
          index = i
          break
        }
      }
      const ref = els[Math.min(index, els.length - 1)]
      let rect: DropTarget['rect']
      if (!ref) {
        const p = parentId ? elFor(frame, parentId) : frame.querySelector('.lhp-root')
        const pr = p ? p.getBoundingClientRect() : f
        rect = { left: pr.left - f.left + 8, top: pr.top - f.top + pr.height / 2, width: pr.width - 16, height: 0 }
      } else {
        const r = ref.getBoundingClientRect()
        const after = index >= els.length
        rect = vertical
          ? { left: r.left - f.left, top: (after ? r.bottom : r.top) - f.top, width: r.width, height: 0 }
          : { left: (after ? r.right : r.left) - f.left, top: r.top - f.top, width: 0, height: r.height }
      }
      return { parentId, index, rect, orientation: vertical ? 'horizontal' : 'vertical', label: parentLabel }
    }

    if (isSection) return between(rootEls, null, true, t('landingBuilder.canvas.drop_page'))

    // The innermost container under the pointer (not the dragged node itself).
    let el = document.elementFromPoint(clientX, clientY) as HTMLElement | null
    while (el && frame.contains(el)) {
      const id = el.getAttribute('data-lhp-id')
      const type = el.getAttribute('data-lhp-type') as LandingNode['type'] | null
      if (id && type && CONTAINER_TYPES.has(type) && !(payload.kind === 'move' && (id === payload.id || el.closest(`[data-lhp-id="${CSS.escape(payload.id)}"]`)))) {
        const node = findNode(doc, id)
        if (node) {
          // Sections hold one inner container; drop into it when it exists.
          const target = node.type === 'section' && node.children?.length === 1 && node.children[0].type === 'container' ? node.children[0] : node
          const targetEl = elFor(frame, target.id) || el
          const kids = Array.from(targetEl.children).filter((c) => c.hasAttribute('data-lhp-id')) as HTMLElement[]
          const cs = getComputedStyle(targetEl)
          const isRow = target.type === 'columns' || cs.display.includes('grid') || (cs.display.includes('flex') && cs.flexDirection.startsWith('row'))
          return between(kids, target.id, !isRow, target.name || t(`landingBuilder.elements.${target.type}`))
        }
      }
      el = el.parentElement
    }
    // Outside any container: a new section at the nearest page position.
    return between(rootEls, null, true, t('landingBuilder.canvas.drop_new_section'))
  }

  const onDragOver = (e: React.DragEvent) => {
    const payload = dragState.payload
    if (!payload) return
    e.preventDefault()
    e.dataTransfer.dropEffect = payload.kind === 'move' ? 'move' : 'copy'
    const next = computeDrop(e.clientX, e.clientY, payload)
    setDrop((cur) => (cur && next && cur.parentId === next.parentId && cur.index === next.index ? cur : next))
  }

  const onDropEv = (e: React.DragEvent) => {
    const payload = dragState.payload
    e.preventDefault()
    const target = drop
    setDrop(null)
    dragState.payload = null
    if (payload && target) props.onDrop(payload, target.parentId, target.index)
  }

  /* ── overlays ───────────────────────────────────────────────────────── */

  const [boxes, setBoxes] = React.useState<{ sel: Box | null; hov: Box | null; marks: (Box & { id: string })[] }>({ sel: null, hov: null, marks: [] })
  React.useLayoutEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const selEl = elFor(frame, selectedId)
    const hovEl = hoverId && hoverId !== selectedId ? elFor(frame, hoverId) : null
    const marks = props.highlight
      ? (Array.from(props.highlight).map((id) => {
          const el = elFor(frame, id)
          return el ? { id, ...boxOf(el, frame) } : null
        }).filter(Boolean) as (Box & { id: string })[])
      : []
    setBoxes({ sel: selEl ? boxOf(selEl, frame) : null, hov: hovEl ? boxOf(hovEl, frame) : null, marks })
  }, [tick, selectedId, hoverId, doc, breakpoint, props.highlight, scale])
  const selBox = boxes.sel
  const hovBox = boxes.hov
  const highlightBoxes = boxes.marks
  const selNode = selectedId ? findNode(doc, selectedId) : null
  const loc = selectedId ? locate(doc, selectedId) : null

  return (
    <div ref={scrollRef} className="relative h-full overflow-auto bg-[#eceef1] px-3 py-4 sm:px-6 sm:py-6" onClick={(e) => e.target === e.currentTarget && props.onSelect(null)}>
      <div dir="ltr" className="relative mx-auto" style={{ width: nominal * scale, height: frameH * scale }}>
      <div
        className="absolute start-0 top-0 origin-top-left"
        style={{ width: nominal, transform: scale !== 1 ? `scale(${scale})` : undefined }}
        onDragOver={onDragOver}
        onDragLeave={(e) => {
          if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDrop(null)
        }}
        onDrop={onDropEv}
        data-scale={scale}
      >
        <div
          ref={frameRef}
          dir={pageDir}
          className={`lh-org-font-root lh-theme relative overflow-hidden rounded-xl bg-white nice-shadow ${breakpoint === 'mobile' ? 'rounded-[28px]' : ''}`}
          {...themeRoot.attrs}
          style={{ ...(themeRoot.style as React.CSSProperties), minHeight: 480 }}
          onClickCapture={onClickCapture}
          onDoubleClick={onDoubleClick}
          onMouseMove={(e) => props.onHover(targetId(e))}
          onMouseLeave={() => props.onHover(null)}
          data-testid="landing-canvas"
        >
          <LandingRenderer
            doc={doc}
            mode="canvas"
            orgslug={props.orgslug}
            org={props.org}
            accessToken={props.accessToken}
            session="authenticated"
            editingId={editingId}
            onTextCommit={props.onTextCommit}
            onTextCancel={() => props.onEdit(null)}
          />
          {doc.root.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-[14px] font-semibold text-neutral-800">{t('landingBuilder.canvas.empty_title')}</p>
              <p className="max-w-sm text-[13px] text-neutral-500">{t('landingBuilder.canvas.empty_text')}</p>
              <button type="button" onClick={props.onAddFirst} className="mt-1 inline-flex h-8 items-center gap-1.5 rounded-lg bg-neutral-900 px-3 text-[13px] font-medium text-white hover:bg-neutral-800">
                <Plus size={14} weight="bold" /> {t('landingBuilder.canvas.empty_action')}
              </button>
            </div>
          )}
        </div>
      </div>
        {/* Overlays live outside the page, above it, and never take clicks. */}
        <div className="pointer-events-none absolute inset-0 z-10" aria-hidden={!selBox}>
          {highlightBoxes.map((b) => (
            <div key={b.id} className="absolute rounded-sm ring-2 ring-amber-400/80 bg-amber-300/10" style={{ left: b.left, top: b.top, width: b.width, height: b.height }} />
          ))}
          {hovBox && <div className="absolute rounded-sm outline outline-1 outline-sky-400/80" style={{ left: hovBox.left, top: hovBox.top, width: hovBox.width, height: hovBox.height }} />}
          {selBox && selNode && (
            <>
              <div className="absolute rounded-sm outline outline-2 outline-sky-500" style={{ left: selBox.left, top: selBox.top, width: selBox.width, height: Math.max(2, selBox.height) }} />
              <div
                className="pointer-events-auto absolute flex items-center gap-0.5 rounded-md bg-sky-500 p-0.5 text-white shadow-sm"
                style={{ left: Math.max(0, selBox.left), top: selBox.top >= 30 ? selBox.top - 28 : selBox.top + 4 }}
                data-testid="landing-selection-toolbar"
              >
                <span className="inline-flex items-center gap-1 px-1.5 text-[11px] font-semibold">
                  <TypeIcon type={selNode.type} size={12} weight="bold" />
                  <span className="max-w-[140px] truncate">{selNode.name || t(`landingBuilder.elements.${selNode.type}`)}</span>
                </span>
                {loc?.parentId && (
                  <ToolbarBtn label={t('landingBuilder.actions.select_parent')} onClick={() => props.onAction('parent')}><ArrowElbowLeftUp size={12} weight="bold" /></ToolbarBtn>
                )}
                <ToolbarBtn label={t('landingBuilder.actions.move_up')} onClick={() => props.onAction('up')}><ArrowUp size={12} weight="bold" /></ToolbarBtn>
                <ToolbarBtn label={t('landingBuilder.actions.move_down')} onClick={() => props.onAction('down')}><ArrowDown size={12} weight="bold" /></ToolbarBtn>
                <ToolbarBtn label={t('landingBuilder.actions.duplicate')} onClick={() => props.onAction('duplicate')}><Copy size={12} weight="bold" /></ToolbarBtn>
                <ToolbarBtn label={t('landingBuilder.actions.delete')} onClick={() => props.onAction('delete')}><Trash size={12} weight="bold" /></ToolbarBtn>
              </div>
            </>
          )}
          {drop && (
            <>
              <div
                className="absolute rounded-full bg-sky-500 shadow-[0_0_0_3px_rgba(14,165,233,0.25)]"
                style={drop.orientation === 'horizontal'
                  ? { left: drop.rect.left, top: drop.rect.top - 1.5, width: Math.max(24, drop.rect.width), height: 3 }
                  : { left: drop.rect.left - 1.5, top: drop.rect.top, width: 3, height: Math.max(24, drop.rect.height) }}
              />
              <div className="absolute rounded-md bg-sky-500 px-1.5 py-0.5 text-[11px] font-semibold text-white shadow-sm" style={{ left: drop.rect.left, top: drop.rect.top + 6 }}>
                {drop.label}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ToolbarBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-white/20">
      {children}
    </button>
  )
}
