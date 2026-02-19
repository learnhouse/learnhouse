'use client'

import React from 'react'
import Link from 'next/link'
import Image from 'next/image'
import {
  MousePointer2,
  Hand,
  Pencil,
  Square,
  StickyNote,
  Youtube,
  Sparkles,
  BookOpen,
  Code,
  Globe,
  Undo2,
  Redo2,
} from 'lucide-react'
import { DividerVerticalIcon } from '@radix-ui/react-icons'
import { cn } from '@/lib/utils'
import type { Editor } from '@tiptap/core'
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'

type ToolMode = 'select' | 'pan' | 'draw' | 'card' | 'sticky' | 'youtube' | 'playground' | 'activity' | 'embed' | 'webpage'

interface BoardToolbarProps {
  toolMode: ToolMode
  onToolModeChange: (mode: ToolMode) => void
  editor: Editor
}

const tools = [
  { mode: 'select' as const, icon: MousePointer2, label: 'Select', colorClass: '' },
  { mode: 'pan' as const, icon: Hand, label: 'Pan', colorClass: '' },
  { mode: 'draw' as const, icon: Pencil, label: 'Draw', colorClass: 'editor-tool-btn-interactive' },
  { mode: 'card' as const, icon: Square, label: 'Add Card', colorClass: 'editor-tool-btn-info' },
  { mode: 'sticky' as const, icon: StickyNote, label: 'Sticky Note', colorClass: 'editor-tool-btn-warning' },
  { mode: 'youtube' as const, icon: Youtube, label: 'YouTube', colorClass: 'editor-tool-btn-interactive' },
  { mode: 'playground' as const, icon: Sparkles, label: 'Board Playground', colorClass: 'editor-tool-btn-tip' },
  { mode: 'activity' as const, icon: BookOpen, label: 'Activity', colorClass: 'editor-tool-btn-info' },
  { mode: 'embed' as const, icon: Code, label: 'Embed', colorClass: 'editor-tool-btn-interactive' },
  { mode: 'webpage' as const, icon: Globe, label: 'Webpage', colorClass: 'editor-tool-btn-info' },
]

export default function BoardToolbar({
  toolMode,
  onToolModeChange,
  editor,
}: BoardToolbarProps) {
  return (
    <div
      className="absolute bottom-5 left-1/2 -translate-x-1/2 z-20 flex items-center gap-[7px] rounded-[15px] px-3 py-2.5 nice-shadow"
      style={{
        background: 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
    >
      {/* Logo */}
      <Link href="/dash/boards">
        <div className="bg-black rounded-md w-[25px] h-[25px] flex items-center justify-center hover:opacity-80 transition-opacity">
          <Image
            src="/lrn.svg"
            alt="LearnHouse"
            width={14}
            height={14}
            className="invert"
          />
        </div>
      </Link>

      <DividerVerticalIcon style={{ color: 'grey', opacity: '0.5' }} />

      {/* Tool modes */}
      {tools.map(({ mode, icon: Icon, label, colorClass }) => (
        <ToolTip key={mode} content={label}>
          <div
            onClick={() => onToolModeChange(mode)}
            className={cn(
              'editor-tool-btn',
              toolMode === mode ? 'is-active' : colorClass
            )}
          >
            <Icon size={15} />
          </div>
        </ToolTip>
      ))}

      <DividerVerticalIcon style={{ color: 'grey', opacity: '0.5' }} />

      {/* Undo/Redo */}
      <ToolTip content="Undo">
        <div
          onClick={() => editor.chain().focus().undo().run()}
          className={cn('editor-tool-btn', !editor.can().undo() && 'opacity-30 pointer-events-none')}
        >
          <Undo2 size={15} />
        </div>
      </ToolTip>
      <ToolTip content="Redo">
        <div
          onClick={() => editor.chain().focus().redo().run()}
          className={cn('editor-tool-btn', !editor.can().redo() && 'opacity-30 pointer-events-none')}
        >
          <Redo2 size={15} />
        </div>
      </ToolTip>
    </div>
  )
}
