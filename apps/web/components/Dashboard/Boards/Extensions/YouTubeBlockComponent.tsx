'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import { GripVertical, Play, Link as LinkIcon } from 'lucide-react'
import NodeActions from './NodeActions'
import { useBoardYdoc } from '../BoardYjsContext'
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
      <NodeViewWrapper
        as="div"
        className={`absolute group rounded-xl nice-shadow bg-white ${
          selected ? 'ring-2 ring-blue-400' : ''
        }`}
        style={{ left: x, top: y, width, minHeight: 160 }}
      >
        <NodeActions selected={selected} deleteNode={deleteNode} editor={editor} getPos={getPos} />
        <div
          onMouseDown={handleDragStart}
          className="flex items-center justify-center h-6 cursor-grab active:cursor-grabbing bg-gray-50/80 border-b border-gray-100"
        >
          <GripVertical size={12} className="text-gray-400" />
        </div>
        <div className="p-5 flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center">
            <Play size={18} className="text-red-500 ml-0.5" />
          </div>
          <p className="text-xs font-medium text-neutral-500">Paste a YouTube URL</p>
          <div className="flex items-center gap-2 w-full">
            <div className="flex-1 flex items-center gap-1.5 bg-neutral-100 rounded-lg px-2.5 py-1.5">
              <LinkIcon size={12} className="text-neutral-400 shrink-0" />
              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleUrlSubmit()}
                placeholder="https://youtube.com/watch?v=..."
                className="flex-1 text-xs bg-transparent outline-none text-neutral-700 placeholder:text-neutral-400"
              />
            </div>
            <button
              onClick={handleUrlSubmit}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-neutral-900 text-white hover:bg-neutral-700 transition-colors"
            >
              Add
            </button>
          </div>
        </div>
      </NodeViewWrapper>
    )
  }

  // --- Video player ---
  return (
    <NodeViewWrapper
      as="div"
      ref={containerRef}
      className={`absolute group rounded-xl nice-shadow bg-black ${
        selected ? 'ring-2 ring-blue-400' : ''
      }`}
      style={{ left: x, top: y, width, height }}
    >
      <NodeActions selected={selected} deleteNode={deleteNode} editor={editor} getPos={getPos} />
      {/* Drag handle */}
      <div
        onMouseDown={handleDragStart}
        className="flex items-center justify-center h-6 cursor-grab active:cursor-grabbing bg-neutral-900/80 opacity-0 group-hover:opacity-100 transition-opacity rounded-t-xl"
      >
        <GripVertical size={12} className="text-neutral-400" />
      </div>

      {/* YouTube player */}
      <div className="overflow-hidden rounded-b-xl" style={{ width: '100%', height: height - 24, overscrollBehavior: 'contain' }}>
        <div id={playerDivId.current} style={{ width: '100%', height: '100%' }} />
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={handleResizeStart}
        className="absolute bottom-0 right-0 w-5 h-5 cursor-se-resize opacity-0 group-hover:opacity-100 transition-opacity z-10"
      >
        <svg viewBox="0 0 16 16" className="w-full h-full text-white/40">
          <path d="M14 14L14 8M14 14L8 14" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </div>
    </NodeViewWrapper>
  )
}
