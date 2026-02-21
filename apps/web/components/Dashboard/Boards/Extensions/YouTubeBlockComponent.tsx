'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Play, Link as LinkIcon } from 'lucide-react'
import { useBoardYdoc } from '../BoardYjsContext'
import BoardBlockWrapper from './BoardBlockWrapper'
import DragHandle from './DragHandle'
import ResizeHandle from './ResizeHandle'
import { useDragResize } from './useDragResize'

// Extend window for YT API
declare global {
  interface Window {
    YT: any
    onYouTubeIframeAPIReady: (() => void) | undefined
  }
}

// Load YouTube IFrame API once
let ytApiLoading = false
let ytApiReady = false
const ytApiCallbacks: (() => void)[] = []

function loadYTApi(): Promise<void> {
  if (ytApiReady) return Promise.resolve()
  return new Promise((resolve) => {
    ytApiCallbacks.push(resolve)
    if (ytApiLoading) return
    ytApiLoading = true
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      prev?.()
      ytApiReady = true
      ytApiCallbacks.forEach((cb) => cb())
      ytApiCallbacks.length = 0
    }
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(script)
  })
}

function extractVideoId(input: string): string | null {
  if (!input) return null
  // Already a video ID (11 chars, no special chars)
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input
  try {
    const url = new URL(input)
    if (url.hostname.includes('youtu.be')) return url.pathname.slice(1).split('/')[0] || null
    if (url.hostname.includes('youtube.com')) return url.searchParams.get('v')
  } catch {
    // Not a valid URL
  }
  return null
}

