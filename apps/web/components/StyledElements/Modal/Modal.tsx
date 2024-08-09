'use client'
import React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { styled, keyframes } from '@stitches/react'
import { blackA, mauve } from '@radix-ui/colors'
import { ButtonBlack } from '../Form/Form'

type ModalParams = {
  dialogTitle?: string
  dialogDescription?: string
  dialogContent: React.ReactNode
  dialogClose?: React.ReactNode | null
  dialogTrigger?: React.ReactNode
  addDefCloseButton?: boolean
  onOpenChange: any
  isDialogOpen?: boolean
  minHeight?: 'sm' | 'md' | 'lg' | 'xl' | 'no-min'
  minWidth?: 'sm' | 'md' | 'lg' | 'xl' | 'no-min'
  customHeight?: string
  customWidth?: string
}

const Modal = (params: ModalParams) => (
  <Dialog.Root open={params.isDialogOpen} onOpenChange={params.onOpenChange}>
    {params.dialogTrigger ? (
      <Dialog.Trigger asChild>{params.dialogTrigger}</Dialog.Trigger>
    ) : null}

    <Dialog.Portal>
      <DialogOverlay />
      <DialogContent
        className="overflow-auto scrollbar-w-2 scrollbar-h-2 scrollbar scrollbar-thumb-black/20 scrollbar-thumb-rounded-full scrollbar-track-rounded-full"
        minHeight={params.minHeight}
        minWidth={params.minWidth}
        
      >
        {params.dialogTitle && params.dialogDescription &&
          <DialogTopBar className="-space-y-1">
            <DialogTitle>{params.dialogTitle}</DialogTitle>
            <DialogDescription>{params.dialogDescription}</DialogDescription>
          </DialogTopBar>
        }
        {params.dialogContent}
        {params.dialogClose ? (
          <Flex css={{ marginTop: 25, justifyContent: 'flex-end' }}>
            <Dialog.Close asChild>{params.dialogClose}</Dialog.Close>
          </Flex>
        ) : null}
        {params.addDefCloseButton ? (
          <Flex css={{ marginTop: 25, justifyContent: 'flex-end' }}>
            <Dialog.Close asChild>
              <ButtonBlack type="submit" css={{ marginTop: 10 }}>
                Close
              </ButtonBlack>
            </Dialog.Close>
          </Flex>
        ) : null}
      </DialogContent>
    </Dialog.Portal>
  </Dialog.Root>
)

const overlayShow = keyframes({
  '0%': { opacity: 0 },
  '100%': { opacity: 1 },
})

const overlayClose = keyframes({
  '0%': { opacity: 1 },
  '100%': { opacity: 0 },
})

const contentShow = keyframes({
  '0%': { opacity: 0, transform: 'translate(-50%, -50%) scale(.96)' },
  '100%': { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
})

const contentClose = keyframes({
  '0%': { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
  '100%': { opacity: 0, transform: 'translate(-50%, -52%) scale(.96)' },
})

const DialogOverlay = styled(Dialog.Overlay, {
  backgroundColor: blackA.blackA9,
  backdropFilter: 'blur(0.6px)',
  position: 'fixed',
  zIndex: 500,
  inset: 0,
  animation: `${overlayShow} 150ms cubic-bezier(0.16, 1, 0.3, 1)`,
  '&[data-state="closed"]': {
    animation: `${overlayClose} 150ms cubic-bezier(0.16, 1, 0.3, 1)`,
  },
})

const DialogContent = styled(Dialog.Content, {
  variants: {
    minHeight: {
      'no-min': {
        minHeight: '0px',
      },
      sm: {
        minHeight: '300px',
      },
      md: {
        minHeight: '500px',
      },
      lg: {
        minHeight: '700px',
      },
      xl: {
        minHeight: '900px',
      },
    },
    minWidth: {
      'no-min': {
        minWidth: '0px',
      },
      sm: {
        minWidth: '600px',
      },
      md: {
        minWidth: '800px',
      },
      lg: {
        minWidth: '1000px',
      },
      xl: {
        minWidth: '1200px',
      },
    },
  },

  backgroundColor: 'white',
  borderRadius: 18,
  zIndex: 501,
  boxShadow:
    'hsl(206 22% 7% / 35%) 0px 10px 38px -10px, hsl(206 22% 7% / 20%) 0px 10px 20px -15px',
  position: 'fixed',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: '90vw',
  maxHeight: '85vh',
  minHeight: '300px',
  maxWidth: '600px',
  padding: 11,
  animation: `${contentShow} 150ms cubic-bezier(0.16, 1, 0.3, 1)`,
  '&:focus': { outline: 'none' },

  '&[data-state="closed"]': {
    animation: `${contentClose} 150ms cubic-bezier(0.16, 1, 0.3, 1)`,
  },
  transition: 'max-height 0.3s ease-out',
})

const DialogTopBar = styled('div', {
  background: '#F7F7F7',
  padding: '8px 14px ',
  borderRadius: 14,
})
const DialogTitle = styled(Dialog.Title, {
  margin: 0,
  fontWeight: 700,
  letterSpacing: '-0.05em',
  padding: 0,
  color: mauve.mauve12,
  fontSize: 21,
})

const DialogDescription = styled(Dialog.Description, {
  color: mauve.mauve11,
  letterSpacing: '-0.03em',
  fontSize: 15,
  padding: 0,
  margin: 0,
})

const Flex = styled('div', { display: 'flex' })

export default Modal
