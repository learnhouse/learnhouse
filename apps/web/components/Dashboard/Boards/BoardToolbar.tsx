'use client'

import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Link from 'next/link'
import Image from 'next/image'
import {
  Cursor,
  Hand,
  PencilSimple,
  Square,
  YoutubeLogo,
  Sparkle,
  BookOpen,
  Code,
  Globe,
  Smiley,
  Note,
  FrameCorners,
  ArrowCounterClockwise,
  ArrowClockwise,
  CheckSquare,
  Headphones,
} from '@phosphor-icons/react'
import { DividerVerticalIcon } from '@radix-ui/react-icons'
import * as Popover from '@radix-ui/react-popover'
import { cn } from '@/lib/utils'
import type { Editor } from '@tiptap/core'
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'

type ToolMode = 'select' | 'pan' | 'draw' | 'card' | 'youtube' | 'playground' | 'activity' | 'embed' | 'webpage' | 'sticker' | 'frame' | 'note' | 'todo' | 'podcast'

interface BoardToolbarProps {
  toolMode: ToolMode
  onToolModeChange: (mode: ToolMode) => void
  editor: Editor
  drawColor: string
  drawWidth: number
  onDrawColorChange: (color: string) => void
  onDrawWidthChange: (width: number) => void
}

const DRAW_COLORS = [
  '#000000', '#EF4444', '#3B82F6', '#22C55E',
  '#F97316', '#A855F7', '#EC4899', '#9CA3AF',
]

const DRAW_WIDTHS = [
  { label: 'boards.toolbar.thin', value: 1 },
  { label: 'boards.toolbar.medium', value: 3 },
  { label: 'boards.toolbar.thick', value: 6 },
]

const tools = [
  { mode: 'select' as const, icon: Cursor, label: 'boards.toolbar.select', colorClass: '' },
  { mode: 'pan' as const, icon: Hand, label: 'boards.toolbar.pan', colorClass: '' },
  { mode: 'draw' as const, icon: PencilSimple, label: 'boards.toolbar.draw', colorClass: 'editor-tool-btn-interactive' },
  { mode: 'card' as const, icon: Square, label: 'boards.toolbar.add_card', colorClass: 'editor-tool-btn-info' },
  { mode: 'frame' as const, icon: FrameCorners, label: 'boards.toolbar.frame', colorClass: 'editor-tool-btn-info' },
  { mode: 'note' as const, icon: Note, label: 'boards.toolbar.note', colorClass: 'editor-tool-btn-warning' },
  { mode: 'todo' as const, icon: CheckSquare, label: 'boards.toolbar.todo', colorClass: 'editor-tool-btn-info' },
  { mode: 'sticker' as const, icon: Smiley, label: 'boards.toolbar.sticker', colorClass: 'editor-tool-btn-warning' },
  { mode: 'youtube' as const, icon: YoutubeLogo, label: 'boards.toolbar.youtube', colorClass: 'editor-tool-btn-interactive' },
  { mode: 'playground' as const, icon: Sparkle, label: 'boards.toolbar.ai_playground', colorClass: 'editor-tool-btn-tip' },
  { mode: 'activity' as const, icon: BookOpen, label: 'boards.toolbar.activity', colorClass: 'editor-tool-btn-info' },
  { mode: 'embed' as const, icon: Code, label: 'boards.toolbar.embed', colorClass: 'editor-tool-btn-interactive' },
  { mode: 'webpage' as const, icon: Globe, label: 'boards.toolbar.webpage', colorClass: 'editor-tool-btn-info' },
  { mode: 'podcast' as const, icon: Headphones, label: 'boards.toolbar.podcast', colorClass: 'editor-tool-btn-tip' },
]

