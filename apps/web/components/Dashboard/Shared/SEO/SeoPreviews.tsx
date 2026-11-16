'use client'
import React from 'react'
import { Globe, ImageSquare } from '@phosphor-icons/react'
import { clipDescription } from '@/lib/seo/meta'

/** Google-style result: favicon + site + breadcrumb URL, blue title, snippet. */
export function SerpPreview({
  url,
  title,
  description,
  siteName,
  favicon,
}: {
  url: string
  title: string
  description: string
  siteName: string
  favicon?: string | null
}) {
  let host = url
  let crumbs: string[] = []
  try {
    const u = new URL(url)
    host = u.host
    crumbs = u.pathname.split('/').filter(Boolean)
  } catch {
    // relative URL while the page has no absolute base yet
  }
  // Google truncates titles by pixel width (~600px); ~60 characters is the
  // usual cut, close enough for a preview.
  const shownTitle = title.length > 60 ? `${title.slice(0, 59).trimEnd()}…` : title
  return (
    <div className="rounded-xl bg-white ring-1 ring-inset ring-neutral-200 p-4 font-[arial,sans-serif]" dir="auto">
      <div className="flex items-center gap-2.5">
        <span className="w-7 h-7 rounded-full bg-neutral-100 ring-1 ring-neutral-200 flex items-center justify-center overflow-hidden shrink-0">
          {favicon ? <img src={favicon} alt="" width={18} height={18} className="w-[18px] h-[18px] object-contain" /> : <Globe size={14} className="text-neutral-400" />}
        </span>
        <span className="min-w-0 leading-tight">
          <span className="block text-[14px] text-[#202124] truncate">{siteName}</span>
          <span className="block text-[12px] text-[#4d5156] truncate">
            {host}
            {crumbs.length ? ` › ${crumbs.join(' › ')}` : ''}
          </span>
        </span>
      </div>
      <div className="mt-2 text-[20px] leading-[1.3] text-[#1a0dab] hover:underline cursor-default break-words">{shownTitle || '—'}</div>
      <p className="mt-1 text-[14px] leading-[1.58] text-[#4d5156] break-words">{clipDescription(description, 160) || '—'}</p>
    </div>
  )
}

/** Link card as most networks render it (large image, host, title, text). */
export function SocialPreview({
  image,
  title,
  description,
  host,
  small = false,
}: {
  image?: string | null
  title: string
  description: string
  host: string
  small?: boolean
}) {
  const img = image ? (
    <img src={image} alt="" width={1200} height={630} className="w-full h-full object-cover" loading="lazy" />
  ) : (
    <ImageSquare size={28} className="text-neutral-300" />
  )
  if (small) {
    return (
      <div className="flex rounded-xl overflow-hidden ring-1 ring-inset ring-neutral-200 bg-white" dir="auto">
        <div className="w-28 shrink-0 aspect-square bg-neutral-100 flex items-center justify-center">{img}</div>
        <div className="p-3 min-w-0">
          <div className="text-[12px] text-neutral-500 truncate">{host}</div>
          <div className="text-[14px] font-semibold text-neutral-900 line-clamp-2">{title || '—'}</div>
          <div className="text-[12px] text-neutral-500 line-clamp-2">{description}</div>
        </div>
      </div>
    )
  }
  return (
    <div className="rounded-xl overflow-hidden ring-1 ring-inset ring-neutral-200 bg-white" dir="auto">
      <div className="aspect-[1200/630] bg-neutral-100 flex items-center justify-center">{img}</div>
      <div className="px-3.5 py-3 bg-neutral-50 border-t border-neutral-200">
        <div className="text-[12px] uppercase tracking-wide text-neutral-500 truncate">{host}</div>
        <div className="text-[15px] font-semibold text-neutral-900 line-clamp-2">{title || '—'}</div>
        <div className="text-[13px] text-neutral-500 line-clamp-2">{clipDescription(description, 200)}</div>
      </div>
    </div>
  )
}
