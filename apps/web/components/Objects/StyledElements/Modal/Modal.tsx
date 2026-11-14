'use client'

import React from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from '@phosphor-icons/react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@components/ui/dialog"
import { cn } from "@/lib/utils"
import { buttonClass } from "@components/Dashboard/Shared/DashKit/buttons"

type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full'

type ModalParams = {
  dialogTitle?: React.ReactNode
  dialogDescription?: React.ReactNode
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
  noPadding?: boolean
  /** Icon tile shown before the title. */
  icon?: React.ReactNode
  /** Shows a back arrow in place of the icon, for multi-step flows. */
  onBack?: () => void
  /** Extra controls on the end side of the header, before the close button. */
  headerActions?: React.ReactNode
  /** Footer pinned under the scrolling body (buttons, hints). */
  footer?: React.ReactNode
  /** Max-width preset. Leave unset to size to the content as before. */
  size?: ModalSize
  /** Blocks Escape, outside clicks and the close button, e.g. while saving. */
  preventClose?: boolean
  /** Close when the backdrop is clicked. Defaults to true. */
  closeOnOutsideClick?: boolean
  className?: string
}

const MIN_HEIGHT: Record<string, string> = {
  sm: 'md:min-h-[300px]',
  md: 'md:min-h-[500px]',
  lg: 'md:min-h-[700px]',
  xl: 'md:min-h-[900px]',
}

const MIN_WIDTH: Record<string, string> = {
  sm: 'md:min-w-[600px]',
  md: 'md:min-w-[800px]',
  lg: 'md:min-w-[1000px]',
  xl: 'md:min-w-[1200px]',
}

const SIZE: Record<ModalSize, string> = {
  sm: 'md:w-[440px]',
  md: 'md:w-[600px]',
  lg: 'md:w-[800px]',
  xl: 'md:w-[1040px]',
  full: 'md:w-[92vw] md:h-[90vh]',
}

const Modal = (params: ModalParams) => {
  const { t } = useTranslation()
  const { preventClose, closeOnOutsideClick = true } = params

  const hasFooter = params.footer || params.dialogClose || params.addDefCloseButton
  const hasHeader = params.dialogTitle || params.onBack || params.icon

  const handleOpenChange = (open: boolean) => {
    if (!open && preventClose) return
    params.onOpenChange(open)
  }

  return (
    <Dialog open={params.isDialogOpen} onOpenChange={handleOpenChange}>
      {params.dialogTrigger && (
        <DialogTrigger asChild>{params.dialogTrigger}</DialogTrigger>
      )}
      <DialogContent
        onInteractOutside={(e) => {
          if (preventClose || !closeOnOutsideClick) e.preventDefault()
        }}
        onEscapeKeyDown={(e) => {
          if (preventClose) e.preventDefault()
        }}
        hideClose={preventClose}
        className={cn(
          "flex flex-col",
          "w-[95vw] max-w-[95vw] max-h-[90vh]",
          "p-0 overflow-hidden",
          "sm:w-[90vw] sm:max-w-[90vw]",
          "md:w-auto md:max-w-[90vw] lg:max-w-[85vw] xl:max-w-[80vw]",
          params.size && SIZE[params.size],
          params.minHeight && MIN_HEIGHT[params.minHeight],
          params.minWidth && MIN_WIDTH[params.minWidth],
          params.customHeight,
          params.customWidth,
          params.className
        )}
      >
        {hasHeader ? (
          <DialogHeader className="shrink-0 flex flex-row items-start gap-3 ps-5 pe-14 pt-5 pb-4 border-b border-neutral-100 text-start">
            {params.onBack ? (
              <button
                type="button"
                onClick={params.onBack}
                aria-label={t('common.back')}
                className="-ms-1 mt-px w-8 h-8 shrink-0 rounded-lg inline-flex items-center justify-center text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 transition-colors"
              >
                <ArrowLeft size={16} className="rtl:rotate-180" />
              </button>
            ) : (
              params.icon && (
                <span className="mt-px w-8 h-8 shrink-0 rounded-lg bg-neutral-100 text-neutral-700 inline-flex items-center justify-center">
                  {params.icon}
                </span>
              )
            )}
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-lg font-semibold tracking-tight text-neutral-900 leading-8">
                {params.dialogTitle}
              </DialogTitle>
              {params.dialogDescription && (
                <DialogDescription className="text-sm text-neutral-500 leading-snug">
                  {params.dialogDescription}
                </DialogDescription>
              )}
            </div>
            {params.headerActions && <div className="flex items-center gap-2 shrink-0">{params.headerActions}</div>}
          </DialogHeader>
        ) : (
          <DialogTitle className="sr-only">{t('modal.dialog')}</DialogTitle>
        )}

        <div
          className={cn(
            "flex-1 min-h-0 overflow-y-auto overscroll-contain scrollbar-thin scrollbar-thumb-gray-200 scrollbar-track-transparent hover:scrollbar-thumb-gray-300",
            !params.noPadding && "p-5"
          )}
        >
          {params.dialogContent}
        </div>

        {hasFooter && (
          <DialogFooter className="shrink-0 px-5 py-3 border-t border-neutral-100 bg-neutral-50/60 flex flex-row items-center justify-end gap-2 sm:space-x-0">
            {params.footer}
            {params.dialogClose}
            {params.addDefCloseButton && (
              <button
                type="button"
                onClick={() => handleOpenChange(false)}
                className={buttonClass('primary', 'md')}
              >
                {t('common.close')}
              </button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default Modal
