'use client'
import React from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'

type TooltipProps = {
  sideOffset?: number
  content: React.ReactNode
  children: React.ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  slateBlack?: boolean
  unstyled?: boolean
}

const ToolTip = (props: TooltipProps) => {
  return (
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{props.children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side={props.side ? props.side : 'top'}
            sideOffset={props.sideOffset ?? 6}
            className={
              props.unstyled
                ? 'z-[var(--z-tooltip)] data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-200'
                : `z-[var(--z-tooltip)] select-none will-change-[transform,opacity]
                  data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 duration-200
                  data-[side=top]:data-[state=delayed-open]:slide-in-from-bottom-0.5
                  data-[side=right]:data-[state=delayed-open]:slide-in-from-left-0.5
                  data-[side=bottom]:data-[state=delayed-open]:slide-in-from-top-0.5
                  data-[side=left]:data-[state=delayed-open]:slide-in-from-right-0.5
                  data-[state=closed]:animate-out data-[state=closed]:fade-out-0
                  rounded-md px-2.5 py-[5px] text-[11px] font-medium leading-none
                  shadow-[0_10px_15px_-3px_rgba(0,0,0,0.08),0_4px_6px_-4px_rgba(0,0,0,0.05)]
                  outline outline-1 outline-black/[0.06]
                  ${props.slateBlack
                    ? 'bg-[#0d0d0d] text-white'
                    : 'bg-white/95 text-gray-600'
                  }`
            }
          >
            {props.content}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}

export default ToolTip
