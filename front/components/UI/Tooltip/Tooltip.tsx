import React from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { styled, keyframes } from '@stitches/react';
import { violet, blackA } from '@radix-ui/colors';
import { PlusIcon } from '@radix-ui/react-icons';


type TooltipParams = {
    sideOffset?: number;
    content: React.ReactNode;
    children: React.ReactNode;
};

const ToolTip = (params: TooltipParams) => {
  return (
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          {params.children}
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <TooltipContent side="bottom" sideOffset={params.sideOffset}>
            {params.content}
            <TooltipArrow />
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
  borderRadius: 4,
  padding: '5px 10px',
  fontSize: 12,
  lineHeight: 1,
  color:"black",
  backgroundColor: 'rgba(217, 217, 217, 0.50)',
  zIndex: 4,
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

const TooltipArrow = styled(Tooltip.Arrow, {
  fill: 'white',
  
});

const IconButton = styled('button', {
  all: 'unset',
  fontFamily: 'inherit',
  borderRadius: '100%',
  height: 35,
  width: 35,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: violet.violet11,
  backgroundColor: 'white',
  boxShadow: `0 2px 10px ${blackA.blackA7}`,
  '&:hover': { backgroundColor: violet.violet3 },
  '&:focus': { boxShadow: `0 0 0 2px black` },
});

export default ToolTip;