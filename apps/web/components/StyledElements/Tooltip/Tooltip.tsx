'use client';
import React from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { styled, keyframes } from '@stitches/react';


type TooltipProps = {
  sideOffset?: number;
  content: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left'; // default is bottom 
  slateBlack?: boolean;
};

const ToolTip = (props: TooltipProps) => {

  return (
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          {props.children}
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <TooltipContent slateBlack={props.slateBlack} side={props.side ? props.side : 'bottom'} sideOffset={props.sideOffset}>
            {props.content}
          </TooltipContent>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
};

const slideUpAndFade = keyframes({
  '0%': { opacity: 0, transform: 'translateY(2px)' },
  '100%': { opacity: 1, transform: 'translateY(0)' },
});

const slideRightAndFade = keyframes({
  '0%': { opacity: 0, transform: 'translateX(-2px)' },
  '100%': { opacity: 1, transform: 'translateX(0)' },
});

const slideDownAndFade = keyframes({
  '0%': { opacity: 0, transform: 'translateY(-2px)' },
  '100%': { opacity: 1, transform: 'translateY(0)' },
});

const slideLeftAndFade = keyframes({
  '0%': { opacity: 0, transform: 'translateX(2px)' },
  '100%': { opacity: 1, transform: 'translateX(0)' },
});

const closeAndFade = keyframes({
  '0%': { opacity: 1 },
  '100%': { opacity: 0 },
});

const TooltipContent = styled(Tooltip.Content, {

  variants: {
    slateBlack: {
      true: {
        backgroundColor: " #0d0d0d",
        color: 'white',
      },
    },
  },

  borderRadius: 4,
  padding: '5px 10px',
  fontSize: 12,
  lineHeight: 1,
  color: "black",
  backgroundColor: 'rgba(217, 217, 217, 0.50)',
  zIndex: 500,
  boxShadow: 'hsl(206 22% 7% / 35%) 0px 10px 38px -10px, hsl(206 22% 7% / 20%) 0px 10px 20px -15px',
  userSelect: 'none',
  animationDuration: '400ms',
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
});



export default ToolTip;