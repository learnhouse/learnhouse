'use client'

import React, { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Globe, Link as LinkIcon, ExternalLink, RotateCw, X, Pencil } from 'lucide-react'
import BoardBlockWrapper from './BoardBlockWrapper'
import DragHandle from './DragHandle'
import ResizeHandle from './ResizeHandle'
import { useDragResize } from './useDragResize'
import { useBoardSelection } from '../BoardSelectionContext'

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

/* ── Browser illustration SVG ────────────────────────────── */

function BrowserIllustration() {
  return (
    <svg width="64" height="48" viewBox="0 0 64 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="4" width="56" height="40" rx="6" fill="white" stroke="#bfdbfe" strokeWidth="1.5" />
      <rect x="4" y="4" width="56" height="12" rx="6" fill="#eff6ff" />
      <rect x="4" y="10" width="56" height="6" fill="#eff6ff" />
      <circle cx="12" cy="10" r="2" fill="#fca5a5" />
      <circle cx="18" cy="10" r="2" fill="#fde68a" />
      <circle cx="24" cy="10" r="2" fill="#86efac" />
      <rect x="30" y="7.5" width="24" height="5" rx="2.5" fill="white" opacity="0.7" />
      <rect x="10" y="22" width="28" height="3" rx="1.5" fill="#dbeafe" />
      <rect x="10" y="28" width="20" height="3" rx="1.5" fill="#dbeafe" opacity="0.6" />
      <rect x="10" y="34" width="24" height="3" rx="1.5" fill="#dbeafe" opacity="0.4" />
      <rect x="42" y="22" width="12" height="15" rx="2" fill="#dbeafe" opacity="0.5" />
    </svg>
  )
}

