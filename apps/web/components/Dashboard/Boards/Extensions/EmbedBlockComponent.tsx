'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDragResize } from './useDragResize'
import { NodeViewWrapper } from '@tiptap/react'
import { GripVertical, Link as LinkIcon, Code, X, ExternalLink } from 'lucide-react'
import {
  SiGithub, SiReplit, SiSpotify, SiLoom, SiGooglemaps,
  SiCodepen, SiCanva, SiNotion, SiGoogledocs, SiX,
  SiFigma, SiGiphy, SiYoutube,
} from '@icons-pack/react-simple-icons'
import DOMPurify from 'dompurify'
import NodeActions from './NodeActions'

const SCRIPT_BASED_EMBEDS: Record<string, { src: string; identifier: string }> = {
  twitter: { src: 'https://platform.twitter.com/widgets.js', identifier: 'twitter-tweet' },
  instagram: { src: 'https://www.instagram.com/embed.js', identifier: 'instagram-media' },
  tiktok: { src: 'https://www.tiktok.com/embed.js', identifier: 'tiktok-embed' },
}

const supportedProducts = [
  { name: 'YouTube', icon: SiYoutube, color: '#FF0000' },
  { name: 'GitHub', icon: SiGithub, color: '#181717' },
  { name: 'Replit', icon: SiReplit, color: '#F26207' },
  { name: 'Spotify', icon: SiSpotify, color: '#1DB954' },
  { name: 'Loom', icon: SiLoom, color: '#625DF5' },
  { name: 'GMaps', icon: SiGooglemaps, color: '#4285F4' },
  { name: 'CodePen', icon: SiCodepen, color: '#000000' },
  { name: 'Canva', icon: SiCanva, color: '#00C4CC' },
  { name: 'Notion', icon: SiNotion, color: '#878787' },
  { name: 'G Docs', icon: SiGoogledocs, color: '#4285F4' },
  { name: 'X', icon: SiX, color: '#000000' },
  { name: 'Figma', icon: SiFigma, color: '#F24E1E' },
  { name: 'Giphy', icon: SiGiphy, color: '#FF6666' },
]

function getYouTubeEmbedUrl(url: string): string {
  try {
    const parsedUrl = new URL(url)
    const isYoutube =
      parsedUrl.hostname === 'youtube.com' ||
      parsedUrl.hostname === 'www.youtube.com' ||
      parsedUrl.hostname === 'youtu.be' ||
      parsedUrl.hostname === 'www.youtu.be'
    if (!isYoutube) return url

    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i
    const match = url.match(regex)
    if (match?.[1]?.length === 11) {
      return `https://www.youtube.com/embed/${match[1]}?autoplay=0&rel=0`
    }
    return url
  } catch {
    return url
  }
}

function processUrl(raw: string): string {
  const sanitized = DOMPurify.sanitize(raw.trim())
  if (!sanitized) return ''
  try {
    const url = new URL(sanitized)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      url.protocol = 'https:'
      return url.toString()
    }
    return sanitized
  } catch {
    if (sanitized && !sanitized.match(/^[a-zA-Z]+:\/\//)) {
      return `https://${sanitized}`
    }
    return sanitized
  }
}

const MemoizedEmbed = React.memo(({ embedUrl, sanitizedCode, embedType }: {
  embedUrl: string
  sanitizedCode: string
  embedType: 'url' | 'code'
}) => {
  useEffect(() => {
    if (embedType === 'code' && sanitizedCode) {
      const match = Object.entries(SCRIPT_BASED_EMBEDS).find(([_, c]) =>
        sanitizedCode.includes(c.identifier)
      )
      if (match) {
        const script = document.createElement('script')
        script.src = match[1].src
        script.async = true
        script.charset = 'utf-8'
        document.body.appendChild(script)
        return () => { document.body.removeChild(script) }
      }
    }
  }, [embedType, sanitizedCode])

  if (embedType === 'url' && embedUrl) {
    let isYoutube = false
    try {
      const u = new URL(embedUrl)
      isYoutube = ['youtube.com', 'www.youtube.com', 'youtu.be', 'www.youtu.be'].includes(u.hostname)
    } catch { /* */ }
    const src = isYoutube ? getYouTubeEmbedUrl(embedUrl) : embedUrl
    return <iframe src={src} className="w-full h-full rounded-b-xl" frameBorder="0" allowFullScreen />
  }

  if (embedType === 'code' && sanitizedCode) {
    return <div dangerouslySetInnerHTML={{ __html: sanitizedCode }} className="w-full h-full" />
  }

  return null
})
MemoizedEmbed.displayName = 'MemoizedEmbed'

