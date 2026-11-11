import { useOrg } from '@components/Contexts/OrgContext'
import { getActivityMediaDirectory } from '@services/media/media'
import { ArrowsOut, ArrowsIn, DownloadSimple } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import React from 'react'
import { positiveIntParam } from '@/lib/copilot/sources'
import PdfMobileReader from './PdfMobileReader'

// Filename for the saved copy: the activity's name, so learners don't end up
// with a folder of opaque upload ids.
function downloadName(activity: any) {
  const base = String(activity?.name || 'document').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'document'
  return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`
}

const noSubscription = () => () => {}

// Touch-first devices can't show a PDF in an iframe; they get the pdf.js
// reader. Unknown (null) during the server render and hydration.
const TOUCH_QUERY = '(hover: none) and (pointer: coarse)'
const subscribeTouch = (onChange: () => void) => {
  const mql = window.matchMedia(TOUCH_QUERY)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}
const getTouch = () => window.matchMedia(TOUCH_QUERY).matches
const getTouchServer = () => null

function DocumentPdfActivity({
  activity,
  course,
  orgUuid,
  className,
}: {
  activity: any
  course: any
  orgUuid?: string
  className?: string
}) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const resolvedOrgUuid = orgUuid || org?.org_uuid
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [isFullscreen, setIsFullscreen] = React.useState(false)

  const pdfUrl = getActivityMediaDirectory(
    resolvedOrgUuid,
    course?.course_uuid,
    activity.activity_uuid,
    activity.content.filename,
    'documentpdf'
  )

  // `?page=<n>` opens the document at a page, e.g. from a copilot citation.
  // Read through useSyncExternalStore so the server render and hydration agree.
  const search = React.useSyncExternalStore(noSubscription, () => window.location.search, () => '')
  const linkedPage = positiveIntParam(search, 'page')
  const isTouch = React.useSyncExternalStore<boolean | null>(subscribeTouch, getTouch, getTouchServer)

  React.useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === containerRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // The file lives on the media origin, where a plain <a download> is ignored
  // and the browser would just open it. Fetch it and save the blob instead:
  // with the learner's cookies for the API, without them for a CDN that answers
  // `Access-Control-Allow-Origin: *` (which rejects credentialed requests).
  // Last resort is a new tab.
  const fetchPdf = async () => {
    for (const credentials of ['include', 'omit'] as const) {
      try {
        const res = await fetch(pdfUrl!, { credentials })
        if (res.ok) return await res.blob()
      } catch {
        /* CORS rejection: try the next mode */
      }
    }
    throw new Error('download failed')
  }

  const handleDownload = async () => {
    if (!pdfUrl) return
    try {
      const objectUrl = URL.createObjectURL(await fetchPdf())
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = downloadName(activity)
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
    } catch {
      window.open(pdfUrl, '_blank', 'noopener,noreferrer')
    }
  }

  // iOS Safari has no element fullscreen; opening the PDF on its own is the
  // closest it gets to a full-screen reader.
  const handleFullscreen = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {})
      return
    }
    const el = containerRef.current
    if (el?.requestFullscreen) {
      try {
        await el.requestFullscreen()
        return
      } catch {
        /* fall through */
      }
    }
    if (pdfUrl) window.open(pdfUrl, '_blank', 'noopener,noreferrer')
  }

  // Hold the space until we know which reader fits, so a phone never starts
  // loading the iframe it can't display.
  if (isTouch === null) {
    return <div className={className ?? 'aspect-[3/4] w-full animate-pulse rounded-xl bg-neutral-100 sm:m-8 sm:mt-14'} />
  }

  if (isTouch && pdfUrl) {
    return (
      <div className={className ? `${className} overflow-hidden p-2` : 'w-full'}>
        <PdfMobileReader
          key={pdfUrl}
          url={pdfUrl}
          name={activity?.name || t('editor.blocks.pdf_block.document_title')}
          initialPage={linkedPage}
          onDownload={handleDownload}
          fillHeight={!!className}
        />
      </div>
    )
  }

  const controlClass =
    'p-2 outline-none bg-black/50 hover:bg-black/70 focus-visible:ring-2 focus-visible:ring-white rounded-lg transition-colors'

  return (
    <div
      ref={containerRef}
      className={`group relative ${className ?? 'm-0 sm:m-8 bg-zinc-900 sm:rounded-md mt-0 sm:mt-14'} ${isFullscreen ? 'bg-zinc-900' : ''}`}
    >
      <iframe
        className={className || isFullscreen ? 'w-full h-full' : 'sm:rounded-lg w-full h-[85vh] sm:h-[900px]'}
        src={linkedPage && pdfUrl ? `${pdfUrl}#page=${linkedPage}` : pdfUrl}
        title={activity?.name || t('editor.blocks.pdf_block.document_title')}
      />
      {/* Always visible on touch screens, where there is no hover to reveal them. */}
      <div className="absolute top-2 end-2 flex gap-1 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          onClick={handleFullscreen}
          className={controlClass}
          title={t('editor.blocks.pdf_block.expand_pdf')}
          aria-label={t('editor.blocks.pdf_block.expand_pdf')}
        >
          {isFullscreen ? (
            <ArrowsIn weight="duotone" className="w-4 h-4 text-white" />
          ) : (
            <ArrowsOut weight="duotone" className="w-4 h-4 text-white" />
          )}
        </button>
        <button
          type="button"
          onClick={handleDownload}
          className={controlClass}
          title={t('editor.blocks.pdf_block.download_pdf')}
          aria-label={t('editor.blocks.pdf_block.download_pdf')}
        >
          <DownloadSimple weight="duotone" className="w-4 h-4 text-white" />
        </button>
      </div>
    </div>
  )
}

export default DocumentPdfActivity
