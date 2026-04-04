'use client'
import React, { useState } from 'react'
import { WarningCircle, Globe, FloppyDisk, SpinnerGap } from '@phosphor-icons/react'
import { updateActivity } from '@services/courses/activities'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import toast from 'react-hot-toast'

function toEmbedUrl(url: string): string {
  // Google Docs/Sheets/Slides → preview
  const googleDocMatch = url.match(
    /^(https?:\/\/docs\.google\.com\/(?:document|spreadsheets|presentation)\/d\/[^/]+)/
  )
  if (googleDocMatch) {
    return `${googleDocMatch[1]}/preview`
  }

  // Google Forms → embedded
  const googleFormMatch = url.match(
    /^(https?:\/\/docs\.google\.com\/forms\/d\/[^/]+)/
  )
  if (googleFormMatch) {
    return `${googleFormMatch[1]}/viewform?embedded=true`
  }

  // Figma → embed host
  if (/^https?:\/\/(www\.)?figma\.com\//.test(url)) {
    return `https://www.figma.com/embed?embed_host=learnhouse&url=${encodeURIComponent(url)}`
  }

  // Loom → /share/ to /embed/
  const loomMatch = url.match(/^(https?:\/\/www\.loom\.com)\/share\/(.+)$/)
  if (loomMatch) {
    return `${loomMatch[1]}/embed/${loomMatch[2]}`
  }

  // Canva design → embed
  if (url.includes('canva.com/design/')) {
    return url.includes('?') ? `${url}&embed` : `${url}?embed`
  }

  // Miro → embed
  const miroMatch = url.match(/^(https?:\/\/miro\.com\/app\/board\/)(.+)$/)
  if (miroMatch) {
    return `https://miro.com/app/live-embed/${miroMatch[2]}`
  }

  return url
}

interface EmbedActivityProps {
  activity: any
  editable?: boolean
  style?: React.CSSProperties
}

function EmbedActivity({ activity, editable = false, style }: EmbedActivityProps) {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const embedUrl = activity.content?.embed_url || ''

  const [editUrl, setEditUrl] = useState(embedUrl)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(!embedUrl)

  const handleSaveUrl = async () => {
    if (!editUrl.trim()) return
    setSaving(true)
    try {
      await updateActivity(
        { content: { embed_url: editUrl.trim() } },
        activity.activity_uuid,
        access_token
      )
      toast.success('Embed URL updated')
      setError(false)
    } catch {
      toast.error('Failed to update URL')
    } finally {
      setSaving(false)
    }
  }

  const displayUrl = editable ? editUrl : embedUrl

  if (!displayUrl && !editable) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <WarningCircle size={40} className="text-red-400" />
        <p className="text-sm text-gray-600">No embed URL configured</p>
      </div>
    )
  }

  return (
    <div className="w-full px-6 py-6" style={style}>
      {editable && (
        <div className="mb-6 flex items-center gap-3">
          <Globe size={20} weight="duotone" className="text-cyan-400 flex-shrink-0" />
          <input
            type="url"
            value={editUrl}
            onChange={(e) => setEditUrl(e.target.value)}
            placeholder="https://docs.google.com/document/d/..."
            className="flex-1 h-9 px-3 text-sm rounded-lg bg-gray-50 border border-gray-200 outline-none focus:border-gray-300 focus:ring-1 focus:ring-gray-200 transition-colors"
          />
          <button
            onClick={handleSaveUrl}
            disabled={saving || editUrl.trim() === embedUrl}
            className="inline-flex items-center gap-2 h-9 px-4 text-sm font-medium text-white bg-black rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 flex-shrink-0"
          >
            {saving ? (
              <SpinnerGap size={16} className="animate-spin" />
            ) : (
              <FloppyDisk size={16} />
            )}
            Save
          </button>
        </div>
      )}

      {displayUrl ? (
        <div className="w-full rounded-xl overflow-hidden nice-shadow" style={{ aspectRatio: '16/9' }}>
          <iframe
            src={toEmbedUrl(displayUrl)}
            className="w-full h-full border-0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"
          />
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 gap-3 rounded-xl border-2 border-dashed border-gray-200">
          <Globe size={32} weight="duotone" className="text-gray-300" />
          <p className="text-sm text-gray-400">Enter an embed URL above to preview</p>
        </div>
      )}
    </div>
  )
}

export default EmbedActivity
