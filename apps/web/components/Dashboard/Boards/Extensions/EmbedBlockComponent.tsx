'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Code, Link as LinkIcon, X, Pencil, Palette } from 'lucide-react'
import {
  SiGithub, SiReplit, SiSpotify, SiLoom, SiGooglemaps,
  SiNotion, SiGoogledocs, SiX,
  SiFigma, SiGiphy, SiYoutube,
} from '@icons-pack/react-simple-icons'
import DOMPurify from 'dompurify'
import BoardBlockWrapper from './BoardBlockWrapper'
import DragHandle from './DragHandle'
import ResizeHandle from './ResizeHandle'
import { useDragResize } from './useDragResize'

/* ── Helpers ─────────────────────────────────────────────── */

const SCRIPT_BASED_EMBEDS: Record<string, { src: string; identifier: string }> = {
  twitter: { src: 'https://platform.twitter.com/widgets.js', identifier: 'twitter-tweet' },
  instagram: { src: 'https://www.instagram.com/embed.js', identifier: 'instagram-media' },
  tiktok: { src: 'https://www.tiktok.com/embed.js', identifier: 'tiktok-embed' },
}

function normalizeUrl(input: string): string {
  const trimmed = DOMPurify.sanitize(input.trim())
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') url.protocol = 'https:'
    return url.toString()
  } catch {
    if (trimmed && !trimmed.match(/^[a-zA-Z]+:\/\//)) return `https://${trimmed}`
    return trimmed
  }
}

function getYouTubeEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url)
    const isYt = ['youtube.com', 'www.youtube.com', 'youtu.be', 'www.youtu.be'].includes(u.hostname)
    if (!isYt) return null
    const match = url.match(/(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/i)
    if (match?.[1]?.length === 11) return `https://www.youtube.com/embed/${match[1]}?autoplay=0&rel=0`
    return null
  } catch {
    return null
  }
}

function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace('www.', '') }
  catch { return url }
}

const supportedProducts = [
  { name: 'YouTube', icon: SiYoutube, color: '#FF0000' },
  { name: 'GitHub', icon: SiGithub, color: '#181717' },
  { name: 'Replit', icon: SiReplit, color: '#F26207' },
  { name: 'Spotify', icon: SiSpotify, color: '#1DB954' },
  { name: 'Loom', icon: SiLoom, color: '#625DF5' },
  { name: 'GMaps', icon: SiGooglemaps, color: '#4285F4' },
  { name: 'CodePen', icon: Code, color: '#000000' },
  { name: 'Canva', icon: Palette, color: '#00C4CC' },
  { name: 'Notion', icon: SiNotion, color: '#878787' },
  { name: 'G Docs', icon: SiGoogledocs, color: '#4285F4' },
  { name: 'X', icon: SiX, color: '#000000' },
  { name: 'Figma', icon: SiFigma, color: '#F24E1E' },
  { name: 'Giphy', icon: SiGiphy, color: '#FF6666' },
]

/* ── Component ───────────────────────────────────────────── */

