'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { ArrowLeft, Share2, Check, Copy, ZoomIn, ZoomOut } from 'lucide-react'
import type { HocuspocusProvider } from '@hocuspocus/provider'
import PresenceAvatars from './PresenceAvatars'
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'
import { getUriWithOrg } from '@services/config/config'

interface BoardTopBarProps {
  boardName: string
  orgslug: string
  provider: HocuspocusProvider
  zoom: number
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
}

export default function BoardTopBar({
  boardName,
  orgslug,
  provider,
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomReset,
}: BoardTopBarProps) {
  const [showShare, setShowShare] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="absolute top-4 left-4 right-4 z-20 flex items-center justify-between pointer-events-none">
      {/* Left group: back + logo + title + share */}
      <div
        className="flex items-center gap-2 rounded-xl px-2.5 py-2 nice-shadow pointer-events-auto"
        style={{
          background: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      >
        <ToolTip content="Back to boards">
          <Link href={getUriWithOrg(orgslug, '/boards')}>
            <div className="editor-tool-btn">
              <ArrowLeft size={15} />
            </div>
          </Link>
        </ToolTip>

        <Link href={getUriWithOrg(orgslug, '/boards')}>
          <div className="bg-black rounded-md w-[25px] h-[25px] flex items-center justify-center hover:opacity-80 transition-opacity">
            <Image
              src="/lrn.svg"
              alt="LearnHouse"
              width={14}
              height={14}
              className="invert"
            />
          </div>
        </Link>

        <span className="text-sm font-bold text-neutral-800 truncate max-w-[220px]">
          {boardName}
        </span>

        <div className="relative">
          <ToolTip content="Share board">
            <div
              onClick={() => setShowShare(!showShare)}
              className="editor-tool-btn"
            >
              <Share2 size={15} />
            </div>
          </ToolTip>

          {showShare && (
            <div
              className="absolute top-full left-0 mt-2 w-64 rounded-xl p-3 nice-shadow"
              style={{
                background: 'rgba(255, 255, 255, 0.98)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
              }}
            >
              <p className="text-xs font-semibold text-neutral-700 mb-2">Share this board</p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={typeof window !== 'undefined' ? window.location.href : ''}
                  className="flex-1 text-xs bg-neutral-100 rounded-lg px-2.5 py-1.5 text-neutral-600 outline-none truncate"
                />
                <button
                  onClick={handleCopyLink}
                  className="flex items-center justify-center w-8 h-8 rounded-lg bg-neutral-900 text-white hover:bg-neutral-700 transition-colors shrink-0"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Center: presence avatars */}
      <div className="absolute left-1/2 -translate-x-1/2 pointer-events-auto">
        <PresenceAvatars provider={provider} />
      </div>

      {/* Right group: zoom controls */}
      <div
        className="flex items-center gap-[7px] rounded-xl px-2.5 py-2 nice-shadow pointer-events-auto"
        style={{
          background: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      >
        <ToolTip content="Zoom out">
          <div onClick={onZoomOut} className="editor-tool-btn">
            <ZoomOut size={15} />
          </div>
        </ToolTip>
        <div
          onClick={onZoomReset}
          className="editor-tool-btn cursor-pointer"
          style={{ minWidth: 40, fontSize: 11, fontWeight: 700 }}
        >
          {Math.round(zoom * 100)}%
        </div>
        <ToolTip content="Zoom in">
          <div onClick={onZoomIn} className="editor-tool-btn">
            <ZoomIn size={15} />
          </div>
        </ToolTip>
      </div>
    </div>
  )
}
