'use client'

/*
 Wraps rendered lesson content so every block adapts to the background it is
 drawn on (see blockTheme.ts for the modes and styles/block-theme.css for how
 blocks follow them).

 Detection, in order:
   1. the `theme` prop when it is 'light' or 'dark'
   2. the nearest ancestor with data-lh-block-theme="light|dark" (how
      <learnhouse-activity theme="dark">, @learnhouse/react and any other host
      say it explicitly without threading a prop)
   3. auto: the effective background behind the scope (ancestors walked and
      composited until an opaque colour), then its luminance and chroma

 It runs in a layout effect, before the first paint of the content, and again
 whenever the host changes theme: class/style/data-theme changes on any
 ancestor up to the one that paints the background (plus <html> and <body>),
 a prefers-color-scheme change, or a resize of the scope (which also sets
 data-lh-bt-size for container-width rules).
*/

import React, { useCallback, useLayoutEffect, useRef, useState } from 'react'
import {
  documentThemeFrom,
  effectiveBackground,
  normalizeRequest,
  readableHostInk,
  resolveBlockTheme,
  type BlockThemeMode,
  type BlockThemeRequest,
  type BlockThemeTone,
  type DocumentTheme,
} from './blockTheme'

export type { BlockThemeRequest } from './blockTheme'

export type BlockThemeSize = 'xs' | 'sm' | 'md' | 'lg'

interface State {
  mode: BlockThemeMode
  tone: BlockThemeTone | null
  vars: Record<string, string>
  ink: 'host' | 'theme'
  headroom: 'low' | null
  painted: boolean
  size: BlockThemeSize
  key: string
}

const INITIAL: State = { mode: 'light', tone: null, vars: {}, ink: 'host', headroom: null, painted: false, size: 'lg', key: '' }

const OBSERVED_ATTRIBUTES = ['class', 'style', 'data-theme', 'data-lh-block-theme', 'data-adm-theme', 'data-mode']

export function sizeFor(width: number): BlockThemeSize {
  if (width < 480) return 'xs'
  if (width < 640) return 'sm'
  if (width < 900) return 'md'
  return 'lg'
}

/** The explicit request from the closest ancestor that sets one (or 'auto'). */
function ancestorRequest(el: Element | null): BlockThemeRequest {
  const host = el?.parentElement?.closest('[data-lh-block-theme]')
  return host ? normalizeRequest(host.getAttribute('data-lh-block-theme')) : 'auto'
}

export function useBlockTheme(ref: React.RefObject<HTMLElement | null>, theme: BlockThemeRequest = 'auto'): State {
  const [state, setState] = useState<State>(INITIAL)
  const request = normalizeRequest(theme)

  const measure = useCallback((): { state: State; source: Element | null } | null => {
    const el = ref.current
    if (!el) return null
    const explicit = request !== 'auto' ? request : ancestorRequest(el)
    const { color, source } = effectiveBackground(el.parentElement)
    const resolved = resolveBlockTheme(color, explicit)
    // Keep the host's text colour for prose when it already reads well.
    const ink = resolved.painted ? 'theme' : resolved.mode === 'light' || readableHostInk(el.parentElement, color) ? 'host' : 'theme'
    const size = sizeFor(el.getBoundingClientRect().width || el.parentElement?.clientWidth || 1024)
    const key = `${resolved.mode}|${resolved.tone}|${resolved.host}|${ink}|${size}|${resolved.painted}`
    return { state: { mode: resolved.mode, tone: resolved.tone, vars: resolved.vars, ink, headroom: resolved.headroom, painted: resolved.painted, size, key }, source }
  }, [ref, request])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof window === 'undefined') return
    let raf = 0
    let observed: Element[] = []
    const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(() => schedule()) : null

    const observeChain = (source: Element | null) => {
      if (!mo) return
      mo.disconnect()
      // Every ancestor from the scope up to the element that paints the
      // background, plus <html>/<body> where theme classes usually live.
      const chain: Element[] = []
      let node: Element | null = el.parentElement
      while (node) {
        chain.push(node)
        if (node === source) break
        node = node.parentElement
      }
      for (const root of [document.documentElement, document.body]) if (root && !chain.includes(root)) chain.push(root)
      chain.forEach((n) => mo.observe(n, { attributes: true, attributeFilter: OBSERVED_ATTRIBUTES }))
      observed = chain
    }

    const run = () => {
      raf = 0
      const next = measure()
      if (!next) return
      setState((prev) => (prev.key === next.state.key ? prev : next.state))
      if (!observed.length || !observed.includes(next.source as Element)) observeChain(next.source)
    }
    function schedule() {
      if (!raf) raf = requestAnimationFrame(run)
    }

    // First pass synchronously: the content never paints in the wrong theme.
    run()

    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    mq?.addEventListener?.('change', schedule)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null
    ro?.observe(el)
    // Hosts that restyle without touching attributes can ask for a re-check.
    el.addEventListener('lh-block-theme-refresh', schedule)

    return () => {
      if (raf) cancelAnimationFrame(raf)
      mo?.disconnect()
      ro?.disconnect()
      mq?.removeEventListener?.('change', schedule)
      el.removeEventListener('lh-block-theme-refresh', schedule)
    }
  }, [ref, measure])

  return state
}

interface BlockThemeScopeProps {
  /** 'auto' (default) follows the host background; 'light' / 'dark' force a mode. */
  theme?: BlockThemeRequest
  className?: string
  style?: React.CSSProperties
  children?: React.ReactNode
}

export default function BlockThemeScope({ theme = 'auto', className, style, children }: BlockThemeScopeProps) {
  const ref = useRef<HTMLDivElement>(null)
  const state = useBlockTheme(ref, theme)
  return (
    <div
      ref={ref}
      className={className ? `lh-bt ${className}` : 'lh-bt'}
      data-lh-bt={state.mode}
      data-lh-bt-tone={state.tone ?? undefined}
      data-lh-bt-ink={state.tone ? state.ink : undefined}
      data-lh-bt-headroom={state.headroom ?? undefined}
      data-lh-bt-painted={state.painted ? '' : undefined}
      data-lh-bt-size={state.size}
      style={{ ...(state.vars as React.CSSProperties), ...style }}
    >
      {children}
    </div>
  )
}

/**
 The theme of the nearest BlockThemeScope above `ref`, as a document theme
 (see injectDocumentTheme), kept current when the scope re-themes. Used by
 blocks that render their own document (magic blocks).
*/
export function useDocumentTheme(ref: React.RefObject<HTMLElement | null>): DocumentTheme {
  const [theme, setTheme] = useState<DocumentTheme>(() => documentThemeFrom(null))
  useLayoutEffect(() => {
    const scope = ref.current?.closest('[data-lh-bt]') ?? null
    const read = () => setTheme((prev) => {
      const next = documentThemeFrom(scope)
      return JSON.stringify(prev) === JSON.stringify(next) ? prev : next
    })
    read()
    if (!scope || typeof MutationObserver === 'undefined') return
    const mo = new MutationObserver(read)
    mo.observe(scope, { attributes: true, attributeFilter: ['data-lh-bt', 'data-lh-bt-tone', 'style'] })
    return () => mo.disconnect()
  }, [ref])
  return theme
}
