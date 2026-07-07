'use client'
import React from 'react'
import { WarningCircle, SquaresFour, Microphone, UsersThree, Code, GraduationCap, ArrowSquareOut } from '@phosphor-icons/react'
import { getUriWithOrg } from '@services/config/config'

type ResourceKind = 'course' | 'podcast' | 'community' | 'board' | 'playground'

const KIND_META: Record<ResourceKind, { label: string; icon: any; color: string }> = {
  course: { label: 'Course', icon: GraduationCap, color: 'text-blue-500' },
  podcast: { label: 'Podcast', icon: Microphone, color: 'text-violet-500' },
  community: { label: 'Community', icon: UsersThree, color: 'text-emerald-500' },
  board: { label: 'Board', icon: SquaresFour, color: 'text-indigo-500' },
  playground: { label: 'Playground', icon: Code, color: 'text-amber-500' },
}

/**
 * Base internal route for a Library resource, mirroring resourceHref's
 * uuid-prefix handling. Boards live at a top-level chrome-free route; the other
 * kinds live under the (withmenu) group (see buildEmbedUrl for the chrome=none
 * suppression used when embedded in the activity player).
 */
function buildResourceUrl(kind: ResourceKind, resourceUuid: string, orgslug: string): string | null {
  if (!resourceUuid) return null
  switch (kind) {
    case 'board':
      return getUriWithOrg(orgslug, `/board/${resourceUuid.replace('board_', '')}`)
    case 'community':
      return getUriWithOrg(orgslug, `/community/${resourceUuid.replace('community_', '')}`)
    case 'podcast':
      return getUriWithOrg(orgslug, `/podcast/${resourceUuid.replace('podcast_', '')}`)
    case 'playground':
      // Playgrounds use the full prefixed uuid.
      return getUriWithOrg(orgslug, `/playground/${resourceUuid}`)
    case 'course':
      return getUriWithOrg(orgslug, `/course/${resourceUuid.replace('course_', '')}`)
    default:
      return null
  }
}

// Boards already render chrome-free; the (withmenu) kinds need ?chrome=none.
function buildEmbedUrl(kind: ResourceKind, baseUrl: string): string {
  if (kind === 'board') return baseUrl
  return baseUrl.includes('?') ? `${baseUrl}&chrome=none` : `${baseUrl}?chrome=none`
}

interface ResourceActivityProps {
  activity: any
  orgslug: string
  style?: React.CSSProperties
}

function ResourceActivity({ activity, orgslug, style }: ResourceActivityProps) {
  const kind = (activity.content?.resource_type || '') as ResourceKind
  const resourceUuid = activity.content?.resource_uuid || ''
  const baseUrl = KIND_META[kind] ? buildResourceUrl(kind, resourceUuid, orgslug) : null

  if (!baseUrl) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <WarningCircle size={40} className="text-red-400" />
        <p className="text-sm text-gray-600">No resource configured</p>
      </div>
    )
  }

  const meta = KIND_META[kind]
  const Icon = meta.icon
  const embedUrl = buildEmbedUrl(kind, baseUrl)

  return (
    <div className="w-full px-6 py-6" style={style}>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon size={20} weight="duotone" className={`${meta.color} flex-shrink-0`} />
          <span className="text-sm font-medium text-gray-600">{meta.label}</span>
        </div>
        <a
          href={baseUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-800 transition-colors"
        >
          <ArrowSquareOut size={14} />
          Open
        </a>
      </div>

      <div
        className="w-full rounded-xl overflow-hidden nice-shadow bg-white"
        style={{ height: '75vh', minHeight: 480 }}
      >
        <iframe
          src={embedUrl}
          className="w-full h-full border-0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
        />
      </div>
    </div>
  )
}

export default ResourceActivity