export default function BoardToolbar({
  toolMode,
  onToolModeChange,
  editor,
  drawColor,
  drawWidth,
  onDrawColorChange,
  onDrawWidthChange,
}: BoardToolbarProps) {
  const { t } = useTranslation()
  const [drawPopoverOpen, setDrawPopoverOpen] = useState(false)

  return (
    <div
      className="absolute bottom-5 start-1/2 z-20 flex items-center gap-[7px] rounded-[15px] px-3 py-2.5 nice-shadow board-enter-toolbar"
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
      {tools.map(({ mode, icon: Icon, label, colorClass }) => {
        if (mode === 'draw') {
          return (
            <Popover.Root
              key={mode}
              open={drawPopoverOpen}
              onOpenChange={setDrawPopoverOpen}
            >
              <ToolTip content={t(label)}>
                <Popover.Trigger asChild>
                  <div
                    onClick={() => {
                      onToolModeChange('draw')
                      setDrawPopoverOpen(true)
                    }}
                    className={cn(
                      'editor-tool-btn',
                      toolMode === 'draw' ? 'is-active' : colorClass
                    )}
                  >
                    <Icon size={15} weight="duotone" />
                  </div>
                </Popover.Trigger>
              </ToolTip>
              <Popover.Portal>
                <Popover.Content
                  side="top"
                  sideOffset={12}
                  className="rounded-xl px-3 py-2.5 nice-shadow z-50"
                  style={{
                    background: 'rgba(255, 255, 255, 0.97)',
                    backdropFilter: 'blur(12px)',
                    WebkitBackdropFilter: 'blur(12px)',
                  }}
                  onOpenAutoFocus={(e) => e.preventDefault()}
                >
                  {/* Color palette */}
                  <div className="flex items-center gap-1.5 mb-2">
                    {DRAW_COLORS.map((color) => (
                      <button
                        key={color}
                        onClick={() => onDrawColorChange(color)}
                        className={cn(
                          'w-5 h-5 rounded-full border-2 transition-all hover:scale-110',
                          drawColor === color
                            ? 'border-blue-500 ring-2 ring-blue-200'
                            : 'border-neutral-200'
                        )}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                  {/* Stroke width */}
                  <div className="flex items-center gap-1.5">
                    {DRAW_WIDTHS.map(({ label: wLabel, value }) => (
                      <button
                        key={value}
                        onClick={() => onDrawWidthChange(value)}
                        className={cn(
                          'flex items-center justify-center h-7 px-2.5 rounded-lg text-[11px] font-medium transition-colors',
                          drawWidth === value
                            ? 'bg-neutral-800 text-white'
                            : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                        )}
                      >
                        <svg width="18" height="12" viewBox="0 0 18 12" className="me-1">
                          <line
                            x1="0" y1="6" x2="18" y2="6"
                            stroke="currentColor"
                            strokeWidth={value}
                            strokeLinecap="round"
                          />
                        </svg>
                        {t(wLabel)}
                      </button>
                    ))}
                  </div>
                  <Popover.Arrow
                    className="fill-white"
                    width={10}
                    height={5}
                  />
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          )
        }

        return (
          <ToolTip key={mode} content={t(label)}>
            <div
              onClick={() => onToolModeChange(mode)}
              className={cn(
                'editor-tool-btn',
                toolMode === mode ? 'is-active' : colorClass
              )}
            >
              <Icon size={15} weight="duotone" />
            </div>
          </ToolTip>
        )
      })}

      <DividerVerticalIcon style={{ color: 'grey', opacity: '0.5' }} />

      {/* Undo/Redo */}
      <ToolTip content={t('boards.toolbar.undo')}>
        <div
          onClick={() => editor.chain().focus().undo().run()}
          className={cn('editor-tool-btn', !editor.can().undo() && 'opacity-30 pointer-events-none')}
        >
          <ArrowCounterClockwise size={15} weight="duotone" />
        </div>
      </ToolTip>
      <ToolTip content={t('boards.toolbar.redo')}>
        <div
          onClick={() => editor.chain().focus().redo().run()}
          className={cn('editor-tool-btn', !editor.can().redo() && 'opacity-30 pointer-events-none')}
        >
          <ArrowClockwise size={15} weight="duotone" />
        </div>
      </ToolTip>
    </div>
  )
}