export default function EmbedBlockComponent({ node, updateAttributes, selected, deleteNode, editor, getPos }: any) {
  const { t } = useTranslation()
  const { embedUrl, embedCode, embedType, x, y, width, height } = node.attrs

  const [editing, setEditing] = useState(false)
  const [inputMode, setInputMode] = useState<'url' | 'code'>('url')
  const [urlValue, setUrlValue] = useState('')
  const [codeValue, setCodeValue] = useState('')
  const [sanitizedCode, setSanitizedCode] = useState('')
  const urlInputRef = useRef<HTMLInputElement>(null)
  const codeInputRef = useRef<HTMLTextAreaElement>(null)

  const hasEmbed = !!(embedUrl || embedCode)

  const { handleDragStart, handleResizeStart } = useDragResize({
    x, y, width, height,
    minWidth: 280, minHeight: 180,
    updateAttributes,
    editor,
    getPos,
  })

  // Sanitize embed code
  useEffect(() => {
    if (embedType === 'code' && embedCode) {
      setSanitizedCode(DOMPurify.sanitize(embedCode, { ADD_TAGS: ['iframe'], ADD_ATTR: ['*'] }))
    }
  }, [embedCode, embedType])

  // Load script-based embeds (Twitter, Instagram, TikTok)
  useEffect(() => {
    if (embedType !== 'code' || !sanitizedCode) return
    const match = Object.entries(SCRIPT_BASED_EMBEDS).find(([_, c]) => sanitizedCode.includes(c.identifier))
    if (!match) return
    const script = document.createElement('script')
    script.src = match[1].src
    script.async = true
    script.charset = 'utf-8'
    document.body.appendChild(script)
    return () => { document.body.removeChild(script) }
  }, [embedType, sanitizedCode])

  // Auto-focus input
  useEffect(() => {
    if (!editing && hasEmbed) return
    const timer = setTimeout(() => {
      if (inputMode === 'url') urlInputRef.current?.focus()
      else codeInputRef.current?.focus()
    }, 50)
    return () => clearTimeout(timer)
  }, [editing, inputMode, hasEmbed])

  const handleUrlSubmit = () => {
    const processed = normalizeUrl(urlValue)
    if (processed) updateAttributes({ embedUrl: processed, embedCode: '', embedType: 'url' })
    setEditing(false)
  }

  const handleCodeSubmit = () => {
    if (codeValue.trim()) updateAttributes({ embedCode: codeValue, embedUrl: '', embedType: 'code' })
    setEditing(false)
  }

  const startEditing = () => {
    setUrlValue(embedUrl || '')
    setCodeValue(embedCode || '')
    setInputMode(embedType === 'code' ? 'code' : 'url')
    setEditing(true)
  }

  const handleRemove = () => {
    setUrlValue('')
    setCodeValue('')
    updateAttributes({ embedUrl: '', embedCode: '', embedType: 'url' })
    setEditing(false)
  }

  // Resolve iframe src (handles YouTube conversion)
  const iframeSrc = embedUrl ? (getYouTubeEmbedUrl(embedUrl) ?? embedUrl) : ''

  /* ── Input form (empty state or editing) ───────────────── */

  const renderInputForm = () => (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 px-5 py-6">
      {/* Supported products grid (only in empty state) */}
      {!hasEmbed && (
        <div className="flex flex-wrap gap-3 justify-center max-w-[340px]">
          {supportedProducts.map((product) => (
            <button
              key={product.name}
              className="flex flex-col items-center group/item transition-transform hover:scale-105"
              onClick={() => {
                setInputMode('url')
                setUrlValue('')
                urlInputRef.current?.focus()
              }}
              title={t('boards.embed_block.add_embed', { name: product.name })}
            >
              <div
                className="w-7 h-7 rounded-md flex items-center justify-center shadow-sm group-hover/item:shadow-md transition-all"
                style={{ backgroundColor: product.color }}
              >
                <product.icon size={12} color="#FFFFFF" />
              </div>
              <span className="text-[8px] mt-0.5 text-neutral-400 group-hover/item:text-neutral-600 font-medium leading-tight">{product.name}</span>
            </button>
          ))}
        </div>
      )}

      {/* Divider */}
      {!hasEmbed && <div className="w-12 h-px bg-neutral-200/80" />}

      {/* Mode tabs */}
      <div className="flex gap-0.5 bg-neutral-100/80 rounded-lg p-0.5">
        <button
          onClick={() => setInputMode('url')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium transition-all ${
            inputMode === 'url' ? 'bg-white text-neutral-700 shadow-sm' : 'text-neutral-400 hover:text-neutral-500'
          }`}
        >
          <LinkIcon size={10} />
          {t('boards.embed_block.url')}
        </button>
        <button
          onClick={() => setInputMode('code')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium transition-all ${
            inputMode === 'code' ? 'bg-white text-neutral-700 shadow-sm' : 'text-neutral-400 hover:text-neutral-500'
          }`}
        >
          <Code size={10} />
          {t('boards.embed_block.code')}
        </button>
      </div>

      {/* Input area */}
      {inputMode === 'url' ? (
        <div className="w-full flex flex-col items-center gap-2 max-w-sm">
          <div className="flex items-center gap-2 w-full">
            <div className="flex-1 flex items-center gap-1.5 bg-neutral-50 border border-neutral-200/80 rounded-lg px-2.5 py-2 focus-within:border-neutral-300 focus-within:bg-white transition-colors">
              <LinkIcon size={11} className="text-neutral-400 shrink-0" />
              <input
                ref={urlInputRef}
                type="text"
                value={urlValue}
                onChange={(e) => setUrlValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleUrlSubmit()
                  if (e.key === 'Escape') { setEditing(false); setUrlValue('') }
                }}
                placeholder="https://..."
                className="flex-1 text-xs bg-transparent outline-none text-neutral-700 placeholder:text-neutral-400"
              />
            </div>
            <button
              onClick={handleUrlSubmit}
              disabled={!urlValue.trim()}
              className="px-3.5 py-2 text-[11px] font-medium rounded-lg bg-neutral-900 text-white hover:bg-neutral-700 transition-colors disabled:opacity-30 shrink-0"
            >
              {t('boards.embed_block.apply')}
            </button>
          </div>
          <p className="text-[10px] text-neutral-400">{t('boards.embed_block.url_help')}</p>
        </div>
      ) : (
        <div className="w-full flex flex-col items-center gap-2 max-w-sm">
          <textarea
            ref={codeInputRef}
            value={codeValue}
            onChange={(e) => setCodeValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setEditing(false); setCodeValue('') }
            }}
            placeholder={'<iframe src="..." ...></iframe>'}
            className="w-full p-2.5 bg-neutral-50 border border-neutral-200/80 rounded-lg h-20 text-xs font-mono outline-none focus:border-neutral-300 focus:bg-white text-neutral-700 placeholder:text-neutral-400 resize-none transition-colors"
          />
          <div className="flex justify-between items-center w-full">
            <p className="text-[10px] text-neutral-400">{t('boards.embed_block.code_help')}</p>
            <button
              onClick={handleCodeSubmit}
              disabled={!codeValue.trim()}
              className="px-3.5 py-2 text-[11px] font-medium rounded-lg bg-neutral-900 text-white hover:bg-neutral-700 transition-colors disabled:opacity-30 shrink-0"
            >
              {t('boards.embed_block.apply')}
            </button>
          </div>
        </div>
      )}

      {editing && (
        <button
          onClick={() => setEditing(false)}
          className="text-[11px] text-neutral-400 hover:text-neutral-500 transition-colors"
        >
          Cancel
        </button>
      )}
    </div>
  )

  /* ── Embed content (loaded state) ──────────────────────── */

  const renderEmbedContent = () => (
    <div
      className="mx-4 mb-4 mt-1.5 overflow-hidden rounded-xl border border-neutral-100 nice-shadow relative"
      style={{ height: height - 80, overscrollBehavior: 'contain', pointerEvents: selected ? 'auto' : 'none' }}
    >
      {embedType === 'url' && iframeSrc ? (
        <iframe
          src={iframeSrc}
          className="w-full h-full block"
          style={{ border: 'none', overscrollBehavior: 'contain' }}
          frameBorder="0"
          allowFullScreen
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          title={extractDomain(embedUrl)}
        />
      ) : embedType === 'code' && sanitizedCode ? (
        <div dangerouslySetInnerHTML={{ __html: sanitizedCode }} className="w-full h-full overflow-auto" />
      ) : null}
    </div>
  )

  /* ── Render ────────────────────────────────────────────── */

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
      <div className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-violet-50/80 to-transparent rounded-t-2xl pointer-events-none z-0" />

      <DragHandle onMouseDown={handleDragStart} />

      {/* Header with icon + label + actions */}
      <div className="flex items-center px-4 pt-4 pb-0.5 relative z-[1]">
        <div className="flex items-center gap-1.5 flex-1">
          <div className="w-5 h-5 rounded-md bg-violet-100 flex items-center justify-center">
            <Code size={10} className="text-violet-500" />
          </div>
          <span className="text-[9px] font-semibold tracking-wider uppercase select-none text-neutral-400">
            {hasEmbed && !editing && embedType === 'url' ? extractDomain(embedUrl) : t('boards.embed_block.embed')}
          </span>
        </div>

        {hasEmbed && !editing && (
          <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={startEditing}
              className="text-neutral-300 hover:text-neutral-500 transition-colors"
              title={t('boards.embed_block.edit_embed')}
            >
              <Pencil size={11} />
            </button>
            <button
              onClick={handleRemove}
              className="text-neutral-300 hover:text-red-400 transition-colors"
              title={t('boards.embed_block.remove_embed')}
            >
              <X size={11} />
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      {hasEmbed && !editing ? renderEmbedContent() : renderInputForm()}

      <ResizeHandle onMouseDown={handleResizeStart} selected={selected} />
    </BoardBlockWrapper>
  )
}