export default function WebpageBlockComponent({ node, updateAttributes, selected, deleteNode, editor, getPos }: any) {
  const { t } = useTranslation()
  const { url, title, x, y, width, height } = node.attrs
  const [urlInput, setUrlInput] = useState('')
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const { isSelected: isMultiSelected } = useBoardSelection()
  const multiSelected = getPos ? isMultiSelected(getPos()) : false
  const isBlockSelected = selected || multiSelected

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
      setEditing(false)
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

  const startEditing = () => {
    setUrlInput(url || '')
    setEditing(true)
  }

  const handleRemove = () => {
    setUrlInput('')
    updateAttributes({ url: '', title: '' })
    setEditing(false)
  }

  const showWebpage = url && !editing

  /* ── Empty / editing state ─────────────────────────────── */

  if (!showWebpage) {
    return (
      <BoardBlockWrapper
        selected={selected}
        deleteNode={deleteNode}
        editor={editor}
        getPos={getPos}
        x={x}
        y={y}
        width={width}
        className="rounded-2xl flex flex-col"
        style={{ minHeight: height }}
        stopWheel
      >
        {/* Top gradient */}
        <div className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-sky-50/80 to-transparent rounded-t-2xl pointer-events-none z-0" />

        <DragHandle onMouseDown={handleDragStart} />

        {/* Header */}
        <div className="flex items-center px-4 pt-4 pb-0.5 relative z-[1]">
          <div className="flex items-center gap-1.5 flex-1">
            <div className="w-5 h-5 rounded-md bg-sky-100 flex items-center justify-center">
              <Globe size={10} className="text-sky-500" />
            </div>
            <span className="text-[9px] font-semibold tracking-wider uppercase select-none text-neutral-400">
              {t('boards.webpage_block.embed_webpage')}
            </span>
          </div>
        </div>

        {/* Centered input form */}
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-5 py-6">
          {!url && (
            <>
              <BrowserIllustration />
              <p className="text-[11px] text-neutral-400 font-medium">{t('boards.webpage_block.embed_webpage')}</p>
              <div className="w-12 h-px bg-neutral-200/80" />
            </>
          )}

          <div className="w-full flex flex-col items-center gap-2 max-w-sm">
            <div className="flex items-center gap-2 w-full">
              <div className="flex-1 flex items-center gap-1.5 bg-neutral-50 border border-neutral-200/80 rounded-lg px-2.5 py-2 focus-within:border-neutral-300 focus-within:bg-white transition-colors">
                <LinkIcon size={11} className="text-neutral-400 shrink-0" />
                <input
                  type="text"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleUrlSubmit()
                    if (e.key === 'Escape') { setEditing(false); setUrlInput('') }
                  }}
                  placeholder={t('boards.webpage_block.url_placeholder')}
                  className="flex-1 text-xs bg-transparent outline-none text-neutral-700 placeholder:text-neutral-400"
                />
              </div>
              <button
                onClick={handleUrlSubmit}
                disabled={!urlInput.trim()}
                className="px-3.5 py-2 text-[11px] font-medium rounded-lg bg-neutral-900 text-white hover:bg-neutral-700 transition-colors disabled:opacity-30 shrink-0"
              >
                {t('boards.webpage_block.add')}
              </button>
            </div>
            <p className="text-[10px] text-neutral-400">{t('boards.webpage_block.blocking_notice')}</p>
          </div>

          {editing && (
            <button
              onClick={() => setEditing(false)}
              className="text-[11px] text-neutral-400 hover:text-neutral-500 transition-colors"
            >
              Cancel
            </button>
          )}
        </div>

        <ResizeHandle onMouseDown={handleResizeStart} selected={selected} />
      </BoardBlockWrapper>
    )
  }

  /* ── Webpage loaded: full iframe ───────────────────────── */

  return (
    <BoardBlockWrapper
      selected={selected}
      deleteNode={deleteNode}
      editor={editor}
      getPos={getPos}
      x={x}
      y={y}
      width={width}
      height={height}
      className="rounded-2xl"
      stopWheel
    >
      {/* Floating toolbar — appears on hover or when selected */}
      <div className={`absolute inset-x-0 top-0 z-20 flex justify-center pt-2.5 transition-opacity pointer-events-none ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
        <div
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white/90 backdrop-blur-sm nice-shadow pointer-events-auto cursor-grab active:cursor-grabbing"
          onMouseDown={handleDragStart}
        >
          <Globe size={11} className="text-neutral-400 shrink-0" />
          <span className="text-[10px] font-medium text-neutral-500 truncate max-w-[120px]">
            {title || extractDomain(url)}
          </span>
          <div className="w-px h-3.5 bg-neutral-200 mx-0.5" />
          <button
            onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); handleReload(e) }}
            className="text-neutral-400 hover:text-neutral-600 transition-colors shrink-0 p-0.5 rounded hover:bg-neutral-100"
            title={t('boards.webpage_block.reload')}
          >
            <RotateCw size={11} />
          </button>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onMouseDown={(e) => e.stopPropagation()}
            className="text-neutral-400 hover:text-neutral-600 transition-colors shrink-0 p-0.5 rounded hover:bg-neutral-100"
            title={t('boards.webpage_block.open_in_new_tab')}
          >
            <ExternalLink size={11} />
          </a>
          <button
            onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); startEditing() }}
            className="text-neutral-400 hover:text-neutral-600 transition-colors shrink-0 p-0.5 rounded hover:bg-neutral-100"
            title="Edit URL"
          >
            <Pencil size={11} />
          </button>
          <button
            onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); handleRemove() }}
            className="text-neutral-400 hover:text-red-500 transition-colors shrink-0 p-0.5 rounded hover:bg-neutral-100"
            title="Remove"
          >
            <X size={11} />
          </button>
        </div>
      </div>

      {/* Full iframe */}
      <div
        className="bg-white overflow-hidden rounded-2xl relative w-full h-full"
        style={{ overscrollBehavior: 'contain', pointerEvents: isBlockSelected ? 'auto' : 'none' }}
      >
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10">
            <div className="relative w-5 h-5">
              <div className="absolute top-0 start-0 w-full h-full border-2 border-gray-100 rounded-full" />
              <div className="absolute top-0 start-0 w-full h-full border-2 border-gray-400 rounded-full animate-spin border-t-transparent" />
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
            iframeRef.current?.blur()
          }}
          tabIndex={-1}
          title={title || 'Webpage'}
        />
      </div>

      <ResizeHandle onMouseDown={handleResizeStart} selected={selected} />
    </BoardBlockWrapper>
  )
}
