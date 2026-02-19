'use client'

import React, { useCallback, useRef, useState } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import { GripVertical, Globe, Link as LinkIcon, ExternalLink, RotateCw } from 'lucide-react'
import NodeActions from './NodeActions'
import { useDragResize } from './useDragResize'

function normalizeUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '')
  } catch {
    return url
  }
}

const HEADER_HEIGHT = 32

export default function WebpageBlockComponent({ node, updateAttributes, selected, deleteNode, editor, getPos }: any) {
  const { url, title, x, y, width, height } = node.attrs
  const [urlInput, setUrlInput] = useState('')
  const [loading, setLoading] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const { handleDragStart, handleResizeStart } = useDragResize({
    x, y, width, height,
    minWidth: 320, minHeight: 240,
    updateAttributes,
  })

  const stopWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation()
  }, [])

  const handleUrlSubmit = () => {
    const normalized = normalizeUrl(urlInput)
    if (normalized) {
      const domain = extractDomain(normalized)
      updateAttributes({ url: normalized, title: domain })
      setUrlInput('')
    }
  }

  const handleReload = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (iframeRef.current) {
      setLoading(true)
      iframeRef.current.src = url
    }
  }

  // --- No URL set: show input ---
  if (!url) {
    return (
      <NodeViewWrapper
        as="div"
        onWheel={stopWheel}
        className={`absolute group rounded-xl nice-shadow bg-white ${
          selected ? 'ring-2 ring-blue-400' : ''
        }`}
        style={{ left: x, top: y, width, minHeight: 180 }}
      >
        <NodeActions selected={selected} deleteNode={deleteNode} editor={editor} getPos={getPos} />
        <div
          onMouseDown={handleDragStart}
          className="flex items-center justify-center h-6 cursor-grab active:cursor-grabbing bg-gray-50/80 border-b border-gray-100 rounded-t-xl"
        >
          <GripVertical size={12} className="text-gray-400" />
        </div>
        <div className="p-5 flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center">
            <Globe size={18} className="text-blue-500" />
          </div>
          <p className="text-xs font-medium text-neutral-500">Embed a webpage</p>
          <div className="flex items-center gap-2 w-full">
            <div className="flex-1 flex items-center gap-1.5 bg-neutral-100 rounded-lg px-2.5 py-1.5">
              <LinkIcon size={12} className="text-neutral-400 shrink-0" />
              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleUrlSubmit()}
                placeholder="https://example.com"
                className="flex-1 text-xs bg-transparent outline-none text-neutral-700 placeholder:text-neutral-400"
              />
            </div>
            <button
              onClick={handleUrlSubmit}
              disabled={!urlInput.trim()}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-neutral-900 text-white hover:bg-neutral-700 transition-colors disabled:opacity-40"
            >
              Add
            </button>
          </div>
          <p className="text-[10px] text-neutral-400">Some sites may block embedding</p>
        </div>
      </NodeViewWrapper>
    )
  }

  // --- URL set: render iframe ---
  return (
    <NodeViewWrapper
      as="div"
      onWheel={stopWheel}
      className={`absolute group rounded-xl nice-shadow bg-white ${
        selected ? 'ring-2 ring-blue-400' : ''
      }`}
      style={{ left: x, top: y, width, height }}
    >
      <NodeActions selected={selected} deleteNode={deleteNode} editor={editor} getPos={getPos} />

      {/* Drag handle + header */}
      <div
        onMouseDown={handleDragStart}
        className="flex items-center gap-2 h-8 cursor-grab active:cursor-grabbing bg-gray-50/90 border-b border-gray-100 rounded-t-xl px-2"
      >
        <GripVertical size={12} className="text-gray-400 shrink-0" />
        <Globe size={11} className="text-neutral-400 shrink-0" />
        <span className="text-[11px] font-medium text-neutral-600 truncate flex-1">
          {title || extractDomain(url)}
        </span>
        <button
          onMouseDown={handleReload}
          className="text-neutral-400 hover:text-neutral-600 transition-colors shrink-0"
          title="Reload"
        >
          <RotateCw size={11} />
        </button>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onMouseDown={(e) => e.stopPropagation()}
          className="text-neutral-400 hover:text-neutral-600 transition-colors shrink-0"
          title="Open in new tab"
        >
          <ExternalLink size={11} />
        </a>
      </div>

      {/* Webpage content */}
      <div
        className="bg-white overflow-hidden rounded-b-xl relative"
        style={{ height: height - HEADER_HEIGHT, overscrollBehavior: 'contain' }}
      >
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10">
            <div className="relative w-5 h-5">
              <div className="absolute top-0 left-0 w-full h-full border-2 border-gray-100 rounded-full"></div>
              <div className="absolute top-0 left-0 w-full h-full border-2 border-gray-400 rounded-full animate-spin border-t-transparent"></div>
            </div>
          </div>
        )}
        <iframe
          ref={iframeRef}
          src={url}
          className="w-full h-full bg-white block"
          style={{ border: 'none', overscrollBehavior: 'contain' }}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          onLoad={() => {
            setLoading(false)
            // Prevent iframe from stealing focus and scrolling the board
            iframeRef.current?.blur()
          }}
          tabIndex={-1}
          title={title || 'Webpage'}
        />
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={handleResizeStart}
        className="absolute bottom-0 right-0 w-5 h-5 cursor-se-resize opacity-0 group-hover:opacity-100 transition-opacity z-10"
      >
        <svg viewBox="0 0 16 16" className="w-full h-full text-neutral-300">
          <path d="M14 14L14 8M14 14L8 14" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </div>
    </NodeViewWrapper>
  )
}
