'use client'

import React from 'react'
import Link from 'next/link'
import {
  ArrowSquareOut,
  Books,
  ClipboardText,
  FilePdf,
  FileText,
  Play,
  Waveform,
} from '@phosphor-icons/react'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@components/ui/hover-card'
import { getUriWithOrg } from '@services/config/config'
import { sourceLocation, sourcePath, sourceTitle, type CopilotSource } from '@/lib/copilot/sources'
import type { AgentSource } from '@services/messaging/messaging'

// Hover cards render in a portal; inside the floating agent bubble they must
// sit above it.
const POPOVER_Z = { zIndex: 10_000 }

export function sourceHref(source: AgentSource, orgslug: string): string | null {
  const path = sourcePath(source as CopilotSource)
  return path ? getUriWithOrg(orgslug, path) : null
}

export function SourceIcon({ source, size = 13 }: { source: AgentSource; size?: number }) {
  const t = `${source.source_type || ''} ${source.activity_type || ''}`.toLowerCase()
  if (t.includes('video') || t.includes('transcript')) return <Play size={size} weight="fill" />
  if (t.includes('audio') || t.includes('podcast')) return <Waveform size={size} weight="bold" />
  if (t.includes('pdf') || t.includes('document')) return <FilePdf size={size} weight="duotone" />
  if (t.includes('assignment')) return <ClipboardText size={size} weight="duotone" />
  if (t.includes('course') || t.includes('chapter')) return <Books size={size} weight="duotone" />
  return <FileText size={size} weight="duotone" />
}

function SourcePreview({ source, orgslug, num }: { source: AgentSource; orgslug: string; num: number }) {
  const href = sourceHref(source, orgslug)
  const location = sourceLocation(source as CopilotSource)
  const crumbs = [source.course_name, source.chapter_name].filter(Boolean).join(' › ')
  const snippet = (source.snippet || source.chunk_text || '').trim()
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 inline-flex items-center justify-center w-7 h-7 rounded-lg bg-gray-100 text-gray-600 shrink-0">
          <SourceIcon source={source} size={14} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 leading-snug line-clamp-2">
            <span className="text-gray-400 font-bold me-1">{num}</span>
            {sourceTitle(source as CopilotSource) || 'Source'}
          </p>
          {crumbs && <p className="text-[11px] text-gray-500 truncate">{crumbs}</p>}
        </div>
      </div>
      {snippet && (
        <p className="text-xs leading-relaxed text-gray-600 line-clamp-4 border-s-2 border-gray-200 ps-2.5">
          {snippet.length > 280 ? snippet.slice(0, 280) + '…' : snippet}
        </p>
      )}
      {href && (
        <Link
          href={href}
          target="_blank"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-900 hover:underline"
        >
          {location?.kind === 'time' ? `Watch at ${location.label}` : location?.kind === 'page' ? `Open page ${location.label}` : 'Open'}
          <ArrowSquareOut size={12} weight="bold" />
        </Link>
      )}
    </div>
  )
}

export function CitationChip({
  num,
  sources,
  orgslug,
  inverted,
}: {
  num: number
  sources: AgentSource[]
  orgslug: string
  inverted?: boolean
}) {
  const source = sources[num - 1]
  const base =
    'inline-flex items-center justify-center min-w-[1.15rem] h-[1.15rem] px-1 mx-0.5 rounded-md text-[10px] font-bold align-[0.1em] transition-colors no-underline'
  const tone = inverted
    ? 'bg-white/15 text-white hover:bg-white/25'
    : 'bg-gray-900/[0.06] text-gray-600 hover:bg-gray-900 hover:text-white'
  if (!source) return <span className={`${base} ${tone} opacity-60`}>{num}</span>
  const href = sourceHref(source, orgslug)
  const chip = href ? (
    <Link href={href} target="_blank" className={`${base} ${tone}`}>
      {num}
    </Link>
  ) : (
    <span className={`${base} ${tone} cursor-default`}>{num}</span>
  )
  return (
    <HoverCard openDelay={120} closeDelay={80}>
      <HoverCardTrigger asChild>{chip}</HoverCardTrigger>
      <HoverCardContent side="top" className="w-72 p-3 rounded-lg bg-white border-gray-200" style={POPOVER_Z}>
        <SourcePreview source={source} orgslug={orgslug} num={num} />
      </HoverCardContent>
    </HoverCard>
  )
}

/** Cards under an agent reply listing what it read. */
export function SourcesStrip({
  sources,
  orgslug,
  compact,
}: {
  sources: AgentSource[]
  orgslug: string
  compact?: boolean
}) {
  if (!sources.length) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {sources.map((source, i) => {
        const href = sourceHref(source, orgslug)
        const location = sourceLocation(source as CopilotSource)
        const card = (
          <span
            className={`group inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition-colors ${
              compact ? 'px-2 py-1' : 'px-2.5 py-1.5 max-w-[240px]'
            }`}
          >
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-gray-100 text-gray-500 group-hover:text-gray-900 shrink-0">
              <SourceIcon source={source} size={11} />
            </span>
            <span className="min-w-0 flex flex-col leading-tight">
              <span className="text-xs font-semibold text-gray-800 truncate">
                <span className="text-gray-400 me-1">{i + 1}</span>
                {sourceTitle(source as CopilotSource) || 'Source'}
              </span>
              {!compact && (
                <span className="text-[11px] text-gray-400 truncate" dir="auto">
                  {[source.course_name, location?.label].filter(Boolean).join(' · ')}
                </span>
              )}
            </span>
          </span>
        )
        return (
          <HoverCard key={i} openDelay={250} closeDelay={80}>
            <HoverCardTrigger asChild>
              {href ? (
                <Link href={href} target="_blank" className="no-underline shrink-0">
                  {card}
                </Link>
              ) : (
                <span className="shrink-0">{card}</span>
              )}
            </HoverCardTrigger>
            <HoverCardContent side="top" className="w-72 p-3 rounded-lg bg-white border-gray-200" style={POPOVER_Z}>
              <SourcePreview source={source} orgslug={orgslug} num={i + 1} />
            </HoverCardContent>
          </HoverCard>
        )
      })}
    </div>
  )
}
