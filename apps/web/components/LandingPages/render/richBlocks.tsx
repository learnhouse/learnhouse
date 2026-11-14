'use client'
/**
 * Rich text (markdown), embeds from the known provider list, and the custom
 * HTML/CSS element. Loaded on demand.
 *
 * Custom code is sanitized by the API on save, cleaned again here with
 * DOMPurify, and rendered in a sandboxed frame without scripts: even a
 * sanitizer gap cannot run code or reach the page.
 */
import React from 'react'
import ReactMarkdown from 'react-markdown'
import DOMPurify from 'dompurify'
import { parseEmbedUrl } from '@components/Objects/Editor/Blocks/embeds/embedProviders'
import { useUrlEmbedSandbox } from '@/lib/media/useUrlEmbedSandbox'
import type { LandingNode } from '../model/types'
import { rootProps, useRender } from './context'
import { str } from './elements'

export function RichTextBlock({ node }: { node: LandingNode }) {
  const { mode } = useRender()
  return (
    <div {...rootProps(node, mode, 'lhp-prose')}>
      {/* react-markdown never renders raw HTML and drops javascript: links. */}
      <ReactMarkdown>{str(node.props?.markdown)}</ReactMarkdown>
    </div>
  )
}

export function EmbedBlock({ node }: { node: LandingNode }) {
  const { mode, labels } = useRender()
  const p = node.props || {}
  const parsed = parseEmbedUrl(str(p.url))
  const sandbox = useUrlEmbedSandbox(parsed?.embedUrl)
  if (!parsed) {
    return mode === 'canvas' ? <div {...rootProps(node, mode)} style={{ width: '100%' }}><div className="lhp-ph">{labels.placeholder_embed}</div></div> : null
  }
  if (!sandbox) return null
  const aspect = typeof p.aspect === 'string' && /^\d+\/\d+$/.test(p.aspect) ? p.aspect.replace('/', ' / ') : null
  const height = Math.min(2000, Math.max(100, Number(p.height) || parsed.height || 480))
  const props = rootProps(node, mode)
  return (
    <div {...props} style={{ ...(props.style || {}), width: '100%' }}>
      <iframe
        className="lhp-frame"
        src={parsed.embedUrl}
        title={str(p.title) || parsed.label}
        loading="lazy"
        sandbox={sandbox}
        allow="fullscreen; clipboard-write; encrypted-media; picture-in-picture"
        style={aspect ? { aspectRatio: aspect, height: 'auto' } : { height }}
      />
    </div>
  )
}

export function srcDocFor(html: string, css: string): string {
  const clean = DOMPurify.sanitize(html || '', { FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input'], FORBID_ATTR: ['srcdoc'] })
  const safeCss = (css || '').replace(/<\/?\s*style/gi, '').replace(/@import[^;]*;?/gi, '')
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><base target="_blank"><style>:root{color-scheme:light}html,body{margin:0;padding:0;font-family:system-ui,-apple-system,sans-serif;color:#0f172a;background:transparent}img{max-width:100%}${safeCss}</style></head><body>${clean}</body></html>`
}

export function HtmlBlock({ node }: { node: LandingNode }) {
  const { mode, labels } = useRender()
  const p = node.props || {}
  const height = Math.min(4000, Math.max(40, Number(p.height) || 320))
  const doc = React.useMemo(() => srcDocFor(str(p.html), str(p.css)), [p.html, p.css])
  if (!str(p.html) && !str(p.css)) {
    return mode === 'canvas' ? <div {...rootProps(node, mode)} style={{ width: '100%' }}><div className="lhp-ph">{labels.custom_code}</div></div> : null
  }
  const props = rootProps(node, mode)
  return (
    <div {...props} style={{ ...(props.style || {}), width: '100%' }}>
      <iframe className="lhp-frame" title={labels.custom_code} sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} style={{ height }} loading="lazy" />
    </div>
  )
}
