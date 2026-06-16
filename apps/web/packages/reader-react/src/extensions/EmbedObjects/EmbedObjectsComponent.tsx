'use client'

import { NodeViewWrapper } from '@tiptap/react'

function toIframeSrc(url: string): string {
  // Google Docs/Sheets/Slides → preview
  const gd = url.match(/^(https?:\/\/docs\.google\.com\/(?:document|spreadsheets|presentation)\/d\/[^/]+)/)
  if (gd) return `${gd[1]}/preview`
  // Google Forms → embedded
  const gf = url.match(/^(https?:\/\/docs\.google\.com\/forms\/d\/[^/]+)/)
  if (gf) return `${gf[1]}/viewform?embedded=true`
  // Figma
  if (/^https?:\/\/(www\.)?figma\.com\//.test(url)) {
    return `https://www.figma.com/embed?embed_host=learnhouse&url=${encodeURIComponent(url)}`
  }
  // Loom
  const loom = url.match(/^(https?:\/\/www\.loom\.com)\/share\/(.+)$/)
  if (loom) return `${loom[1]}/embed/${loom[2]}`
  // Canva
  if (url.includes('canva.com/design/')) {
    return url.includes('?') ? `${url}&embed` : `${url}?embed`
  }
  // Miro
  const miro = url.match(/^(https?:\/\/miro\.com\/app\/board\/)(.+)$/)
  if (miro) return `https://miro.com/app/live-embed/${miro[2]}`
  return url
}

export default function EmbedObjectsComponent(props: any) {
  const { embedUrl, embedCode, embedHeight, embedWidth, alignment } = props.node.attrs
  const align =
    alignment === 'center' ? 'mx-auto' : alignment === 'right' ? 'ml-auto' : ''

  const widthStyle =
    embedWidth === '100%' || !embedWidth
      ? { width: '100%' as const }
      : { width: typeof embedWidth === 'number' ? `${embedWidth}px` : (embedWidth as string) }
  const heightStyle = {
    height: typeof embedHeight === 'number' ? `${embedHeight}px` : (embedHeight as string),
  }

  // `embedCode` is author-supplied HTML/script (e.g. an oEmbed payload).
  // We render it inside an iframe via `srcdoc`. Critically we do NOT include
  // `allow-same-origin` in the sandbox — `srcdoc` documents inherit the
  // embedder's origin, so with `allow-same-origin + allow-scripts` an author
  // could read the consumer's cookies/localStorage via `window.parent`. With
  // just `allow-scripts` the iframe runs in a unique origin and cannot reach
  // the host page. Most legitimate oEmbed payloads (YouTube, Twitter) still
  // work; the rare ones that don't should use the URL embed path instead.
  if (embedCode) {
    return (
      <NodeViewWrapper className="block-embed w-full">
        <div
          className={`overflow-hidden rounded-lg ${align}`}
          style={{ ...widthStyle, ...heightStyle }}
        >
          <iframe
            srcDoc={String(embedCode)}
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-popups allow-forms allow-presentation"
            referrerPolicy="no-referrer"
          />
        </div>
      </NodeViewWrapper>
    )
  }

  if (!embedUrl) return null

  return (
    <NodeViewWrapper className="block-embed w-full">
      <div className={`overflow-hidden rounded-lg ${align}`} style={widthStyle}>
        <iframe
          src={toIframeSrc(embedUrl)}
          className="w-full border-0 rounded-lg"
          style={heightStyle}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"
        />
      </div>
    </NodeViewWrapper>
  )
}