export default function YouTubeBlockComponent({ node, updateAttributes, selected, deleteNode, editor, getPos }: any) {
  const { t } = useTranslation()
  const { videoId, x, y, width, height } = node.attrs
  const [urlInput, setUrlInput] = useState('')
  const isSyncingRef = useRef(false)
  const playerRef = useRef<any>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const playerDivId = useRef(`yt-player-${Math.random().toString(36).slice(2, 10)}`)

  // --- Yjs sync ---
  const ydoc = useBoardYdoc()
  const syncMapRef = useRef<any>(null)

  useEffect(() => {
    if (!ydoc || !videoId) return
    const syncMap = ydoc.getMap('youtube-sync')
    syncMapRef.current = syncMap

    const observer = () => {
      if (isSyncingRef.current) return
      const state = syncMap.get(videoId)
      if (!state || !playerRef.current) return

      const player = playerRef.current
      if (typeof player.getPlayerState !== 'function') return

      const { playing, time, updatedAt } = state
      const now = Date.now()
      const elapsed = (now - updatedAt) / 1000

      isSyncingRef.current = true
      if (playing) {
        const targetTime = time + elapsed
        const currentTime = player.getCurrentTime?.() ?? 0
        // Only seek if drift > 2s
        if (Math.abs(currentTime - targetTime) > 2) {
          player.seekTo(targetTime, true)
        }
        if (player.getPlayerState() !== 1) {
          player.playVideo()
        }
      } else {
        if (player.getPlayerState() === 1) {
          player.pauseVideo()
        }
        const currentTime = player.getCurrentTime?.() ?? 0
        if (Math.abs(currentTime - time) > 1) {
          player.seekTo(time, true)
        }
      }
      setTimeout(() => { isSyncingRef.current = false }, 300)
    }

    syncMap.observe(observer)
    // Apply initial state
    observer()

    return () => {
      syncMap.unobserve(observer)
    }
  }, [ydoc, videoId])

  // Broadcast state change
  const broadcastState = useCallback((playing: boolean, time: number) => {
    if (!syncMapRef.current || !videoId) return
    isSyncingRef.current = true
    syncMapRef.current.set(videoId, {
      playing,
      time,
      updatedAt: Date.now(),
    })
    setTimeout(() => { isSyncingRef.current = false }, 300)
  }, [videoId])

  // --- YouTube Player ---
  useEffect(() => {
    if (!videoId) return

    let player: any = null

    loadYTApi().then(() => {
      if (!containerRef.current) return
      // Ensure the div exists
      const el = document.getElementById(playerDivId.current)
      if (!el) return

      player = new window.YT.Player(playerDivId.current, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: {
          autoplay: 0,
          controls: 1,
          modestbranding: 1,
          rel: 0,
        },
        events: {
          onStateChange: (event: any) => {
            if (isSyncingRef.current) return
            const state = event.data
            const time = event.target.getCurrentTime?.() ?? 0
            if (state === 1) {
              // Playing
              broadcastState(true, time)
            } else if (state === 2) {
              // Paused
              broadcastState(false, time)
            }
          },
        },
      })
      playerRef.current = player
    })

    return () => {
      if (player?.destroy) {
        player.destroy()
      }
      playerRef.current = null
    }
  }, [videoId])

  // --- Drag & Resize (smooth, commit on mouseUp only) ---
  const { handleDragStart, handleResizeStart } = useDragResize({
    x, y, width, height,
    minWidth: 280, minHeight: 158,
    updateAttributes,
    editor,
    getPos,
  })

  // --- URL Submit ---
  const handleUrlSubmit = () => {
    const id = extractVideoId(urlInput.trim())
    if (id) {
      updateAttributes({ videoId: id })
      setUrlInput('')
    }
  }

  // --- No video yet: show URL input ---
  if (!videoId) {
    return (
      <BoardBlockWrapper
        selected={selected} deleteNode={deleteNode} editor={editor} getPos={getPos}
        x={x} y={y} width={width}
        styled={false}
        className="rounded-2xl nice-shadow"
        style={{ minHeight: 160, backgroundColor: '#18181b' }}
      >
        <DragHandle onMouseDown={handleDragStart} dark />

        {/* Header */}
        <div className="flex items-center px-4 pt-4 pb-0.5">
          <div className="flex items-center gap-1">
            <Play size={11} className="text-neutral-500" />
            <span className="text-[9px] font-semibold tracking-wider uppercase select-none text-neutral-500">
              YouTube
            </span>
          </div>
        </div>

        {/* URL input */}
        <div className="px-4 pt-3 pb-4 flex flex-col gap-2">
          <p className="text-xs font-medium text-neutral-500">{t('boards.youtube_block.paste_url')}</p>
          <div className="flex items-center gap-2 w-full">
            <div className="flex-1 flex items-center gap-1.5 bg-neutral-800 rounded-lg px-2.5 py-1.5">
              <LinkIcon size={12} className="text-neutral-500 shrink-0" />
              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleUrlSubmit()}
                placeholder={t('boards.youtube_block.url_placeholder')}
                className="flex-1 text-xs bg-transparent outline-none text-neutral-300 placeholder:text-neutral-600"
              />
            </div>
            <button
              onClick={handleUrlSubmit}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-500 transition-colors"
            >
              {t('boards.youtube_block.add')}
            </button>
          </div>
        </div>
      </BoardBlockWrapper>
    )
  }

  // --- Video player ---
  return (
    <BoardBlockWrapper
      ref={containerRef}
      selected={selected} deleteNode={deleteNode} editor={editor} getPos={getPos}
      x={x} y={y} width={width} height={height}
      styled={false}
      className="rounded-2xl nice-shadow"
      style={{ backgroundColor: '#18181b' }}
    >
      <DragHandle onMouseDown={handleDragStart} dark />

      {/* YouTube player — full block */}
      <div
        className="overflow-hidden rounded-2xl"
        style={{ width: '100%', height: '100%', overscrollBehavior: 'contain', pointerEvents: selected ? 'auto' : 'none' }}
      >
        <div id={playerDivId.current} style={{ width: '100%', height: '100%' }} />
      </div>

      <ResizeHandle onMouseDown={handleResizeStart} selected={selected} dark />
    </BoardBlockWrapper>
  )
}
