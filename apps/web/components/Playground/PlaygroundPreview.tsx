'use client'

import React, { useEffect, useRef, useCallback } from 'react'
import { ArrowsOutSimple, ArrowsInSimple, CircleNotch } from '@phosphor-icons/react'

interface PlaygroundPreviewProps {
  html: string | null
  isStreaming?: boolean
  isFullscreen?: boolean
  onToggleFullscreen?: () => void
}

export default function PlaygroundPreview({
  html,
  isStreaming,
  isFullscreen,
  onToggleFullscreen,
}: PlaygroundPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const lastRenderedRef = useRef<string | null>(null)
  const writeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Write HTML directly into the iframe document (no reload, no flicker)
  const writeToIframe = useCallback((content: string) => {
    const iframe = iframeRef.current
    if (!iframe) return
    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document
      if (!doc) return
      doc.open()
      doc.write(content)
      doc.close()
    } catch {
      // cross-origin fallback — shouldn't happen with srcdoc
      iframe.srcdoc = content
    }
  }, [])

  useEffect(() => {
    if (!html) {
      if (iframeRef.current) iframeRef.current.srcdoc = ''
      lastRenderedRef.current = null
      return
    }

    if (isStreaming) {
      // Throttle live writes to ~every 300ms so the iframe doesn't thrash
      if (writeTimeoutRef.current) clearTimeout(writeTimeoutRef.current)
      writeTimeoutRef.current = setTimeout(() => {
        if (html !== lastRenderedRef.current) {
          lastRenderedRef.current = html
          writeToIframe(html)
        }
      }, 300)
    } else {
      // Final render — write immediately
      if (writeTimeoutRef.current) clearTimeout(writeTimeoutRef.current)
      if (html !== lastRenderedRef.current) {
        lastRenderedRef.current = html
        writeToIframe(html)
      }
    }

    return () => {
      if (writeTimeoutRef.current) clearTimeout(writeTimeoutRef.current)
    }
  }, [html, isStreaming, writeToIframe])

  return (
    <div className="flex-1 relative bg-gray-50/50">
      {/* Empty state */}
      {!html && !isStreaming && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center text-gray-400">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-white nice-shadow flex items-center justify-center">
              <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-gray-500">Live Preview</p>
            <p className="text-xs text-gray-400 mt-1">Your generated content will appear here</p>
          </div>
        </div>
      )}

      {/* Streaming indicator — top left */}
      {isStreaming && (
        <div className="absolute top-3 start-3 z-10 flex items-center gap-1.5 px-2.5 py-1.5 bg-black/75 backdrop-blur-sm rounded-full nice-shadow">
          <CircleNotch size={11} weight="bold" className="animate-spin text-sky-400" />
          <span className="text-[11px] text-white font-bold">Generating…</span>
        </div>
      )}

      {/* Fullscreen toggle — top right */}
      {onToggleFullscreen && (
        <button
          onClick={onToggleFullscreen}
          title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen preview'}
          className="absolute top-3 end-3 z-10 flex items-center justify-center w-8 h-8 bg-black/60 hover:bg-black/80 backdrop-blur-sm rounded-lg nice-shadow transition-all"
        >
          {isFullscreen
            ? <ArrowsInSimple size={14} weight="bold" className="text-white" />
            : <ArrowsOutSimple size={14} weight="bold" className="text-white" />
          }
        </button>
      )}

      {/* iframe — always mounted so writes take effect */}
      <iframe
        ref={iframeRef}
        className="w-full h-full border-0"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        title="Playground Preview"
      />
    </div>
  )
}