export default function EmbedBlockComponent({ node, updateAttributes, selected, deleteNode, editor, getPos }: any) {
  const { embedUrl, embedCode, embedType, x, y, width, height } = node.attrs

  // Input state
  const [activeInput, setActiveInput] = useState<'none' | 'url' | 'code'>('none')
  const [urlValue, setUrlValue] = useState(embedUrl || '')
  const [codeValue, setCodeValue] = useState(embedCode || '')
  const urlInputRef = useRef<HTMLInputElement>(null)
  const codeInputRef = useRef<HTMLTextAreaElement>(null)

  const [sanitizedCode, setSanitizedCode] = useState('')

  useEffect(() => {
    if (embedType === 'code' && embedCode) {
      setSanitizedCode(DOMPurify.sanitize(embedCode, { ADD_TAGS: ['iframe'], ADD_ATTR: ['*'] }))
    }
  }, [embedCode, embedType])

  const hasEmbed = !!(embedUrl || sanitizedCode)

  // --- Drag & Resize (smooth, commit on mouseUp only) ---
  const { handleDragStart, handleResizeStart } = useDragResize({
    x, y, width, height,
    minWidth: 280, minHeight: 180,
    updateAttributes,
  })

  // --- Stop wheel from bubbling ---
  const stopWheel = useCallback((e: React.WheelEvent) => { e.stopPropagation() }, [])

  // --- URL submit ---
  const handleUrlSubmit = () => {
    const processed = processUrl(urlValue)
    if (processed) {
      updateAttributes({ embedUrl: processed, embedType: 'url' })
    }
    setActiveInput('none')
  }

  // --- Code submit ---
  const handleCodeSubmit = () => {
    if (codeValue.trim()) {
      updateAttributes({ embedCode: codeValue, embedType: 'code' })
    }
    setActiveInput('none')
  }

  // --- Remove embed ---
  const handleRemove = () => {
    setUrlValue('')
    setCodeValue('')
    updateAttributes({ embedUrl: '', embedCode: '', embedType: 'url' })
  }

  // Focus input when switching
  useEffect(() => {
    if (activeInput === 'url') setTimeout(() => urlInputRef.current?.focus(), 50)
    if (activeInput === 'code') setTimeout(() => codeInputRef.current?.focus(), 50)
  }, [activeInput])

  const embedContent = useMemo(() => (
    hasEmbed ? (
      <MemoizedEmbed embedUrl={embedUrl} sanitizedCode={sanitizedCode} embedType={embedType} />
    ) : null
  ), [embedUrl, sanitizedCode, embedType, hasEmbed])

  // --- No embed set: show picker ---
  if (!hasEmbed) {
    return (
      <NodeViewWrapper
        as="div"
        onWheel={stopWheel}
        className={`absolute group rounded-xl nice-shadow bg-white ${selected ? 'ring-2 ring-blue-400' : ''}`}
        style={{ left: x, top: y, width, minHeight: 200 }}
      >
        <NodeActions selected={selected} deleteNode={deleteNode} editor={editor} getPos={getPos} />
        <div
          onMouseDown={handleDragStart}
          className="flex items-center justify-center h-6 cursor-grab active:cursor-grabbing bg-gray-50/80 border-b border-gray-100 rounded-t-xl"
        >
          <GripVertical size={12} className="text-gray-400" />
        </div>

        {activeInput === 'none' ? (
          <div className="p-4 flex flex-col items-center gap-3">
            <div className="flex items-center gap-2 mb-1">
              <ExternalLink size={14} className="text-neutral-400" />
              <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Embed</span>
            </div>

            {/* Product grid */}
            <div className="flex flex-wrap gap-2.5 justify-center">
              {supportedProducts.map((product) => (
                <button
                  key={product.name}
                  className="flex flex-col items-center group/item transition-transform hover:scale-110"
                  onClick={() => {
                    setActiveInput('url')
                    setUrlValue('')
                  }}
                  title={`Add ${product.name} embed`}
                >
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center shadow-sm group-hover/item:shadow-md transition-shadow"
                    style={{ backgroundColor: product.color }}
                  >
                    <product.icon size={16} color="#FFFFFF" />
                  </div>
                  <span className="text-[10px] mt-1 text-neutral-500 group-hover/item:text-neutral-700 font-medium">{product.name}</span>
                </button>
              ))}
            </div>

            {/* URL / Code buttons */}
            <div className="flex gap-2 mt-1">
              <button
                onClick={() => setActiveInput('url')}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 rounded-lg text-xs text-neutral-600 transition-colors"
              >
                <LinkIcon size={12} />
                URL
              </button>
              <button
                onClick={() => setActiveInput('code')}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 rounded-lg text-xs text-neutral-600 transition-colors"
              >
                <Code size={12} />
                Code
              </button>
            </div>
          </div>
        ) : activeInput === 'url' ? (
          <div className="p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-neutral-600">Paste embed URL</span>
              <button onClick={() => setActiveInput('none')} className="text-neutral-400 hover:text-neutral-600">
                <X size={14} />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center gap-1.5 bg-neutral-100 rounded-lg px-2.5 py-1.5">
                <LinkIcon size={12} className="text-neutral-400 shrink-0" />
                <input
                  ref={urlInputRef}
                  type="text"
                  value={urlValue}
                  onChange={(e) => setUrlValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleUrlSubmit()
                    if (e.key === 'Escape') setActiveInput('none')
                  }}
                  placeholder="https://..."
                  className="flex-1 text-xs bg-transparent outline-none text-neutral-700 placeholder:text-neutral-400"
                />
              </div>
              <button
                onClick={handleUrlSubmit}
                disabled={!urlValue.trim()}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-neutral-900 text-white hover:bg-neutral-700 transition-colors disabled:opacity-40"
              >
                Add
              </button>
            </div>
            <p className="text-[10px] text-neutral-400">Paste a URL from YouTube, Figma, CodePen, Spotify, and more</p>
          </div>
        ) : (
          <div className="p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-neutral-600">Paste embed code</span>
              <button onClick={() => setActiveInput('none')} className="text-neutral-400 hover:text-neutral-600">
                <X size={14} />
              </button>
            </div>
            <textarea
              ref={codeInputRef}
              value={codeValue}
              onChange={(e) => setCodeValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setActiveInput('none')
              }}
              placeholder={'<iframe src="..." ...></iframe>'}
              className="w-full p-2.5 bg-neutral-100 border border-neutral-200 rounded-lg h-24 text-xs font-mono outline-none focus:ring-1 focus:ring-neutral-300 text-neutral-700 placeholder:text-neutral-400 resize-none"
            />
            <div className="flex justify-between items-center">
              <p className="text-[10px] text-neutral-400">Paste iframe or embed code</p>
              <button
                onClick={handleCodeSubmit}
                disabled={!codeValue.trim()}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-neutral-900 text-white hover:bg-neutral-700 transition-colors disabled:opacity-40"
              >
                Add
              </button>
            </div>
          </div>
        )}
      </NodeViewWrapper>
    )
  }

  // --- Embed set: render content ---
  return (
    <NodeViewWrapper
      as="div"
      onWheel={stopWheel}
      className={`absolute group rounded-xl nice-shadow bg-white ${selected ? 'ring-2 ring-blue-400' : ''}`}
      style={{ left: x, top: y, width, height }}
    >
      <NodeActions selected={selected} deleteNode={deleteNode} editor={editor} getPos={getPos} />

      {/* Drag handle + header */}
      <div
        onMouseDown={handleDragStart}
        className="flex items-center gap-2 h-7 cursor-grab active:cursor-grabbing bg-gray-50/90 border-b border-gray-100 rounded-t-xl px-2"
      >
        <GripVertical size={12} className="text-gray-400 shrink-0" />
        <ExternalLink size={10} className="text-neutral-400 shrink-0" />
        <span className="text-[10px] font-medium text-neutral-500 truncate flex-1">Embed</span>
        <button
          onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); handleRemove() }}
          className="text-neutral-400 hover:text-red-500 transition-colors shrink-0"
          title="Remove embed"
        >
          <X size={11} />
        </button>
        <button
          onMouseDown={(e) => {
            e.stopPropagation()
            e.preventDefault()
            setUrlValue(embedUrl || '')
            setCodeValue(embedCode || '')
            setActiveInput(embedType === 'code' ? 'code' : 'url')
          }}
          className="text-neutral-400 hover:text-neutral-600 transition-colors shrink-0"
          title="Edit embed"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z" />
          </svg>
        </button>
      </div>

      {/* Embed content */}
      <div className="overflow-hidden rounded-b-xl" style={{ height: height - 28, overscrollBehavior: 'contain' }}>
        {activeInput !== 'none' ? (
          <div className="bg-white p-4 h-full flex flex-col justify-center">
            {activeInput === 'url' ? (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-neutral-600">Edit embed URL</span>
                  <button onClick={() => setActiveInput('none')} className="text-neutral-400 hover:text-neutral-600">
                    <X size={14} />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-1.5 bg-neutral-100 rounded-lg px-2.5 py-1.5">
                    <LinkIcon size={12} className="text-neutral-400 shrink-0" />
                    <input
                      ref={urlInputRef}
                      type="text"
                      value={urlValue}
                      onChange={(e) => setUrlValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleUrlSubmit()
                        if (e.key === 'Escape') setActiveInput('none')
                      }}
                      placeholder="https://..."
                      className="flex-1 text-xs bg-transparent outline-none text-neutral-700 placeholder:text-neutral-400"
                    />
                  </div>
                  <button
                    onClick={handleUrlSubmit}
                    disabled={!urlValue.trim()}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-neutral-900 text-white hover:bg-neutral-700 transition-colors disabled:opacity-40"
                  >
                    Apply
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-neutral-600">Edit embed code</span>
                  <button onClick={() => setActiveInput('none')} className="text-neutral-400 hover:text-neutral-600">
                    <X size={14} />
                  </button>
                </div>
                <textarea
                  ref={codeInputRef}
                  value={codeValue}
                  onChange={(e) => setCodeValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') setActiveInput('none') }}
                  placeholder={'<iframe src="..." ...></iframe>'}
                  className="w-full p-2.5 bg-neutral-100 border border-neutral-200 rounded-lg h-24 text-xs font-mono outline-none focus:ring-1 focus:ring-neutral-300 text-neutral-700 placeholder:text-neutral-400 resize-none"
                />
                <div className="flex justify-end">
                  <button
                    onClick={handleCodeSubmit}
                    disabled={!codeValue.trim()}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-neutral-900 text-white hover:bg-neutral-700 transition-colors disabled:opacity-40"
                  >
                    Apply
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : embedContent}
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={handleResizeStart}
        className="absolute bottom-0 right-0 w-5 h-5 cursor-se-resize opacity-0 group-hover:opacity-100 transition-opacity z-10"
      >
        <svg viewBox="0 0 16 16" className="w-full h-full text-gray-300">
          <path d="M14 14L14 8M14 14L8 14" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </div>
    </NodeViewWrapper>
  )
}
