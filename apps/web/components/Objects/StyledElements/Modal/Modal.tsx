'use client'

import React from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@components/ui/dialog"
import { ButtonBlack } from '../Form/Form'
import { cn } from "@/lib/utils"

type ModalParams = {
  dialogTitle?: string
  dialogDescription?: string
  dialogContent: React.ReactNode
  dialogClose?: React.ReactNode | null
  dialogTrigger?: React.ReactNode
  addDefCloseButton?: boolean
  onOpenChange: (open: boolean) => void
  isDialogOpen?: boolean
  minHeight?: 'sm' | 'md' | 'lg' | 'xl' | 'no-min'
  minWidth?: 'sm' | 'md' | 'lg' | 'xl' | 'no-min'
  customHeight?: string
  customWidth?: string
}

const Modal = (params: ModalParams) => {
  const getMinHeight = () => {
    switch (params.minHeight) {
      case 'sm': return 'min-h-[300px] max-h-[90vh]'
      case 'md': return 'min-h-[400px] max-h-[90vh]'
      case 'lg': return 'min-h-[500px] max-h-[90vh]'
      case 'xl': return 'min-h-[600px] max-h-[90vh]'
      default: return 'max-h-[90vh]'
    }
  }

  const getMinWidth = () => {
    switch (params.minWidth) {
      case 'sm': return 'w-[95vw] sm:w-[90vw] md:w-[600px]'
      case 'md': return 'w-[95vw] sm:w-[90vw] md:w-[800px]'
      case 'lg': return 'w-[95vw] sm:w-[90vw] lg:w-[1000px]'
      case 'xl': return 'w-[95vw] sm:w-[90vw] xl:w-[1200px]'
      default: return 'w-[95vw] sm:w-[90vw]'
    }
  }

  return (
    <Dialog open={params.isDialogOpen} onOpenChange={params.onOpenChange}>
      {params.dialogTrigger && (
        <DialogTrigger asChild>{params.dialogTrigger}</DialogTrigger>
      )}
      <DialogContent className={cn(
        "overflow-auto mx-auto",
        "p-4 md:p-6",
        getMinHeight(),
        getMinWidth(),
        params.customHeight,
        params.customWidth
      )}>
        {params.dialogTitle && params.dialogDescription && (
          <DialogHeader className="text-center flex flex-col space-y-0.5 w-full">
            <DialogTitle>{params.dialogTitle}</DialogTitle>
            <DialogDescription>{params.dialogDescription}</DialogDescription>
          </DialogHeader>
        )}
        <div className="overflow-auto">
          {params.dialogContent}
        </div>
        {(params.dialogClose || params.addDefCloseButton) && (
          <DialogFooter>
            {params.dialogClose}
            {params.addDefCloseButton && (
              <ButtonBlack type="submit">
                Close
              </ButtonBlack>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default Modal
