'use client'

import React, { Suspense, lazy } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@components/ui/popover'

const Picker = lazy(() => import('@emoji-mart/react'))

// Bundled data: the default fetches it from a CDN at runtime.
const loadData = async () => (await import('@emoji-mart/data')).default

export function EmojiPickerPanel({ onPick }: { onPick: (emoji: string) => void }) {
  return (
    <Suspense fallback={<div className="w-[352px] h-[435px] animate-pulse bg-gray-50 rounded-xl" />}>
      <Picker
        data={loadData}
        theme="light"
        previewPosition="none"
        skinTonePosition="search"
        maxFrequentRows={2}
        autoFocus
        onEmojiSelect={(e: any) => onPick(e.native)}
      />
    </Suspense>
  )
}

export default function EmojiPickerPopover({
  children,
  onPick,
  open,
  onOpenChange,
  side = 'top',
  align = 'end',
}: {
  children: React.ReactNode
  onPick: (emoji: string) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent side={side} align={align} className="w-auto p-0 border-0 bg-transparent shadow-none">
        <div className="rounded-lg overflow-hidden nice-shadow">
          <EmojiPickerPanel onPick={onPick} />
        </div>
      </PopoverContent>
    </Popover>
  )
}
