'use client'

import React from 'react'
import { FilePdf, ArrowSquareOut } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'

/**
 * Renders the FIRST PAGE of a PDF as a thumbnail image inside an
 * aspect-video preview area. Uses pdfjs-dist (lazy-imported on the client)
 * to render page 1 to a <canvas>.
 *
 * - Shows a subtle shimmer while loading.
 * - On any error (e.g. the file host is unreachable or blocks the cross-origin
 *   fetch), falls back to a clickable "Open PDF" tile rather than a dead icon.
 */

// pdfjs-dist is a heavy, browser-only dependency: import it lazily and keep a
// single module-level promise so it is only ever loaded/configured once.
let pdfjsPromise: Promise<any> | null = null
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((pdfjs) => {
      // The worker must match the library version. Pin it to the installed
      // version's CDN bundle so it works regardless of the bundler.
      pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`
      return pdfjs
    })
  }
  return pdfjsPromise
}

export default function PdfThumbnail({ url }: { url: string }) {
  const { t } = useTranslation()
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const [state, setState] = React.useState<'loading' | 'done' | 'error'>('loading')

  React.useEffect(() => {
    let cancelled = false
    let renderTask: any = null
    let pdfDoc: any = null

    setState('loading')

    async function render() {
      try {
        const pdfjs = await loadPdfjs()
        if (cancelled) return
        // pdfjs v6 requires an options object; a bare url string is rejected.
        // withCredentials so the session cookie is sent to the authenticated
        // media endpoint (private PDFs are access-checked server-side).
        const loadingTask = pdfjs.getDocument({ url, withCredentials: true })
        pdfDoc = await loadingTask.promise
        if (cancelled) return
        const page = await pdfDoc.getPage(1)
        if (cancelled) return

        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('no 2d context')

        // Fit page 1 into a 16:9 box at a reasonable resolution.
        const baseViewport = page.getViewport({ scale: 1 })
        const targetWidth = 400
        const scale = targetWidth / baseViewport.width
        const viewport = page.getViewport({ scale })
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)

        renderTask = page.render({ canvasContext: ctx, viewport })
        await renderTask.promise
        if (cancelled) return
        setState('done')
      } catch (_err) {
        if (!cancelled) setState('error')
      }
    }

    render()

    return () => {
      cancelled = true
      try {
        renderTask?.cancel?.()
      } catch { /* best-effort cleanup */ }
      try {
        pdfDoc?.destroy?.()
      } catch { /* best-effort cleanup */ }
    }
  }, [url])

  if (state === 'error') {
    // Page-1 render failed (unreachable file / blocked cross-origin fetch).
    // Only offer a clickable link for http(s) URLs — never bind an untrusted
    // scheme (e.g. javascript:) to href. Otherwise fall back to a plain tile.
    const isHttp = /^https?:\/\//i.test(url)
    if (!isHttp) {
      return (
        <div className="relative aspect-video flex items-center justify-center bg-amber-50 text-amber-500">
          <FilePdf size={46} weight="fill" />
        </div>
      )
    }
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        title={t('media.open_pdf')}
        className="group relative aspect-video flex flex-col items-center justify-center gap-1.5 bg-amber-50 text-amber-500 hover:bg-amber-100 transition-colors"
      >
        <FilePdf size={42} weight="fill" />
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600/80 group-hover:text-amber-700">
          {t('media.open_pdf')}
          <ArrowSquareOut size={11} weight="bold" />
        </span>
      </a>
    )
  }

  return (
    <div className="relative aspect-video bg-gray-50 overflow-hidden">
      {state === 'loading' && (
        <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-gray-100 to-gray-200" />
      )}
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
          state === 'done' ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ objectFit: 'cover' }}
      />
    </div>
  )
}
