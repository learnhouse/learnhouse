'use client'
import React from 'react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@components/ui/tooltip'
import { Keys } from './Kbd'

/**
 * Hover hint in the Linear style: the action's name with its keycaps. Wrap
 * any trigger; the child must forward refs (Link, button, a).
 */
export function ShortcutHint({
  label,
  keys,
  side = 'bottom',
  children,
}: {
  label: string
  keys: string
  side?: 'top' | 'bottom' | 'left' | 'right'
  children: React.ReactElement
}) {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side} className="flex items-center gap-2 text-xs">
          <span>{label}</span>
          <Keys keys={keys} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
