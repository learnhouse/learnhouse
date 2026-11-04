'use client'

import React from 'react'
import { ArrowSquareOut, DownloadSimple, FilePdf, Files } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'

/**
 * Phone reader for the PDF activity.
 *
 * Mobile browsers don't render a PDF inside an iframe (Android Chrome shows
 * nothing, iOS Safari a single frozen page), so on touch screens the pages are
 * drawn with pdfjs-dist instead: a continuous column of pages at the width of
 * the screen, like a native reader. Pages are drawn as they come near the
 * viewport and released once far away, so a long document doesn't exhaust a
 * phone's canvas memory.
 */

// pdfjs-dist is heavy and browser-only: load it on first use, once.
let pdfjsPromise: Promise<any> | null = null
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((pdfjs) => {
      // The worker must match the library version (same as PdfThumbnail).
      pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`
      return pdfjs
    })
  }
  return pdfjsPromise
}

function PdfPage({ doc, pageNumber, aspect, label }: { doc: any; pageNumber: number; aspect: number; label: string }) {
  const holderRef = React.useRef<HTMLDivElement>(null)
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const [drawn, setDrawn] = React.useState(false)
  // The first page's shape holds the space until this page reports its own.
  const [ownAspect, setOwnAspect] = React.useState<number | null>(null)

  React.useEffect(() => {
    const holder = holderRef.current
    const canvas = canvasRef.current
    if (!holder || !canvas) return
    let task: any = null
    let active = false

    const release = () => {
      task?.cancel?.()
      task = null
      canvas.width = 0
      canvas.height = 0
      setDrawn(false)
    }

    const draw = async () => {
      try {
        const page = await doc.getPage(pageNumber)
        if (!active) return
        // Fit the page to the column, at device resolution (capped: 3x adds
        // memory without visible gain on a phone).
        const cssWidth = holder.clientWidth || 360
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const base = page.getViewport({ scale: 1 })
        setOwnAspect(base.width / base.height)
        const viewport = page.getViewport({ scale: (cssWidth * dpr) / base.width })
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        task = page.render({ canvasContext: canvas.getContext('2d'), viewport })
        await task.promise
        if (active) setDrawn(true)
      } catch {
        /* cancelled, or the page failed: the placeholder stays */
      }
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !active) {
          active = true
          draw()
        } else if (!entry.isIntersecting && active) {
          active = false
          release()
        }
      },
      // Draw a screen and a half ahead; release well behind.
      { rootMargin: '150% 0px' }
    )
    observer.observe(holder)
    return () => {
      observer.disconnect()
      active = false
      task?.cancel?.()
    }
  }, [doc, pageNumber])

  return (
    <div
      ref={holderRef}
      data-page={pageNumber}
      className="relative w-full overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-black/5"
      style={{ aspectRatio: String(ownAspect ?? aspect) }}
    >
      {!drawn && <div className="absolute inset-0 animate-pulse bg-neutral-100" />}
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={label}
        className={`block h-full w-full transition-opacity duration-200 ${drawn ? 'opacity-100' : 'opacity-0'}`}
      />
    </div>
  )
}

export default function PdfMobileReader({
  url,
  name,
  initialPage,
  onDownload,
  fillHeight,
}: {
  url: string
  name: string
  initialPage?: number | null
  onDownload: () => void
  // Inside a fixed-height host (boards, embeds) the pages scroll in place.
  fillHeight?: boolean
}) {
  const { t } = useTranslation()
  const [doc, setDoc] = React.useState<any>(null)
  const [aspect, setAspect] = React.useState(1 / Math.SQRT2)
  const [failed, setFailed] = React.useState(false)
  const listRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    let cancelled = false
    let loaded: any = null
    // A new url remounts the reader (keyed by the parent), so no reset here.
    ;(async () => {
      try {
        const pdfjs = await loadPdfjs()
        // Cookies go along: private PDFs are access-checked by the media API.
        loaded = await pdfjs.getDocument({ url, withCredentials: true }).promise
        if (cancelled) return
        const first = await loaded.getPage(1)
        const vp = first.getViewport({ scale: 1 })
        if (cancelled) return
        setAspect(vp.width / vp.height)
        setDoc(loaded)
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
      loaded?.destroy?.()
    }
  }, [url])

  // `?page=<n>`: bring that page into view once the placeholders exist.
  React.useEffect(() => {
    if (!doc || !initialPage || initialPage < 2) return
    const el = listRef.current?.querySelector(`[data-page="${Math.min(initialPage, doc.numPages)}"]`)
    el?.scrollIntoView({ block: 'start' })
  }, [doc, initialPage])

  const actionClass =
    'flex h-11 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors active:scale-[0.98]'

  return (
    <div className={`flex flex-col gap-3 ${fillHeight ? 'h-full min-h-0' : ''}`}>
      {/* File card: name, length and the two ways out to a native viewer. */}
      <div className="rounded-2xl bg-white p-3 ring-1 ring-black/5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-500">
            <FilePdf weight="fill" size={24} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold text-neutral-900">{name}</p>
            <p className="flex items-center gap-1 text-xs text-neutral-500">
              PDF
              {doc && (
                <>
                  <span aria-hidden>·</span>
                  <Files size={12} weight="bold" aria-hidden />
                  {doc.numPages}
                </>
              )}
            </p>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className={`${actionClass} bg-neutral-900 text-white hover:bg-neutral-800`}
          >
            <ArrowSquareOut weight="bold" size={16} />
            {t('media.open_pdf')}
          </a>
          <button
            type="button"
            onClick={onDownload}
            className={`${actionClass} bg-neutral-100 text-neutral-800 hover:bg-neutral-200`}
          >
            <DownloadSimple weight="bold" size={16} />
            {t('editor.blocks.pdf_block.download_pdf')}
          </button>
        </div>
      </div>

      {!failed && (
        <div
          ref={listRef}
          className={`flex flex-col gap-3 ${fillHeight ? 'min-h-0 flex-1 overflow-y-auto overscroll-contain' : ''}`}
        >
          {doc
            ? Array.from({ length: doc.numPages }, (_, i) => (
                <PdfPage
                  key={i + 1}
                  doc={doc}
                  pageNumber={i + 1}
                  aspect={aspect}
                  label={`${t('activities.page')} ${i + 1}`}
                />
              ))
            : (
              <div
                className="w-full animate-pulse rounded-lg bg-neutral-100"
                style={{ aspectRatio: String(aspect) }}
              />
            )}
        </div>
      )}
    </div>
  )
}
