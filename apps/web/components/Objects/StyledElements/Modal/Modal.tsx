'use client'

import React from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@components/ui/dialog"
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
        // Base styles
        "w-[95vw] max-w-[95vw]",
        "max-h-[90vh]",
        "bg-white",
        "border border-gray-200/80",
        "shadow-xl shadow-black/5",
        // Padding
        "p-0",
        // Mobile-first responsive design
        "sm:w-[90vw] sm:max-w-[90vw]",
        "md:w-auto md:max-w-[90vw]",
        "lg:max-w-[85vw]",
        "xl:max-w-[80vw]",
        // Dynamic sizing
        getMinHeight(),
        getMinWidth(),
        params.customHeight,
        params.customWidth
      )}>
        {/* Header Section - Always render DialogTitle for accessibility */}
        {params.dialogTitle ? (
          <DialogHeader className="px-5 sm:px-6 py-3 bg-gray-50 shadow-sm">
            <DialogTitle className="text-xl sm:text-2xl font-semibold text-gray-900 leading-tight">
              {params.dialogTitle}
            </DialogTitle>
            {params.dialogDescription && (
              <DialogDescription className="text-base text-gray-500 leading-tight">
                {params.dialogDescription}
              </DialogDescription>
            )}
          </DialogHeader>
        ) : (
          <DialogTitle className="sr-only">Dialog</DialogTitle>
        )}

        {/* Content Section */}
        <div className={cn(
          "overflow-y-auto scrollbar-thin scrollbar-thumb-gray-200 scrollbar-track-transparent hover:scrollbar-thumb-gray-300",
          "px-5 sm:px-6 py-4",
          params.dialogTitle ? "max-h-[calc(90vh-140px)]" : "max-h-[calc(90vh-80px)]"
        )}>
          {params.dialogContent}
        </div>

        {/* Footer Section */}
        {(params.dialogClose || params.addDefCloseButton) && (
          <DialogFooter className="px-5 sm:px-6 py-4 border-t border-gray-100 bg-gray-50/50 flex flex-col sm:flex-row gap-2 sm:gap-3">
            {params.dialogClose}
            {params.addDefCloseButton && (
              <button
                type="button"
                onClick={() => params.onOpenChange(false)}
                aria-label="Close modal"
                className="inline-flex items-center justify-center px-5 py-2.5 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-colors"
              >
                Close
              </button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default Modal
