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
      case 'sm': return 'md:min-h-[300px]'
      case 'md': return 'md:min-h-[500px]'
      case 'lg': return 'md:min-h-[700px]'
      case 'xl': return 'md:min-h-[900px]'
      default: return ''
    }
  }

  const getMinWidth = () => {
    switch (params.minWidth) {
      case 'sm': return 'md:min-w-[600px]'
      case 'md': return 'md:min-w-[800px]'
      case 'lg': return 'md:min-w-[1000px]'
      case 'xl': return 'md:min-w-[1200px]'
      default: return ''
    }
  }

  return (
    <Dialog open={params.isDialogOpen} onOpenChange={params.onOpenChange}>
      {params.dialogTrigger && (
        <DialogTrigger asChild>{params.dialogTrigger}</DialogTrigger>
      )}
      <DialogContent className={cn(
        "w-[95vw] max-w-[95vw]",
        "max-h-[90vh]",
        "p-3 sm:p-4 md:p-6",
        // Mobile-first responsive design
        "sm:w-[90vw] sm:max-w-[90vw]",
        "md:w-auto md:max-w-[90vw]",
        "lg:max-w-[85vw]",
        "xl:max-w-[80vw]",
        getMinHeight(),
        getMinWidth(),
        params.customHeight,
        params.customWidth
      )}>
        {params.dialogTitle && params.dialogDescription && (
          <DialogHeader className="text-center flex flex-col space-y-0.5 w-full">
            <DialogTitle className="text-lg sm:text-xl md:text-2xl">{params.dialogTitle}</DialogTitle>
            <DialogDescription className="text-sm sm:text-base">{params.dialogDescription}</DialogDescription>
          </DialogHeader>
        )}
        <div className="overflow-y-auto max-h-[calc(90vh-120px)] scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent hover:scrollbar-thumb-gray-400">
          <div className="pr-2">
            {params.dialogContent}
          </div>
        </div>
        {(params.dialogClose || params.addDefCloseButton) && (
          <DialogFooter className="flex flex-col sm:flex-row gap-2 sm:gap-0">
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
