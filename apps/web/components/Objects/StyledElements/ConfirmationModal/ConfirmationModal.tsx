'use client'
import React from 'react'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
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
  const isWarning = params.status === 'warning'
  const iconColors = isWarning ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'
  const buttonColors = isWarning
    ? 'text-white bg-red-500 hover:bg-red-600'
    : 'text-white bg-blue-500 hover:bg-blue-600'

  const handleConfirm = React.useCallback(() => {
    params.functionToExecute()
    setIsDialogOpen(false)
  }, [params])

  return (
    <Modal
      isDialogOpen={isDialogOpen}
      onOpenChange={setIsDialogOpen}
      dialogTrigger={params.dialogTrigger}
      noPadding
      customWidth="sm:max-w-[600px] sm:min-w-[500px]"
      dialogContent={
        <div className="flex space-x-4 tracking-tight p-6 pr-10">
          <div className={`shrink-0 p-6 rounded-xl flex items-center ${iconColors}`}>
            {isWarning ? <AlertTriangle size={35} /> : <Info size={35} />}
          </div>
          <div className="pt-1 w-auto grow">
            <div className="text-xl font-bold text-black">{params.dialogTitle}</div>
            <div className="text-md text-gray-500 leading-tight mt-1">
              {params.confirmationMessage}
            </div>
            <div className="flex flex-row-reverse mt-4">
              <button
                type="button"
                id={params.buttonid}
                onClick={handleConfirm}
                className={`rounded-md text-sm px-3 py-2 font-bold flex justify-center items-center cursor-pointer ${buttonColors} hover:shadow-lg transition duration-300 ease-in-out`}
              >
                {params.confirmationButtonText}
              </button>
            </div>
          </div>
        </div>
      }
    />
  )
}

export default ConfirmationModal
