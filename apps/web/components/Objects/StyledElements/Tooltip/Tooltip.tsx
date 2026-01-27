'use client'
import React from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { styled, keyframes } from '@stitches/react'

type TooltipProps = {
  sideOffset?: number
  content: React.ReactNode
  children: React.ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left' // default is bottom
  slateBlack?: boolean
  unstyled?: boolean // new prop to remove default styling
}

const ToolTip = (props: TooltipProps) => {
  return (
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{props.children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <TooltipContent
            slateBlack={props.slateBlack}
            unstyled={props.unstyled}
            side={props.side ? props.side : 'top'}
            sideOffset={props.sideOffset ?? 6}
          >
            {props.content}
          </TooltipContent>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}

const slideUpAndFade = keyframes({
  '0%': { opacity: 0, transform: 'translateY(2px)' },
  '100%': { opacity: 1, transform: 'translateY(0)' },
})

const slideRightAndFade = keyframes({
  '0%': { opacity: 0, transform: 'translateX(-2px)' },
  '100%': { opacity: 1, transform: 'translateX(0)' },
})

const slideDownAndFade = keyframes({
  '0%': { opacity: 0, transform: 'translateY(-2px)' },
  '100%': { opacity: 1, transform: 'translateY(0)' },
})

const slideLeftAndFade = keyframes({
  '0%': { opacity: 0, transform: 'translateX(2px)' },
  '100%': { opacity: 1, transform: 'translateX(0)' },
})

const closeAndFade = keyframes({
  '0%': { opacity: 1 },
  '100%': { opacity: 0 },
})

const TooltipContent = styled(Tooltip.Content, {
  variants: {
    slateBlack: {
      true: {
        backgroundColor: ' #0d0d0d',
        color: 'white',
      },
    },
    unstyled: {
      true: {
        padding: 0,
        backgroundColor: 'transparent',
        boxShadow: 'none',
        borderRadius: 0,
        fontSize: 'inherit',
        lineHeight: 'inherit',
        color: 'inherit',
        outline: 'none',
      },
    },
  },

  borderRadius: 6,
  padding: '5px 10px',
  fontSize: 11,
  fontWeight: 500,
  lineHeight: 1,
  color: '#4b5563',
  backgroundColor: 'rgba(255, 255, 255, 0.95)',
  zIndex: 'var(--z-tooltip)',
  boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.08), 0 4px 6px -4px rgba(0, 0, 0, 0.05)',
  outline: '1px solid rgba(0, 0, 0, 0.06)',
  userSelect: 'none',
  animationDuration: '200ms',
  animationTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
  willChange: 'transform, opacity',
  '&[data-state="delayed-open"]': {
    '&[data-side="top"]': { animationName: slideDownAndFade },
    '&[data-side="right"]': { animationName: slideLeftAndFade },
    '&[data-side="bottom"]': { animationName: slideUpAndFade },
    '&[data-side="left"]': { animationName: slideRightAndFade },
  },

  // closing animation
  '&[data-state="closed"]': {
    '&[data-side="top"]': { animationName: closeAndFade },
    '&[data-side="right"]': { animationName: closeAndFade },
    '&[data-side="bottom"]': { animationName: closeAndFade },
    '&[data-side="left"]': { animationName: closeAndFade },
  },
})

export default ToolTip
