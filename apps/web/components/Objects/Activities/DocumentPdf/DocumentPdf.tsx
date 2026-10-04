import { useOrg } from '@components/Contexts/OrgContext'
import { getActivityMediaDirectory } from '@services/media/media'
import { ArrowsOut, ArrowsIn, DownloadSimple } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import React from 'react'

// Filename for the saved copy: the activity's name, so learners don't end up
// with a folder of opaque upload ids.
function downloadName(activity: any) {
  const base = String(activity?.name || 'document').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'document'
  return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`
}

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

  const controlClass =
    'p-2 outline-none bg-black/50 hover:bg-black/70 focus-visible:ring-2 focus-visible:ring-white rounded-lg transition-colors'

  return (
    <div
      ref={containerRef}
      className={`group relative ${className ?? 'm-0 sm:m-8 bg-zinc-900 sm:rounded-md mt-0 sm:mt-14'} ${isFullscreen ? 'bg-zinc-900' : ''}`}
    >
      <iframe
        className={className || isFullscreen ? 'w-full h-full' : 'sm:rounded-lg w-full h-[85vh] sm:h-[900px]'}
        src={pdfUrl}
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
