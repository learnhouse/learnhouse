'use client'
import React, { useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Dialog, DialogContent, DialogTitle } from '@components/ui/dialog'
import { ArrowRight, PartyPopper } from 'lucide-react'
import 'github-markdown-css/github-markdown-light.css'

interface ThanksConfig {
  markdown?: string
  next_chapter_cta?: string
}

interface ThanksModalProps {
  config?: ThanksConfig
  nextHref?: string
  queryParam?: string
}

const ThanksModal: React.FC<ThanksModalProps> = ({ config, nextHref, queryParam = 'paid' }) => {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!config?.markdown) return
    if (searchParams?.get(queryParam) === '1') setOpen(true)
  }, [config?.markdown, searchParams, queryParam])

  const handleClose = () => {
    setOpen(false)
    // Strip the ?paid=1 so the modal doesn't re-open on refresh
    if (pathname && searchParams) {
      const params = new URLSearchParams(searchParams.toString())
      params.delete(queryParam)
      const query = params.toString()
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
    }
  }

  if (!config?.markdown) return null

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent className="flex flex-col w-[95vw] max-w-[95vw] sm:max-w-lg bg-white border border-gray-200 shadow-xl p-0 overflow-hidden rounded-2xl">
        <DialogTitle className="sr-only">Bienvenido al curso premium</DialogTitle>
        <div className="bg-gradient-to-br from-emerald-50 via-white to-indigo-50 p-6 md:p-8">
          <div className="inline-flex items-center gap-1.5 mb-4 px-3 py-1 rounded-full bg-white/80 text-xs font-semibold text-emerald-700 border border-emerald-100">
            <PartyPopper size={12} /> ¡Pago confirmado!
          </div>
          <div className="markdown-body max-w-none" style={{ backgroundColor: 'transparent' }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{config.markdown}</ReactMarkdown>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-6 py-4 bg-white border-t border-gray-100">
          <button
            type="button"
            onClick={handleClose}
            className="text-xs text-gray-500 hover:text-gray-900 px-3 py-2"
          >
            Cerrar
          </button>
          {nextHref && (
            <button
              type="button"
              onClick={() => { handleClose(); router.push(nextHref) }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-black text-white text-sm font-semibold hover:bg-gray-800 transition"
            >
              {config.next_chapter_cta || 'Continuar'} <ArrowRight size={14} />
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default ThanksModal
