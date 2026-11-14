'use client'
import React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'
import { HBADGE, HICON, HMENU } from './headerStyles'

/**
 * An icon-only header button (tooltip + aria-label) that opens a small menu
 * (Radix popover, like the formatting toolbar's menus). `children` renders
 * the menu body and gets a `close` function.
 */
export default function HeaderMenu({
  icon,
  label,
  testId,
  width = 240,
  badge,
  children,
}: {
  icon: React.ReactNode
  label: string
  testId?: string
  width?: number
  badge?: React.ReactNode
  children: (_close: () => void) => React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <ToolTip content={label} side="bottom">
        <PopoverPrimitive.Trigger asChild>
          <button type="button" className={HICON} aria-label={label} data-testid={testId}>
            {icon}
            {badge ? <span className={HBADGE}>{badge}</span> : null}
          </button>
        </PopoverPrimitive.Trigger>
      </ToolTip>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={6}
          collisionPadding={8}
          style={{ zIndex: 'var(--z-editor-bubble, 60)', width }}
          className={`${HMENU} max-w-[calc(100vw-16px)]`}
        >
          {children(() => setOpen(false))}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
