'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { WarningCircle, SquaresFour, Microphone, UsersThree, Code, GraduationCap, ArrowSquareOut } from '@phosphor-icons/react'
import { buildEmbedUrl, buildResourceUrl, type ResourceKind } from '@/lib/library/resourceEmbed'

const KIND_META: Partial<Record<ResourceKind, { labelKey: string; icon: any; color: string }>> = {
  course: { labelKey: 'activities.resource.kind_course', icon: GraduationCap, color: 'text-blue-500' },
  podcast: { labelKey: 'activities.resource.kind_podcast', icon: Microphone, color: 'text-violet-500' },
  community: { labelKey: 'activities.resource.kind_community', icon: UsersThree, color: 'text-emerald-500' },
  board: { labelKey: 'activities.resource.kind_board', icon: SquaresFour, color: 'text-indigo-500' },
  playground: { labelKey: 'activities.resource.kind_playground', icon: Code, color: 'text-amber-500' },
}

interface ResourceActivityProps {
  activity: any
  orgslug: string
  style?: React.CSSProperties
}

function ResourceActivity({ activity, orgslug, style }: ResourceActivityProps) {
  const { t } = useTranslation()
  const kind = (activity.content?.resource_type || '') as ResourceKind
  const resourceUuid = activity.content?.resource_uuid || ''
  const meta = KIND_META[kind]
  const baseUrl = meta ? buildResourceUrl(kind, resourceUuid, orgslug) : null

  if (!meta || !baseUrl) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <WarningCircle size={40} className="text-red-400" />
        <p className="text-sm text-gray-600">{t('activities.resource.no_resource')}</p>
      </div>
    )
  }

  const Icon = meta.icon
  const embedUrl = buildEmbedUrl(kind, baseUrl)

  return (
    <div className="w-full px-6 py-6" style={style}>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon size={20} weight="duotone" className={`${meta.color} flex-shrink-0`} />
          <span className="text-sm font-medium text-gray-600">{t(meta.labelKey)}</span>
        </div>
        <a
          href={baseUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-800 transition-colors"
        >
          <ArrowSquareOut size={14} />
          {t('activities.resource.open')}
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
