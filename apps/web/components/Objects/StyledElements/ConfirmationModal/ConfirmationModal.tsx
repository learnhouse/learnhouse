'use client'
import React from 'react'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { AlertTriangle, Info, Loader2 } from 'lucide-react'

type ModalParams = {
  confirmationMessage: string
  confirmationButtonText: string
  /** Label while the confirmed action runs. Defaults to the normal label. */
  pendingButtonText?: string
  dialogTitle: string
  functionToExecute: any
  dialogTrigger?: React.ReactNode
  status?: 'warning' | 'info'
  buttonid?: string
}

const ConfirmationModal = (params: ModalParams) => {
  const [isDialogOpen, setIsDialogOpen] = React.useState(false)
  const [isPending, setIsPending] = React.useState(false)
  const isWarning = params.status === 'warning'
  const iconColors = isWarning ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'
  const buttonColors = isWarning
    ? 'text-white bg-red-500 hover:bg-red-600'
    : 'text-white bg-blue-500 hover:bg-blue-600'

  // Confirmed actions can be slow — submitting an assignment saves every
  // pending answer and then grades it server-side. The modal used to close the
  // instant you clicked, leaving the user staring at an unchanged page with no
  // sign anything was happening, free to click through and fire it again. So
  // wait for the action: the button shows it is working and can't be clicked
  // twice, and the modal stays up until it finishes. `await` on a non-promise
  // is a no-op, so callers that pass a synchronous function behave as before.
  //
  // The modal always closes once the action settles, success or failure — many
  // confirm handlers report their own errors with a toast and never throw, and
  // the few that let a network error propagate previously still closed the
  // modal. Keeping it open on an unexpected throw would strand those on a modal
  // with no message, so close either way and let the handler's toast speak.
  const handleConfirm = React.useCallback(async () => {
    if (isPending) return
    setIsPending(true)
    try {
      await params.functionToExecute()
    } catch {
      // The confirmed action owns its own error reporting.
    } finally {
      setIsPending(false)
      setIsDialogOpen(false)
    }
  }, [params, isPending])

  return (
    <Modal
      isDialogOpen={isDialogOpen}
      // Don't let an outside click or Esc dismiss the modal mid-action: the
      // work is already in flight, and hiding it just recreates the "did that
      // do anything?" moment this pending state exists to remove.
      onOpenChange={(open: boolean) => {
        if (!open && isPending) return
        setIsDialogOpen(open)
      }}
      dialogTrigger={params.dialogTrigger}
      noPadding
      customWidth="sm:max-w-[600px] sm:min-w-[500px]"
      dialogContent={
        <div className="flex space-x-4 tracking-tight p-6 pe-10">
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
                disabled={isPending}
                aria-busy={isPending}
                className={`rounded-md text-sm px-3 py-2 font-bold flex justify-center items-center gap-2 ${buttonColors} hover:shadow-lg transition duration-300 ease-in-out ${
                  isPending ? 'opacity-70 cursor-wait' : 'cursor-pointer'
                }`}
              >
                {isPending && <Loader2 size={14} className="animate-spin" />}
                {isPending
                  ? params.pendingButtonText || params.confirmationButtonText
                  : params.confirmationButtonText}
              </button>
            </div>
          </div>
        </div>
      }
    />
  )
}

export default ConfirmationModal
