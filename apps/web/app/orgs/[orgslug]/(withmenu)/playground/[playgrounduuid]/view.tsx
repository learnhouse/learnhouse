'use client'

import React, { useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import {
  ArrowsOutSimple,
  ArrowsInSimple,
  PencilSimple,
  Sparkle,
  CalendarBlank,
  Globe,
  Lock,
  Users,
  DownloadSimple,
} from '@phosphor-icons/react'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import { PlaygroundReactionButton } from '@components/Playground/PlaygroundReactionButton'
import UserAvatar from '@components/Objects/UserAvatar'
import { Playground } from '@services/playgrounds/playgrounds'
import { getPlaygroundThumbnailMediaDirectory, getUserAvatarMediaDirectory } from '@services/media/media'

dayjs.extend(relativeTime)

interface PlaygroundViewClientProps {
  playground: Playground
  orgslug: string
  canEdit: boolean
}

const ACCESS_BADGES = {
  public: { icon: Globe, label: 'Public', className: 'bg-green-50 text-green-700' },
  authenticated: { icon: Users, label: 'Members', className: 'bg-blue-50 text-blue-700' },
  restricted: { icon: Lock, label: 'Restricted', className: 'bg-amber-50 text-amber-700' },
}

export default function PlaygroundViewClient({
  playground,
  canEdit,
}: PlaygroundViewClientProps) {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const iframeContainerRef = useRef<HTMLDivElement>(null)

  const thumbnailUrl =
    playground.thumbnail_image && playground.org_uuid
      ? getPlaygroundThumbnailMediaDirectory(
          playground.org_uuid,
          playground.playground_uuid,
          playground.thumbnail_image
        )
      : null

  const handleDownload = useCallback(() => {
    const html = playground.html_content || ''
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${playground.name || 'playground'}.html`
    a.click()
    URL.revokeObjectURL(url)
  }, [playground.html_content, playground.name])

  const toggleFullscreen = useCallback(async () => {
    if (!isFullscreen) {
      await iframeContainerRef.current?.requestFullscreen?.()
    } else {
      await document.exitFullscreen?.()
    }
  }, [isFullscreen])

  React.useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  const accessBadge = ACCESS_BADGES[playground.access_type] ?? ACCESS_BADGES.authenticated
  const AccessIcon = accessBadge.icon
  const createdDate = dayjs(playground.creation_date).format('MMM D, YYYY')

  const authorName = playground.author_first_name
    ? `${playground.author_first_name}${playground.author_last_name ? ` ${playground.author_last_name}` : ''}`
    : playground.author_username ?? null

  const authorAvatarUrl =
    playground.author_user_uuid && playground.author_avatar_image
      ? getUserAvatarMediaDirectory(playground.author_user_uuid, playground.author_avatar_image)
      : null

  return (
    <GeneralWrapperStyled>
      {/* Breadcrumbs */}
      <div className="pb-4">
        <Breadcrumbs
          items={[
            { label: 'Playgrounds', href: '/playgrounds', icon: <Sparkle size={14} /> },
            { label: playground.name },
          ]}
        />
      </div>

      <div className="flex flex-col md:flex-row gap-5 pt-2">

        {/* ── Left Sidebar — 220px ── */}
        <div className="hidden md:block w-56 flex-shrink-0">
          <div className="sticky top-24 space-y-3">

            {/* Thumbnail */}
            {thumbnailUrl && (
              <div className="bg-white nice-shadow rounded-lg overflow-hidden">
                <img
                  src={thumbnailUrl}
                  alt={playground.name}
                  className="w-full aspect-video object-cover"
                />
              </div>
            )}

            {/* Info card */}
            <div className="bg-white nice-shadow rounded-lg overflow-hidden">
              <div className="p-3 border-b border-gray-100">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">About</p>
                <h1 className="text-sm font-bold text-gray-900 leading-snug">
                  {playground.name}
                </h1>
                {playground.description && (
                  <p className="text-xs text-gray-500 mt-1 leading-relaxed line-clamp-4">
                    {playground.description}
                  </p>
                )}
              </div>

              <div className="px-3 py-2.5 space-y-2">
                {authorName && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-gray-500">Author</span>
                    <span className="flex items-center gap-1.5 text-xs text-gray-700 font-medium">
                      <UserAvatar
                        width={16}
                        rounded="rounded-full"
                        avatar_url={authorAvatarUrl ?? undefined}
                        shadow=""
                        backgroundColor="bg-gray-100"
                      />
                      {authorName}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-500">Access</span>
                  <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold ${accessBadge.className}`}>
                    <AccessIcon size={9} />
                    {accessBadge.label}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-500">Created</span>
                  <span className="flex items-center gap-1 text-xs text-gray-700">
                    <CalendarBlank size={10} className="text-gray-400" />
                    {createdDate}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-500">Status</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                    playground.published ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {playground.published ? 'Published' : 'Draft'}
                  </span>
                </div>
              </div>

              <div className={`px-3 pb-3 ${canEdit ? 'space-y-2' : ''}`}>
                {canEdit && (
                  <Link
                    href={`/editor/playground/${playground.playground_uuid}/edit`}
                    className="flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-xs font-bold bg-neutral-100 hover:bg-neutral-200 text-neutral-600 transition-colors"
                  >
                    <PencilSimple size={11} weight="bold" />
                    Edit in Editor
                  </Link>
                )}
                <button
                  onClick={handleDownload}
                  className="flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-xs font-bold bg-neutral-100 hover:bg-neutral-200 text-neutral-600 transition-colors"
                >
                  <DownloadSimple size={11} weight="bold" />
                  Download
                </button>
              </div>
            </div>

            {/* Reactions card */}
            <div className="bg-white nice-shadow rounded-lg p-3">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2.5">
                Reactions
              </p>
              <PlaygroundReactionButton playgroundUuid={playground.playground_uuid} />
            </div>
          </div>
        </div>

        {/* ── Main content ── */}
        <div className="flex-1 min-w-0">
          <div
            ref={iframeContainerRef}
            className="relative bg-white nice-shadow rounded-lg overflow-hidden"
            style={{ height: 'calc(100vh - 200px)', minHeight: 480 }}
          >
            {/* Toolbar — top right of preview */}
            <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
              <button
                onClick={handleDownload}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-white/80 backdrop-blur-sm nice-shadow text-neutral-500 hover:text-neutral-800 transition-colors"
              >
                <DownloadSimple size={13} weight="bold" />
                Download
              </button>
              <button
                onClick={toggleFullscreen}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-white/80 backdrop-blur-sm nice-shadow text-neutral-500 hover:text-neutral-800 transition-colors"
              >
                {isFullscreen
                  ? <><ArrowsInSimple size={13} weight="bold" />Exit</>
                  : <><ArrowsOutSimple size={13} weight="bold" />Fullscreen</>
                }
              </button>
            </div>

            {/* Iframe / empty state */}
            {playground.html_content ? (
              <iframe
                srcDoc={playground.html_content}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                className="w-full h-full border-0"
                title={playground.name}
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-center px-6">
                <div className="w-14 h-14 rounded-2xl bg-white nice-shadow flex items-center justify-center mb-4">
                  <Sparkle size={24} weight="fill" className="text-gray-300" />
                </div>
                <p className="text-base font-semibold text-gray-500">No content yet</p>
                <p className="text-sm text-gray-400 mt-1">
                  {canEdit ? 'Open the editor to generate content.' : 'Check back later.'}
                </p>
                {canEdit && (
                  <Link
                    href={`/editor/playground/${playground.playground_uuid}/edit`}
                    className="mt-4 flex items-center gap-1.5 px-4 py-2 bg-black text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors"
                  >
                    <PencilSimple size={14} weight="bold" />
                    Open Editor
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </GeneralWrapperStyled>
  )
}
