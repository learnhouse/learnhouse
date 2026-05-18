'use client'

import type { CSSProperties } from 'react'

function toEmbedUrl(url: string): string {
  // Google Docs/Sheets/Slides → preview
  const gd = url.match(/^(https?:\/\/docs\.google\.com\/(?:document|spreadsheets|presentation)\/d\/[^/]+)/)
  if (gd) return `${gd[1]}/preview`
  const gf = url.match(/^(https?:\/\/docs\.google\.com\/forms\/d\/[^/]+)/)
  if (gf) return `${gf[1]}/viewform?embedded=true`
  if (/^https?:\/\/(www\.)?figma\.com\//.test(url)) {
    return `https://www.figma.com/embed?embed_host=learnhouse&url=${encodeURIComponent(url)}`
  }
  const loom = url.match(/^(https?:\/\/www\.loom\.com)\/share\/(.+)$/)
  if (loom) return `${loom[1]}/embed/${loom[2]}`
  if (url.includes('canva.com/design/')) {
    return url.includes('?') ? `${url}&embed` : `${url}?embed`
  }
  const miro = url.match(/^(https?:\/\/miro\.com\/app\/board\/)(.+)$/)
  if (miro) return `https://miro.com/app/live-embed/${miro[2]}`
  return url
}

export interface EmbedActivityProps {
  activity: { content?: { embed_url?: string } }
  style?: CSSProperties
}

export function EmbedActivity({ activity, style }: EmbedActivityProps) {
  const embedUrl = activity.content?.embed_url
  if (!embedUrl) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-sm text-gray-500">
        No embed URL configured
      </div>
    )
  }
  return (
    <div className="w-full px-6 py-6" style={style}>
      <div className="w-full rounded-xl overflow-hidden" style={{ aspectRatio: '16/9' }}>
        <iframe
          src={toEmbedUrl(embedUrl)}
          title="Embedded content"
          className="w-full h-full border-0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"
        />
      </div>
    </div>
  )
}

export default EmbedActivity
