'use client'
import React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle, Info } from 'lucide-react'

type ModalParams = {
  confirmationMessage: string
  confirmationButtonText: string
  dialogTitle: string
  functionToExecute: any
  dialogTrigger?: React.ReactNode
  status?: 'warning' | 'info'
  buttonid?: string
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
        <Dialog.Overlay className="fixed inset-0 bg-black/70 z-[var(--z-modal-backdrop)] data-[state=open]:animate-[overlayShow_150ms_cubic-bezier(0.16,1,0.3,1)] data-[state=closed]:animate-[overlayClose_150ms_cubic-bezier(0.16,1,0.3,1)]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[var(--z-modal)] bg-white rounded-[18px] shadow-[hsl(206_22%_7%/35%)_0px_10px_38px_-10px,hsl(206_22%_7%/20%)_0px_10px_20px_-15px] w-auto min-w-[500px] max-w-[600px] max-h-[85vh] p-6 overflow-visible outline-none transition-[max-height] duration-300 ease-out data-[state=open]:animate-[contentShow_150ms_cubic-bezier(0.16,1,0.3,1)] data-[state=closed]:animate-[contentClose_150ms_cubic-bezier(0.16,1,0.3,1)]">
          <Dialog.Title className="sr-only">{params.dialogTitle}</Dialog.Title>
          <div className="flex space-x-4 tracking-tight">
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
            <div className="text pt-1 space-x-0 w-auto grow">
              <div className="text-xl font-bold text-black">
                {params.dialogTitle}
              </div>
              <div className="text-md text-gray-500 leading-tight mt-1">
                {params.confirmationMessage}
              </div>
              <div className="flex flex-row-reverse mt-4">
                <div
                  id={params.buttonid}
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export default ConfirmationModal
