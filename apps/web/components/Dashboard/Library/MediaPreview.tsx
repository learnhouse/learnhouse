'use client'

import React from 'react'
import { getMediaFileDirectory } from '@services/media/media-resource'
import { getAPIUrl } from '@services/config/config'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import {
  LinkSimple,
  FilePdf,
  VideoCamera,
  Image as ImageIcon,
  MusicNote,
  File as FileIcon,
  Play,
} from '@phosphor-icons/react'
import PdfThumbnail from '@components/Dashboard/Library/PdfThumbnail'
import { mediaKind } from '@/lib/media/mediaKind'
import { youTubeId, vimeoId } from '@/lib/media/embedUrl'

/*
 Shared media preview used by BOTH the dashboard and public library cards.
 Renders the appropriate rich preview inside the card's aspect-video area:
   - EMBED YouTube  -> thumbnail (img.youtube.com) + play badge
   - EMBED Vimeo    -> clean video tile (VideoCamera)
   - EMBED website  -> screenshot via thum.io with link-tile fallback
   - UPLOAD image   -> the image itself
   - UPLOAD pdf     -> first-page thumbnail (pdfjs, see PdfThumbnail)
   - UPLOAD video   -> muted <video> first-frame
   - other uploads  -> tinted type icon
 The component is read-only / presentational.
*/

// Amber tone matches the existing "media" tone used by the cards.
const MEDIA_TONE = 'bg-amber-50 text-amber-500'

function tileIcon(resource: any): React.ComponentType<any> {
  switch (mediaKind(resource)) {
    case 'embed': return LinkSimple
    case 'pdf': return FilePdf
    case 'video': return VideoCamera
    case 'image': return ImageIcon
    case 'audio': return MusicNote
    default: return FileIcon
  }
}

function IconTile({ Icon }: { Icon: React.ComponentType<any> }) {
  return (
    <div className={`relative aspect-video flex items-center justify-center ${MEDIA_TONE}`}>
      <Icon size={46} weight="fill" />
    </div>
  )
}

function YouTubePreview({ id }: { id: string }) {
  return (
    <div
      className="relative aspect-video bg-gray-900 bg-cover bg-center"
      style={{ backgroundImage: `url(https://img.youtube.com/vi/${id}/hqdefault.jpg)` }}
    >
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="flex items-center justify-center w-11 h-11 rounded-full bg-black/55 backdrop-blur-sm">
          <Play size={20} weight="fill" className="text-white translate-x-[1px]" />
        </div>
      </div>
    </div>
  )
}

function ScreenshotPreview({ url, video }: { url: string; video?: boolean }) {
  const [failed, setFailed] = React.useState(false)
  if (failed) {
    return <IconTile Icon={video ? VideoCamera : LinkSimple} />
  }
  // No-key screenshot service. See report note about thum.io.
  const shot = `https://image.thum.io/get/width/600/crop/450/${encodeURIComponent(url)}`
  return (
    <div className="relative aspect-video bg-gray-50 overflow-hidden">
      { }
      <img
        src={shot}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="absolute inset-0 h-full w-full object-cover"
      />
      {video && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="flex items-center justify-center w-11 h-11 rounded-full bg-black/45 backdrop-blur-sm">
            <Play size={20} weight="fill" className="text-white translate-x-[1px]" />
          </div>
        </div>
      )}
    </div>
  )
}

function UploadVideoPreview({ src }: { src: string }) {
  const [failed, setFailed] = React.useState(false)
  if (failed) return <IconTile Icon={VideoCamera} />
  return (
    <div className="relative aspect-video bg-gray-900 overflow-hidden">
      <video
        src={src}
        muted
        playsInline
        preload="metadata"
        onError={() => setFailed(true)}
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="flex items-center justify-center w-11 h-11 rounded-full bg-black/45 backdrop-blur-sm">
          <Play size={20} weight="fill" className="text-white translate-x-[1px]" />
        </div>
      </div>
    </div>
  )
}

/**
 * Website/link embed preview. Tries the backend link-preview (og:image — reliable,
 * server-side) first, then a screenshot service, then a clean link/video tile.
 */
function EmbedPreview({ url, video }: { url: string; video?: boolean }) {
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const [og, setOg] = React.useState<string | null | undefined>(undefined)
  const [ogFailed, setOgFailed] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    if (!token) { setOg(null); return } // anonymous → skip straight to fallback
    fetch(`${getAPIUrl()}utils/link-preview?url=${encodeURIComponent(url)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setOg(d?.og_image || null) })
      .catch(() => { if (!cancelled) setOg(null) })
    return () => { cancelled = true }
  }, [url, token])

  // Still resolving the og:image.
  if (og === undefined) {
    return <div className="relative aspect-video bg-gray-100 animate-pulse" />
  }
  // Have an og:image and it loads fine.
  if (og && !ogFailed) {
    return (
      <div className="relative aspect-video bg-gray-50 overflow-hidden">
        { }
        <img src={og} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setOgFailed(true)} className="absolute inset-0 h-full w-full object-cover" />
        {video && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="flex items-center justify-center w-11 h-11 rounded-full bg-black/45 backdrop-blur-sm">
              <Play size={20} weight="fill" className="text-white translate-x-[1px]" />
            </div>
          </div>
        )}
      </div>
    )
  }
  // No og:image → screenshot service (which falls back to an icon tile).
  return <ScreenshotPreview url={url} video={video} />
}

export default function MediaPreview({
  resource,
  orgUuid,
  resourceUuid,
}: {
  resource: any
  orgUuid?: string
  /** Fallback uuid when the resource lacks media_uuid (item.resource_uuid). */
  resourceUuid?: string
}) {
  const Icon = tileIcon(resource)
  const kind = mediaKind(resource)

  // EMBED: parse the url.
  if (kind === 'embed') {
    const url: string = resource.url || ''
    if (!url) return <IconTile Icon={Icon} />
    const yt = youTubeId(url)
    if (yt) return <YouTubePreview id={yt} />
    // Vimeo and every other website link get a real preview (og:image / screenshot).
    return <EmbedPreview url={url} video={!!vimeoId(url)} />
  }

  // UPLOAD: build the file url. file_id is no longer exposed by the API; the
  // authed /media/{uuid}/file endpoint is keyed only by media_uuid.
  const mediaUuid = resource?.media_uuid || resourceUuid
  const fileUrl = mediaUuid ? getMediaFileDirectory(orgUuid, mediaUuid) : null

  if (fileUrl && kind === 'image') {
    return (
      <div
        className="relative aspect-video bg-gray-50 bg-cover bg-center"
        style={{ backgroundImage: `url(${fileUrl})` }}
      />
    )
  }

  if (fileUrl && kind === 'pdf') {
    return <PdfThumbnail url={fileUrl} />
  }

  if (fileUrl && kind === 'video') {
    return <UploadVideoPreview src={fileUrl} />
  }

  // audio, docs, unknown -> tinted type icon.
  return <IconTile Icon={Icon} />
}
