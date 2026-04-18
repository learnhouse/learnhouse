'use client'

import React from 'react'
import Link from 'next/link'
import { Globe, Lock, Users, Pencil } from 'lucide-react'
import { Cube } from '@phosphor-icons/react'
import { Playground } from '@services/playgrounds/playgrounds'
import { getPlaygroundThumbnailMediaDirectory } from '@services/media/media'

interface PlaygroundCardProps {
  playground: Playground
  orgslug: string
  canEdit?: boolean
}

const accessConfig = {
  public: { icon: Globe, label: 'Public', className: 'bg-green-100 text-green-700' },
  authenticated: { icon: Lock, label: 'Members', className: 'bg-blue-100 text-blue-700' },
  restricted: { icon: Users, label: 'Restricted', className: 'bg-amber-100 text-amber-700' },
}

export default function PlaygroundCard({ playground, orgslug, canEdit }: PlaygroundCardProps) {
  const access = accessConfig[playground.access_type as keyof typeof accessConfig] || accessConfig.authenticated
  const AccessIcon = access.icon

  const thumbnailUrl =
    playground.thumbnail_image && playground.org_uuid
      ? getPlaygroundThumbnailMediaDirectory(
          playground.org_uuid,
          playground.playground_uuid,
          playground.thumbnail_image
        )
      : null

  const playgroundLink = `/playground/${playground.playground_uuid}`
  const editLink = `/editor/playground/${playground.playground_uuid}/edit`

  return (
    <div className="group relative flex flex-col bg-white rounded-xl nice-shadow overflow-hidden w-full transition-all duration-300 hover:scale-[1.01]">
      {/* Edit button — top right, appears on hover */}
      {canEdit && (
        <div className="absolute top-2 end-2 z-20 opacity-0 group-hover:opacity-100 transition-opacity">
          <Link
            href={editLink}
            className="p-1.5 bg-white/90 backdrop-blur-sm rounded-full hover:bg-white transition-all shadow-md flex items-center justify-center"
          >
            <Pencil className="w-3.5 h-3.5 text-gray-700" />
          </Link>
        </div>
      )}

      {/* Thumbnail */}
      <Link href={playgroundLink} className="block relative aspect-video overflow-hidden bg-gray-50">
        {thumbnailUrl ? (
          <div
            className="w-full h-full bg-cover bg-center transition-transform duration-500 group-hover:scale-105"
            style={{ backgroundImage: `url(${thumbnailUrl})` }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 transition-transform duration-500 group-hover:scale-105">
            <Cube size={36} className="text-gray-300" />
          </div>
        )}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors duration-300" />

        {/* Badges — bottom left */}
        <div className="absolute bottom-2 start-2 flex items-center gap-1.5">
          <span className={`flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide rounded-full ${access.className}`}>
            <AccessIcon className="w-2.5 h-2.5" />
            {access.label}
          </span>
          {!playground.published && (
            <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-yellow-100 text-yellow-700 rounded-full">
              Draft
            </span>
          )}
        </div>
      </Link>

      {/* Content */}
      <div className="p-3 flex flex-col space-y-1.5">
        <Link
          href={playgroundLink}
          className="text-base font-bold text-gray-900 leading-tight hover:text-black transition-colors line-clamp-1"
        >
          {playground.name}
        </Link>

        {playground.description && (
          <p className="text-[11px] text-gray-500 line-clamp-2 min-h-[1.5rem]">
            {playground.description}
          </p>
        )}

        <div className="pt-1.5 flex items-center justify-end border-t border-gray-100">
          <Link
            href={playgroundLink}
            className="text-[10px] font-bold text-gray-400 hover:text-gray-900 transition-colors uppercase tracking-wider"
          >
            Open Playground →
          </Link>
        </div>
      </div>
    </div>
  )
}
