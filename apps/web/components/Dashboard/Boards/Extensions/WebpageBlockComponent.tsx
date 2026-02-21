'use client'

import React, { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Globe, Link as LinkIcon, ExternalLink, RotateCw } from 'lucide-react'
import BoardBlockWrapper from './BoardBlockWrapper'
import DragHandle from './DragHandle'
import ResizeHandle from './ResizeHandle'
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
  const { t } = useTranslation()
  const { url, title, x, y, width, height } = node.attrs
  const [urlInput, setUrlInput] = useState('')
  const [loading, setLoading] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const { handleDragStart, handleResizeStart } = useDragResize({
    x, y, width, height,
    minWidth: 320, minHeight: 240,
    updateAttributes,
    editor,
    getPos,
  })

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
      <BoardBlockWrapper
        selected={selected} deleteNode={deleteNode} editor={editor} getPos={getPos}
        x={x} y={y} width={width} stopWheel
        style={{ minHeight: 180 }}
      >
        <DragHandle onMouseDown={handleDragStart} className="bg-gray-50/80 border-b border-gray-100 rounded-t-xl" />
        <div className="p-5 flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center">
            <Globe size={18} className="text-blue-500" />
          </div>
          <p className="text-xs font-medium text-neutral-500">{t('boards.webpage_block.embed_webpage')}</p>
          <div className="flex items-center gap-2 w-full">
            <div className="flex-1 flex items-center gap-1.5 bg-neutral-100 rounded-lg px-2.5 py-1.5">
              <LinkIcon size={12} className="text-neutral-400 shrink-0" />
              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleUrlSubmit()}
                placeholder={t('boards.webpage_block.url_placeholder')}
                className="flex-1 text-xs bg-transparent outline-none text-neutral-700 placeholder:text-neutral-400"
              />
            </div>
            <button
              onClick={handleUrlSubmit}
              disabled={!urlInput.trim()}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-neutral-900 text-white hover:bg-neutral-700 transition-colors disabled:opacity-40"
            >
              {t('boards.webpage_block.add')}
            </button>
          </div>
          <p className="text-[10px] text-neutral-400">{t('boards.webpage_block.blocking_notice')}</p>
        </div>
      </BoardBlockWrapper>
    )
  }

  // --- URL set: render iframe ---
  return (
    <BoardBlockWrapper
      selected={selected} deleteNode={deleteNode} editor={editor} getPos={getPos}
      x={x} y={y} width={width} height={height} stopWheel
    >
      {/* Drag handle + header */}
      <DragHandle
        onMouseDown={handleDragStart}
        height="h-8"
        className="bg-gray-50/90 border-b border-gray-100 rounded-t-xl"
      >
        <Globe size={11} className="text-neutral-400 shrink-0" />
        <span className="text-[11px] font-medium text-neutral-600 truncate flex-1">
          {title || extractDomain(url)}
        </span>
        <button
          onMouseDown={handleReload}
          className="text-neutral-400 hover:text-neutral-600 transition-colors shrink-0"
          title={t('boards.webpage_block.reload')}
        >
          <RotateCw size={11} />
        </button>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onMouseDown={(e) => e.stopPropagation()}
          className="text-neutral-400 hover:text-neutral-600 transition-colors shrink-0"
          title={t('boards.webpage_block.open_in_new_tab')}
        >
          <ExternalLink size={11} />
        </a>
      </DragHandle>

      {/* Webpage content */}
      <div
        className="bg-white overflow-hidden rounded-b-xl relative"
        style={{ height: height - HEADER_HEIGHT, overscrollBehavior: 'contain', pointerEvents: selected ? 'auto' : 'none' }}
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

      <ResizeHandle onMouseDown={handleResizeStart} color="text-neutral-300" selected={selected} />
    </BoardBlockWrapper>
  )
}
