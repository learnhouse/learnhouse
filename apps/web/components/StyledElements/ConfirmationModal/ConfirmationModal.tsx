'use client'
import React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { styled, keyframes } from '@stitches/react'
import { blackA } from '@radix-ui/colors'
import { AlertTriangle, Info } from 'lucide-react'

type ModalParams = {
  confirmationMessage: string
  confirmationButtonText: string
  dialogTitle: string
  functionToExecute: any
  dialogTrigger?: React.ReactNode
  status?: 'warning' | 'info'
}

const ConfirmationModal = (params: ModalParams) => {
  const [isDialogOpen, setIsDialogOpen] = React.useState(false)
  const warningColors = 'bg-red-100 text-red-600'
  const infoColors = 'bg-blue-100 text-blue-600'
  const warningButtonColors = 'text-white bg-red-500 hover:bg-red-600'
  const infoButtonColors = 'text-white bg-blue-500 hover:bg-blue-600'

  const onOpenChange = React.useCallback(
    (open: any) => {
      setIsDialogOpen(open)
    },
    [setIsDialogOpen]
  )

  return (
    <Dialog.Root open={isDialogOpen} onOpenChange={onOpenChange}>
      {params.dialogTrigger ? (
        <Dialog.Trigger asChild>{params.dialogTrigger}</Dialog.Trigger>
      ) : null}

      <Dialog.Portal>
        <DialogOverlay />
        <DialogContent>
          <div className="h-26 flex space-x-4 tracking-tight">
            <div
              className={`icon p-6 rounded-xl flex items-center align-content-center ${
                params.status === 'warning' ? warningColors : infoColors
              }`}
            >
              {params.status === 'warning' ? (
                <AlertTriangle size={35} />
              ) : (
                <Info size={35} />
              )}
            </div>
            <div className="text pt-1 space-x-0 w-auto flex-grow">
              <div className="text-xl font-bold text-black ">
                {params.dialogTitle}
              </div>
              <div className="text-md text-gray-500 w-60 leading-tight">
                {params.confirmationMessage}
              </div>
              <div className="flex flex-row-reverse pt-2">
                <div
                  className={`rounded-md text-sm px-3 py-2 font-bold flex justify-center items-center hover:cursor-pointer ${
                    params.status === 'warning'
                      ? warningButtonColors
                      : infoButtonColors
                  }
                                hover:shadow-lg transition duration-300 ease-in-out
                                `}
                  onClick={() => {
                    params.functionToExecute()
                    setIsDialogOpen(false)
                  }}
                >
                  {params.confirmationButtonText}
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

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
  position: 'fixed',
  zIndex: 500,
  inset: 0,
  animation: `${overlayShow} 150ms cubic-bezier(0.16, 1, 0.3, 1)`,
  '&[data-state="closed"]': {
    animation: `${overlayClose} 150ms cubic-bezier(0.16, 1, 0.3, 1)`,
  },
})

const DialogContent = styled(Dialog.Content, {
  backgroundColor: 'white',
  borderRadius: 18,
  zIndex: 501,
  boxShadow:
    'hsl(206 22% 7% / 35%) 0px 10px 38px -10px, hsl(206 22% 7% / 20%) 0px 10px 20px -15px',
  position: 'fixed',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: 'auto',
  minWidth: '500px',
  overflow: 'hidden',
  height: 'auto',
  maxHeight: '85vh',
  maxWidth: '600px',
  padding: 11,
  animation: `${contentShow} 150ms cubic-bezier(0.16, 1, 0.3, 1)`,
  '&:focus': { outline: 'none' },

  '&[data-state="closed"]': {
    animation: `${contentClose} 150ms cubic-bezier(0.16, 1, 0.3, 1)`,
  },
  transition: 'max-height 0.3s ease-out',
})

export default ConfirmationModal
