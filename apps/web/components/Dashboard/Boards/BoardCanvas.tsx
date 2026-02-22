'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MessageCircle } from 'lucide-react'
import { FeedbackModal } from '@components/Objects/Modals/FeedbackModal'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import { HocuspocusProvider } from '@hocuspocus/provider'
import * as Y from 'yjs'
import { getCollabUrl } from '@services/config/config'
import BoardToolbar from './BoardToolbar'
import BoardTopBar from './BoardTopBar'
import BoardTopRight from './BoardTopRight'
import BoardZoomControls from './BoardZoomControls'
import EphemeralChat from './EphemeralChat'
import BoardEffects from './BoardEffects'
import { BoardCardExtension } from './Extensions/BoardCard'
import { DrawingStrokeExtension } from './Extensions/DrawingStroke'
import { YouTubeBlockExtension } from './Extensions/YouTubeBlock'
import { PlaygroundBlockExtension } from './Extensions/PlaygroundBlock'
import { ActivityBlockExtension } from './Extensions/ActivityBlock'
import { EmbedBlockExtension } from './Extensions/EmbedBlock'
import { WebpageBlockExtension } from './Extensions/WebpageBlock'
import { StickerBlockExtension } from './Extensions/StickerBlock'
import { FrameBoxExtension } from './Extensions/FrameBox'
import { NoteBlockExtension } from './Extensions/NoteBlock'
import { TodoBlockExtension } from './Extensions/TodoBlock'
import { PodcastBlockExtension } from './Extensions/PodcastBlock'
import RemoteCursors from './RemoteCursors'
import {
  Square,
  YoutubeLogo,
  Sparkle,
  BookOpen,
  Code,
  Globe,
  Smiley,
  Note,
  FrameCorners,
  CheckSquare,
  Headphones,
  PencilSimple,
} from '@phosphor-icons/react'
import { Extension } from '@tiptap/core'
import { BoardYjsProvider } from './BoardYjsContext'
import { BoardSelectionProvider } from './BoardSelectionContext'


interface BoardCanvasProps {
  board: any
  accessToken: string
  orgslug: string
  username: string
}

const COLORS = [
  '#958DF1', '#F98181', '#FBBC88', '#FAF594',
  '#70CFF8', '#94FADB', '#B9F18D', '#C3A8F0',
]

function getRandomColor() {
  return COLORS[Math.floor(Math.random() * COLORS.length)]
}

function pointsToSvgPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0].x} ${points[0].y} L ${points[0].x} ${points[0].y}`
  let d = `M ${points[0].x} ${points[0].y}`
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]
    const curr = points[i]
    const mx = (prev.x + curr.x) / 2
    const my = (prev.y + curr.y) / 2
    d += ` Q ${prev.x} ${prev.y} ${mx} ${my}`
  }
  const last = points[points.length - 1]
  d += ` L ${last.x} ${last.y}`
  return d
}

/** Inner component — only mounted once ydoc & provider are ready */
function BoardEditorInner({
  board,
  orgslug,
  username,
  accessToken,
  ydoc,
  provider,
}: {
  board: any
  orgslug: string
  username: string
  accessToken: string
  ydoc: Y.Doc
  provider: HocuspocusProvider
}) {
  const [toolMode, setToolMode] = useState<'select' | 'pan' | 'draw' | 'card' | 'youtube' | 'playground' | 'activity' | 'embed' | 'webpage' | 'sticker' | 'frame' | 'note' | 'todo' | 'podcast'>('select')
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [drawColor, setDrawColor] = useState('#000000')
  const [drawWidth, setDrawWidth] = useState(2)
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })
  const [isDrawing, setIsDrawing] = useState(false)
  const drawPointsRef = useRef<{ x: number; y: number }[]>([])
  const [drawingPath, setDrawingPath] = useState('')
  const canvasRef = useRef<HTMLDivElement>(null)
  const panRafRef = useRef(0)
  const prevToolModeRef = useRef<typeof toolMode | null>(null)
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null)

  // Multi-select state
  const [selectedPositions, setSelectedPositions] = useState<Set<number>>(new Set())
  const [marquee, setMarquee] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null)
  const marqueeRef = useRef<typeof marquee>(null)

  // Placement tool indicator config
  const placementTools: Partial<Record<typeof toolMode, { icon: React.ComponentType<any>; label: string }>> = {
    draw: { icon: PencilSimple, label: 'Draw' },
    card: { icon: Square, label: 'Card' },
    youtube: { icon: YoutubeLogo, label: 'YouTube' },
    playground: { icon: Sparkle, label: 'AI Playground' },
    activity: { icon: BookOpen, label: 'Activity' },
    embed: { icon: Code, label: 'Embed' },
    webpage: { icon: Globe, label: 'Webpage' },
    note: { icon: Note, label: 'Note' },
    sticker: { icon: Smiley, label: 'Sticker' },
    frame: { icon: FrameCorners, label: 'Frame' },
    todo: { icon: CheckSquare, label: 'Todo' },
    podcast: { icon: Headphones, label: 'Podcast' },
  }
  const activePlacement = placementTools[toolMode] ?? null

  // Clear stale mouse position when leaving a placement tool
  useEffect(() => {
    if (!activePlacement) setMousePos(null)
  }, [activePlacement])

  const userColor = useMemo(() => getRandomColor(), [])
  const [feedbackOpen, setFeedbackOpen] = useState(false)

  // Set user info on awareness (for RemoteCursors and PresenceAvatars)
  useEffect(() => {
    if (provider.awareness) {
      provider.awareness.setLocalStateField('user', {
        name: username,
        color: userColor,
      })
    }
  }, [provider, username, userColor])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        undoRedo: false, // Yjs handles undo/redo
      }),
      Collaboration.configure({
        document: ydoc,
      }),
      Extension.create({
        name: 'boardContext',
        addStorage() {
          return {
            accessToken,
            boardUuid: board.board_uuid,
            boardName: board.name || 'Board',
            orgslug,
            username,
          }
        },
      }),
      BoardCardExtension,
      DrawingStrokeExtension,
      YouTubeBlockExtension,
      PlaygroundBlockExtension,
      ActivityBlockExtension,
      EmbedBlockExtension,
      WebpageBlockExtension,
      StickerBlockExtension,
      FrameBoxExtension,
      NoteBlockExtension,
      TodoBlockExtension,
      PodcastBlockExtension,
    ],
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'board-editor outline-none min-h-[2000px] min-w-[3000px] relative',
      },
    },
  })

  // Remap selected positions when the document changes
  useEffect(() => {
    if (!editor) return
    const handler = () => {
      // Get the last transaction from the editor state
      // We remap after every update to keep positions valid
      setSelectedPositions((prev) => {
        if (prev.size === 0) return prev
        const next = new Set<number>()
        const doc = editor.state.doc
        // Re-validate positions: check each still points to a top-level node
        for (const pos of prev) {
          if (pos >= 0 && pos < doc.content.size) {
            const node = doc.nodeAt(pos)
            if (node) next.add(pos)
          }
        }
        if (next.size === prev.size && [...next].every((p) => prev.has(p))) return prev
        return next
      })
    }
    editor.on('update', handler)
    return () => { editor.off('update', handler) }
  }, [editor])

  // Keyboard handler: Delete/Backspace removes all selected nodes, Space to pan
  useEffect(() => {
    if (!editor) return
    const handleKeyDown = (e: KeyboardEvent) => {
      // Space to temporarily activate pan mode
      if (e.code === 'Space') {
        const tag = (e.target as HTMLElement)?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return
        e.preventDefault()
        if (prevToolModeRef.current === null) {
          prevToolModeRef.current = toolMode
          setToolMode('pan')
        }
        return
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Only handle if no text input is focused
        const tag = (e.target as HTMLElement)?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return
        if (selectedPositions.size === 0) return
        e.preventDefault()
        // Delete in reverse order to preserve earlier positions
        const sorted = Array.from(selectedPositions).sort((a, b) => b - a)
        editor.chain()
          .command(({ tr }) => {
            for (const pos of sorted) {
              const node = tr.doc.nodeAt(pos)
              if (node) tr.delete(pos, pos + node.nodeSize)
            }
            return true
          })
          .run()
        setSelectedPositions(new Set())
      }
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && prevToolModeRef.current !== null) {
        setToolMode(prevToolModeRef.current)
        prevToolModeRef.current = null
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [editor, selectedPositions, toolMode])

  // Pan/Zoom handlers
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const delta = e.deltaY > 0 ? -0.1 : 0.1
      setZoom((z) => Math.min(Math.max(z + delta, 0.25), 3))
    } else {
      setPan((p) => ({
        x: p.x - e.deltaX,
        y: p.y - e.deltaY,
      }))
    }
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (toolMode === 'pan' || e.button === 1 || (e.button === 0 && e.shiftKey && toolMode !== 'select')) {
      setIsPanning(true)
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y })
      e.preventDefault()
    } else if (toolMode === 'select' && e.button === 0) {
      // Check if click landed on a block (node-view-wrapper) — if so, let the block handle it
      const target = e.target as HTMLElement
      const isOnBlock = target.closest('[data-node-view-wrapper]')
      if (!isOnBlock) {
        // Start marquee or just clear selection
        const rect = canvasRef.current?.getBoundingClientRect()
        if (rect) {
          const sx = e.clientX - rect.left
          const sy = e.clientY - rect.top
          const m = { startX: sx, startY: sy, currentX: sx, currentY: sy }
          setMarquee(m)
          marqueeRef.current = m
        }
        if (!e.shiftKey) {
          setSelectedPositions(new Set())
        }
      }
    } else if (toolMode === 'draw') {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      e.preventDefault()
      const x = (e.clientX - rect.left - pan.x) / zoom
      const y = (e.clientY - rect.top - pan.y) / zoom
      drawPointsRef.current = [{ x, y }]
      setDrawingPath(`M ${x} ${y}`)
      setIsDrawing(true)
    } else if (toolMode === 'card' && editor) {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      const x = (e.clientX - rect.left - pan.x) / zoom
      const y = (e.clientY - rect.top - pan.y) / zoom
      const cardPos = editor.state.doc.content.size
      editor.chain().insertContentAt(cardPos, {
        type: 'boardCard',
        attrs: { x: Math.round(x), y: Math.round(y), width: 300, height: 200 },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'New card' }] }],
      }).run()
      setToolMode('select')
    } else if (toolMode === 'youtube' && editor) {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      const x = (e.clientX - rect.left - pan.x) / zoom
      const y = (e.clientY - rect.top - pan.y) / zoom
      const ytPos = editor.state.doc.content.size
      editor.chain().insertContentAt(ytPos, {
        type: 'youtubeBlock',
        attrs: { x: Math.round(x), y: Math.round(y), width: 480, height: 270 },
      }).run()
      setToolMode('select')
    } else if (toolMode === 'playground' && editor) {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      const x = (e.clientX - rect.left - pan.x) / zoom
      const y = (e.clientY - rect.top - pan.y) / zoom
      const pos = editor.state.doc.content.size
      editor.chain().insertContentAt(pos, {
        type: 'playgroundBlock',
        attrs: {
          blockUuid: `pg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          x: Math.round(x),
          y: Math.round(y),
          width: 520,
          height: 400,
        },
      }).run()
      setToolMode('select')
    } else if (toolMode === 'activity' && editor) {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      const x = (e.clientX - rect.left - pan.x) / zoom
      const y = (e.clientY - rect.top - pan.y) / zoom
      const pos = editor.state.doc.content.size
      editor.chain().insertContentAt(pos, {
        type: 'activityBlock',
        attrs: {
          x: Math.round(x),
          y: Math.round(y),
          width: 520,
          height: 400,
        },
      }).run()
      setToolMode('select')
    } else if (toolMode === 'embed' && editor) {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      const x = (e.clientX - rect.left - pan.x) / zoom
      const y = (e.clientY - rect.top - pan.y) / zoom
      const pos = editor.state.doc.content.size
      editor.chain().insertContentAt(pos, {
        type: 'embedBlock',
        attrs: {
          x: Math.round(x),
          y: Math.round(y),
          width: 520,
          height: 360,
        },
      }).run()
      setToolMode('select')
    } else if (toolMode === 'webpage' && editor) {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      const x = (e.clientX - rect.left - pan.x) / zoom
      const y = (e.clientY - rect.top - pan.y) / zoom
      const pos = editor.state.doc.content.size
      editor.chain().insertContentAt(pos, {
        type: 'webpageBlock',
        attrs: {
          x: Math.round(x),
          y: Math.round(y),
          width: 520,
          height: 400,
        },
      }).run()
      setToolMode('select')
    } else if (toolMode === 'note' && editor) {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      const x = (e.clientX - rect.left - pan.x) / zoom
      const y = (e.clientY - rect.top - pan.y) / zoom
      const pos = editor.state.doc.content.size
      editor.chain().insertContentAt(pos, {
        type: 'noteBlock',
        attrs: { x: Math.round(x), y: Math.round(y), width: 260, height: 200 },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'New note' }] }],
      }).run()
      setToolMode('select')
    } else if (toolMode === 'sticker' && editor) {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      const x = (e.clientX - rect.left - pan.x) / zoom
      const y = (e.clientY - rect.top - pan.y) / zoom
      const pos = editor.state.doc.content.size
      editor.chain().insertContentAt(pos, {
        type: 'stickerBlock',
        attrs: {
          x: Math.round(x),
          y: Math.round(y),
          emoji: '😀',
        },
      }).run()
      setToolMode('select')
    } else if (toolMode === 'todo' && editor) {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      const x = (e.clientX - rect.left - pan.x) / zoom
      const y = (e.clientY - rect.top - pan.y) / zoom
      const pos = editor.state.doc.content.size
      editor.chain().insertContentAt(pos, {
        type: 'todoBlock',
        attrs: { x: Math.round(x), y: Math.round(y), width: 260, height: 260 },
      }).run()
      setToolMode('select')
    } else if (toolMode === 'podcast' && editor) {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      const x = (e.clientX - rect.left - pan.x) / zoom
      const y = (e.clientY - rect.top - pan.y) / zoom
      const pos = editor.state.doc.content.size
      editor.chain().insertContentAt(pos, {
        type: 'podcastBlock',
        attrs: { x: Math.round(x), y: Math.round(y), width: 400, height: 280 },
      }).run()
      setToolMode('select')
    } else if (toolMode === 'frame' && editor) {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      const x = (e.clientX - rect.left - pan.x) / zoom
      const y = (e.clientY - rect.top - pan.y) / zoom
      const pos = editor.state.doc.content.size
      editor.chain().insertContentAt(pos, {
        type: 'frameBox',
        attrs: {
          x: Math.round(x),
          y: Math.round(y),
          width: 400,
          height: 300,
          title: 'Frame',
        },
      }).run()
      setToolMode('select')
    }
  }, [toolMode, pan, zoom, editor])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    // Track mouse position for placement ghost preview
    if (activePlacement) {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (rect) {
        setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
      }
    }

    if (isPanning) {
      const newX = e.clientX - panStart.x
      const newY = e.clientY - panStart.y
      cancelAnimationFrame(panRafRef.current)
      panRafRef.current = requestAnimationFrame(() => {
        setPan({ x: newX, y: newY })
      })
    } else if (marqueeRef.current) {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      const m = { ...marqueeRef.current, currentX: e.clientX - rect.left, currentY: e.clientY - rect.top }
      marqueeRef.current = m
      cancelAnimationFrame(panRafRef.current)
      panRafRef.current = requestAnimationFrame(() => {
        setMarquee(m)
      })
    } else if (isDrawing) {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      const x = (e.clientX - rect.left - pan.x) / zoom
      const y = (e.clientY - rect.top - pan.y) / zoom
      drawPointsRef.current.push({ x, y })
      cancelAnimationFrame(panRafRef.current)
      panRafRef.current = requestAnimationFrame(() => {
        setDrawingPath(pointsToSvgPath(drawPointsRef.current))
      })
    }
  }, [isPanning, panStart, isDrawing, pan, zoom, activePlacement])

  const handleMouseUp = useCallback(() => {
    if (isPanning) {
      setIsPanning(false)
    }
    if (marqueeRef.current && editor) {
      const m = marqueeRef.current
      // Convert screen-space marquee rect to world-space
      const left = Math.min(m.startX, m.currentX)
      const top = Math.min(m.startY, m.currentY)
      const right = Math.max(m.startX, m.currentX)
      const bottom = Math.max(m.startY, m.currentY)

      // Only count as marquee if dragged at least 5px
      if (right - left > 5 || bottom - top > 5) {
        // Convert to world coords
        const wLeft = (left - pan.x) / zoom
        const wTop = (top - pan.y) / zoom
        const wRight = (right - pan.x) / zoom
        const wBottom = (bottom - pan.y) / zoom

        const hits: number[] = []
        editor.state.doc.forEach((node: any, pos: number) => {
          const nx = node.attrs.x ?? 0
          const ny = node.attrs.y ?? 0

          // Resolve actual rendered size per node type
          let nw: number, nh: number
          const typeName = node.type.name
          if (typeName === 'stickerBlock') {
            nw = 80; nh = 80
          } else if (typeName === 'drawingStroke') {
            const vb = (node.attrs.viewBox || '0 0 100 100').split(' ').map(Number)
            nw = vb[2] || 100
            nh = vb[3] || 100
          } else {
            nw = node.attrs.width ?? 300
            nh = node.attrs.height ?? 200
          }

          // Check if block overlaps marquee rect
          if (nx + nw > wLeft && nx < wRight && ny + nh > wTop && ny < wBottom) {
            hits.push(pos)
          }
        })
        if (hits.length > 0) {
          setSelectedPositions(new Set(hits))
        }
      }

      marqueeRef.current = null
      setMarquee(null)
    }
    if (isDrawing && editor) {
      setIsDrawing(false)
      const points = drawPointsRef.current
      if (points.length < 2) {
        setDrawingPath('')
        return
      }

      // Calculate bounding box
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const p of points) {
        if (p.x < minX) minX = p.x
        if (p.y < minY) minY = p.y
        if (p.x > maxX) maxX = p.x
        if (p.y > maxY) maxY = p.y
      }
      const padding = 10
      minX -= padding; minY -= padding; maxX += padding; maxY += padding
      const width = maxX - minX
      const height = maxY - minY

      // Normalize points relative to bounding box origin
      const normalized = points.map(p => ({ x: p.x - minX, y: p.y - minY }))
      const pathData = pointsToSvgPath(normalized)

      // Insert without focus() to avoid scroll jumps that break pan/zoom
      const endPos = editor.state.doc.content.size
      editor.chain().insertContentAt(endPos, {
        type: 'drawingStroke',
        attrs: {
          pathData,
          strokeColor: drawColor,
          strokeWidth: drawWidth,
          x: Math.round(minX),
          y: Math.round(minY),
          viewBox: `0 0 ${Math.round(width)} ${Math.round(height)}`,
        },
      }).run()

      setDrawingPath('')
      drawPointsRef.current = []
    }
  }, [isPanning, isDrawing, editor, drawColor, drawWidth])

  const handleZoomIn = () => setZoom((z) => Math.min(z + 0.1, 3))
  const handleZoomOut = () => setZoom((z) => Math.max(z - 0.1, 0.25))
  const handleZoomReset = () => { setZoom(1); setPan({ x: 0, y: 0 }) }

  if (!editor) return null

  return (
    <BoardYjsProvider value={ydoc}>
    <BoardSelectionProvider editor={editor} selectedPositions={selectedPositions} setSelectedPositions={setSelectedPositions}>
    <div
      className="relative h-screen w-full overflow-hidden board-effect-shake-target"
      style={{
        backgroundColor: '#f8f8f8',
        backgroundImage: 'radial-gradient(circle, #d1d1d1 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }}
    >
      {/* Canvas viewport */}
      <div
        ref={canvasRef}
        className="h-full w-full relative"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        style={{
          cursor: toolMode === 'pan' || isPanning ? 'grab' : toolMode === 'draw' || activePlacement ? 'crosshair' : 'default',
        }}
      >
        <div
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
          }}
        >
          <EditorContent editor={editor} />
        </div>
        <RemoteCursors provider={provider} canvasRef={canvasRef} pan={pan} zoom={zoom} />

        {/* Marquee selection overlay */}
        {marquee && (
          <svg
            className="absolute inset-0 pointer-events-none z-30"
            style={{ width: '100%', height: '100%' }}
          >
            <rect
              x={Math.min(marquee.startX, marquee.currentX)}
              y={Math.min(marquee.startY, marquee.currentY)}
              width={Math.abs(marquee.currentX - marquee.startX)}
              height={Math.abs(marquee.currentY - marquee.startY)}
              fill="rgba(59, 130, 246, 0.1)"
              stroke="rgba(59, 130, 246, 0.5)"
              strokeWidth={1}
              strokeDasharray="4 2"
            />
          </svg>
        )}

        {/* Placement cursor indicator */}
        {activePlacement && mousePos && (() => {
          const Icon = activePlacement.icon
          return (
            <div
              className="absolute pointer-events-none z-30"
              style={{
                left: mousePos.x + 16,
                top: mousePos.y + 16,
              }}
            >
              <div className="flex items-center gap-1.5 rounded-full bg-neutral-800 pl-1.5 pr-2.5 py-1 shadow-lg">
                <div className="w-5 h-5 rounded-full bg-white/15 flex items-center justify-center">
                  <Icon size={11} weight="bold" className="text-white" />
                </div>
                <span className="text-[11px] font-medium text-white/90 select-none whitespace-nowrap">
                  {activePlacement.label}
                </span>
              </div>
            </div>
          )
        })()}

        {/* Live drawing overlay */}
        {isDrawing && drawingPath && (
          <svg
            className="absolute inset-0 pointer-events-none z-30"
            style={{ width: '100%', height: '100%' }}
          >
            <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
              <path
                d={drawingPath}
                stroke={drawColor}
                strokeWidth={drawWidth / zoom}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          </svg>
        )}
      </div>

      {/* Top bar: back + logo + title */}
      <div className="board-enter-top">
        <BoardTopBar
          boardName={board.name}
          orgslug={orgslug}
        />
      </div>

      {/* Top right: avatars + clock + timer + share */}
      <div className="board-enter-top">
        <BoardTopRight
          provider={provider}
          ydoc={ydoc}
        />
      </div>

      {/* Bottom toolbar: logo, tools, undo/redo */}
      <BoardToolbar
        toolMode={toolMode}
        onToolModeChange={setToolMode}
        editor={editor}
        drawColor={drawColor}
        drawWidth={drawWidth}
        onDrawColorChange={setDrawColor}
        onDrawWidthChange={setDrawWidth}
      />

      {/* Bottom right stack: effects → chat → zoom */}
      <div className="absolute bottom-5 right-5 z-20 flex flex-col items-end gap-1.5 pointer-events-none board-enter-delayed">
        {/* Ephemeral Chat */}
        <EphemeralChat ydoc={ydoc} provider={provider} />

        {/* Live Effects */}
        <BoardEffects ydoc={ydoc} provider={provider} />

        {/* Zoom controls */}
        <BoardZoomControls
          zoom={zoom}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onZoomReset={handleZoomReset}
        />
      </div>

      {/* Feedback button — bottom left */}
      <button
        onClick={() => setFeedbackOpen(true)}
        className="absolute bottom-5 left-5 z-20 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-neutral-500 hover:text-neutral-700 nice-shadow transition-colors board-enter-delayed"
        style={{
          background: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <MessageCircle size={14} />
        Feedback
      </button>
      <FeedbackModal
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
        userName={username}
      />
    </div>
    </BoardSelectionProvider>
    </BoardYjsProvider>
  )
}

/** Outer component — handles Yjs lifecycle, only renders editor once ready */
export default function BoardCanvas({ board, accessToken, orgslug, username }: BoardCanvasProps) {
  const [ydoc, setYdoc] = useState<Y.Doc | null>(null)
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null)

  useEffect(() => {
    const doc = new Y.Doc()
    const prov = new HocuspocusProvider({
      url: getCollabUrl(),
      name: `board:${board.board_uuid}`,
      document: doc,
      token: accessToken,
    })

    setYdoc(doc)
    setProvider(prov)

    return () => {
      prov.destroy()
      doc.destroy()
    }
  }, [board.board_uuid, accessToken])

  if (!ydoc || !provider) return null

  return (
    <BoardEditorInner
      board={board}
      orgslug={orgslug}
      username={username}
      accessToken={accessToken}
      ydoc={ydoc}
      provider={provider}
    />
  )
}
