'use client'

import React from 'react'
import dynamic from 'next/dynamic'
import { Download, File as FileIcon, FileArchive, FileSpreadsheet, FileText, Lock, Presentation } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getMediaFileDirectory } from '@services/media/media-resource'
import { formatFileSize, mediaKind, type MediaKind, type MediaLike } from '@/lib/media/mediaKind'
import { toEmbedUrl } from '@/lib/media/embedUrl'
import { safeExternalUrl } from '@components/Dashboard/Library/resourceLink'
import InlineAudioPlayer from '@components/Objects/Media/InlineAudioPlayer'

// video.js touches window on import; keep it out of the server bundle.
const LearnHousePlayer = dynamic(
  () => import('@components/Objects/Activities/Video/LearnHousePlayer'),
  { ssr: false }
)

/*
 The actual in-app player/reader for a Library media asset — no modal chrome,
 no card. Used by MediaLightbox (library views) and by the Library editor block,
 so "watch / read / listen / download" behaves identically in both.
*/

const OFFICE_ICONS: Record<string, React.ComponentType<any>> = {
  doc: FileText, docx: FileText, txt: FileText, rtf: FileText, pdf: FileText,
  xls: FileSpreadsheet, xlsx: FileSpreadsheet, csv: FileSpreadsheet,
  ppt: Presentation, pptx: Presentation,
  zip: FileArchive, rar: FileArchive, '7z': FileArchive,
}

function fileIcon(format?: string | null): React.ComponentType<any> {
  return OFFICE_ICONS[(format || '').toLowerCase().replace(/^\./, '')] || FileIcon
}

/** Media that cannot be rendered in-app: name it, size it, offer the download. */
function FileCard({
  name,
  fileFormat,
  fileSize,
  downloadUrl,
}: {
  name: string
  fileFormat?: string | null
  fileSize?: number | null
  downloadUrl: string | null
}) {
  const { t } = useTranslation()
  const Icon = fileIcon(fileFormat)
  const size = formatFileSize(fileSize)
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-12 px-6 bg-gray-50 rounded-xl">
      {/* eslint-disable-next-line react-hooks/static-components */}
      <Icon size={56} className="text-gray-400" strokeWidth={1.25} />
      <div className="text-center">
        <p className="text-sm font-semibold text-gray-900 break-all">{name}</p>
        <p className="text-xs text-gray-500 mt-1 uppercase tracking-wider">
          {[(fileFormat || '').replace(/^\./, ''), size].filter(Boolean).join(' · ')}
        </p>
      </div>
      {downloadUrl && (
        <a
          href={downloadUrl}
          className="inline-flex items-center gap-2 rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white nice-shadow hover:bg-neutral-800 transition-colors"
        >
          <Download size={16} /> {t('media.download')}
        </a>
      )}
    </div>
  )
}

/** A learner can legitimately lack access when the file sits in a private folder. */
function NoAccessCard() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 px-6 bg-gray-50 rounded-xl">
      <Lock size={40} className="text-gray-400" strokeWidth={1.25} />
      <p className="text-sm text-gray-600">{t('library.no_access')}</p>
    </div>
  )
}

export type MediaViewerProps = {
  /** A Media row (or the Library block's cached snapshot of one). */
  resource: MediaLike & { name?: string; file_size?: number | null }
  /** Falls back to item.resource_uuid when the row has no media_uuid. */
  mediaUuid?: string
  /** Caps the viewer height; the lightbox and the block want different ones. */
  maxHeightClass?: string
}

export default function MediaViewer({
  resource,
  mediaUuid,
  maxHeightClass = 'max-h-[70vh]',
}: MediaViewerProps) {
  const [denied, setDenied] = React.useState(false)
  const kind: MediaKind = mediaKind(resource)
  const name = resource?.name || ''
  const fileUrl = mediaUuid ? getMediaFileDirectory(undefined, mediaUuid) : null
  const downloadUrl = mediaUuid
    ? getMediaFileDirectory(undefined, mediaUuid, undefined, { download: true })
    : null

  // A 401/403 on the file endpoint means "private folder", not "broken file".
  React.useEffect(() => {
    setDenied(false)
    if (!fileUrl || kind === 'embed') return
    let cancelled = false
    fetch(fileUrl, { method: 'HEAD', credentials: 'include' })
      .then((r) => {
        if (!cancelled && (r.status === 401 || r.status === 403)) setDenied(true)
      })
      .catch(() => {
        /* network errors fall through to the element's own error handling */
      })
    return () => { cancelled = true }
  }, [fileUrl, kind])

  if (kind === 'embed') {
    const url = safeExternalUrl(resource?.url)
    if (!url) return <NoAccessCard />
    return (
      <div className={`w-full ${maxHeightClass} aspect-video bg-black rounded-xl overflow-hidden`}>
        <iframe
          src={toEmbedUrl(url)}
          title={name || 'Embedded media'}
          className="w-full h-full border-0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
        />
      </div>
    )
  }

  if (!fileUrl) return <NoAccessCard />
  if (denied) return <NoAccessCard />

  if (kind === 'image') {
    return (
      <div className={`flex items-center justify-center bg-gray-50 rounded-xl overflow-hidden ${maxHeightClass}`}>
        <img src={fileUrl} alt={name} className="max-w-full max-h-full object-contain" />
      </div>
    )
  }

  if (kind === 'video') {
    return (
      <div className={`w-full ${maxHeightClass} bg-black rounded-xl overflow-hidden`}>
        <LearnHousePlayer src={fileUrl} />
      </div>
    )
  }

  if (kind === 'audio') {
    return <InlineAudioPlayer src={fileUrl} title={name} />
  }

  if (kind === 'pdf') {
    return (
      <iframe
        src={fileUrl}
        title={name || 'PDF document'}
        className={`w-full ${maxHeightClass} h-[70vh] rounded-xl border border-gray-200 bg-white`}
      />
    )
  }

  return (
    <FileCard
      name={name}
      fileFormat={resource?.file_format}
      fileSize={resource?.file_size}
      downloadUrl={downloadUrl}
    />
  )
}
