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
import EphemeralChat from './EphemeralChat'
import { BoardCardExtension } from './Extensions/BoardCard'
import { StickyNoteExtension } from './Extensions/StickyNote'
import { DrawingStrokeExtension } from './Extensions/DrawingStroke'
import { YouTubeBlockExtension } from './Extensions/YouTubeBlock'
import { PlaygroundBlockExtension } from './Extensions/PlaygroundBlock'
import { ActivityBlockExtension } from './Extensions/ActivityBlock'
import { EmbedBlockExtension } from './Extensions/EmbedBlock'
import { WebpageBlockExtension } from './Extensions/WebpageBlock'
import RemoteCursors from './RemoteCursors'
import { Extension } from '@tiptap/core'
import { BoardYjsProvider } from './BoardYjsContext'


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
  const [toolMode, setToolMode] = useState<'select' | 'pan' | 'draw' | 'card' | 'sticky' | 'youtube' | 'playground' | 'activity' | 'embed' | 'webpage'>('select')
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })
  const [isDrawing, setIsDrawing] = useState(false)
  const drawPointsRef = useRef<{ x: number; y: number }[]>([])
  const [drawingPath, setDrawingPath] = useState('')
  const canvasRef = useRef<HTMLDivElement>(null)

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
        history: false, // Yjs handles undo/redo
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
      StickyNoteExtension,
      DrawingStrokeExtension,
      YouTubeBlockExtension,
      PlaygroundBlockExtension,
      ActivityBlockExtension,
      EmbedBlockExtension,
      WebpageBlockExtension,
    ],
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'board-editor outline-none min-h-[2000px] min-w-[3000px] relative',
      },
    },
  })

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
    if (toolMode === 'pan' || e.button === 1 || (e.button === 0 && e.shiftKey)) {
      setIsPanning(true)
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y })
      e.preventDefault()
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
    } else if (toolMode === 'sticky' && editor) {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      const x = (e.clientX - rect.left - pan.x) / zoom
      const y = (e.clientY - rect.top - pan.y) / zoom
      const stickyPos = editor.state.doc.content.size
      editor.chain().insertContentAt(stickyPos, {
        type: 'stickyNote',
        attrs: { x: Math.round(x), y: Math.round(y), color: 'yellow' },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Note' }] }],
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
    }
  }, [toolMode, pan, zoom, editor])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning) {
      setPan({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      })
    } else if (isDrawing) {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      const x = (e.clientX - rect.left - pan.x) / zoom
      const y = (e.clientY - rect.top - pan.y) / zoom
      drawPointsRef.current.push({ x, y })
      setDrawingPath(pointsToSvgPath(drawPointsRef.current))
    }
  }, [isPanning, panStart, isDrawing, pan, zoom])

  const handleMouseUp = useCallback(() => {
    if (isPanning) {
      setIsPanning(false)
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
          strokeColor: '#000000',
          strokeWidth: 2,
          x: Math.round(minX),
          y: Math.round(minY),
          viewBox: `0 0 ${Math.round(width)} ${Math.round(height)}`,
        },
      }).run()

      setDrawingPath('')
      drawPointsRef.current = []
    }
  }, [isPanning, isDrawing, editor])

  const handleZoomIn = () => setZoom((z) => Math.min(z + 0.1, 3))
  const handleZoomOut = () => setZoom((z) => Math.max(z - 0.1, 0.25))
  const handleZoomReset = () => { setZoom(1); setPan({ x: 0, y: 0 }) }

  if (!editor) return null

  return (
    <BoardYjsProvider value={ydoc}>
    <div
      className="relative h-screen w-full overflow-hidden"
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
          cursor: toolMode === 'pan' || isPanning ? 'grab' : (toolMode === 'draw' || toolMode === 'card' || toolMode === 'sticky' || toolMode === 'youtube' || toolMode === 'playground' || toolMode === 'activity' || toolMode === 'embed' || toolMode === 'webpage') ? 'crosshair' : 'default',
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

        {/* Live drawing overlay */}
        {isDrawing && drawingPath && (
          <svg
            className="absolute inset-0 pointer-events-none z-30"
            style={{ width: '100%', height: '100%' }}
          >
            <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
              <path
                d={drawingPath}
                stroke="#000000"
                strokeWidth={2 / zoom}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          </svg>
        )}
      </div>

      {/* Top bar: back, title, zoom, presence, share */}
      <BoardTopBar
        boardName={board.name}
        orgslug={orgslug}
        provider={provider}
        zoom={zoom}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onZoomReset={handleZoomReset}
      />

      {/* Bottom toolbar: logo, tools, undo/redo */}
      <BoardToolbar
        toolMode={toolMode}
        onToolModeChange={setToolMode}
        editor={editor}
      />

      {/* Ephemeral Chat */}
      <EphemeralChat ydoc={ydoc} provider={provider} />

      {/* Feedback button — bottom left */}
      <button
        onClick={() => setFeedbackOpen(true)}
        className="absolute bottom-5 left-5 z-20 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-neutral-500 hover:text-neutral-700 nice-shadow transition-colors"
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
