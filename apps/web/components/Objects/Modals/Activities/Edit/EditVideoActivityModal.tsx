'use client'
import React, { useEffect, useState } from 'react'
import BarLoader from 'react-spinners/BarLoader'
import { PlayCircle, Upload, YoutubeLogo } from '@phosphor-icons/react'
import { constructAcceptValue } from '@/lib/constants'
import { getActivity, updateHostedVideoActivity, updateExternalVideoActivity } from '@services/courses/activities'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import toast from 'react-hot-toast'
import { mutate } from 'swr'

const SUPPORTED_FILES = constructAcceptValue(['mp4', 'webm'])

interface VideoDetails {
  startTime: number
  endTime: number | null
  autoplay: boolean
  muted: boolean
}

interface EditVideoActivityModalProps {
  activity: any
  courseUuid: string
  orgSlug: string
  onClose: () => void
}

function EditVideoActivityModal({ activity, courseUuid, orgSlug, onClose }: EditVideoActivityModalProps) {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const isYouTube = activity.activity_sub_type === 'SUBTYPE_VIDEO_YOUTUBE'

  const [name, setName] = useState(activity.name || '')
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [videoDetails, setVideoDetails] = useState<VideoDetails>({
    startTime: 0,
    endTime: null,
    autoplay: false,
    muted: false,
  })
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    async function loadActivity() {
      const data = await getActivity(activity.activity_uuid, null, access_token)
      if (data?.details) {
        setVideoDetails({
          startTime: data.details.startTime ?? 0,
          endTime: data.details.endTime ?? null,
          autoplay: data.details.autoplay ?? false,
          muted: data.details.muted ?? false,
        })
      }
      if (data?.content?.uri) {
        setYoutubeUrl(data.content.uri)
      }
      setIsLoading(false)
    }
    loadActivity()
  }, [activity.activity_uuid])

  const convertToSeconds = (minutes: number, seconds: number) => minutes * 60 + seconds
  const convertFromSeconds = (totalSeconds: number) => ({
    minutes: Math.floor(totalSeconds / 60),
    seconds: totalSeconds % 60,
  })

  const startTimeParts = convertFromSeconds(videoDetails.startTime)
  const endTimeParts = videoDetails.endTime ? convertFromSeconds(videoDetails.endTime) : { minutes: 0, seconds: 0 }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    const toastId = toast.loading('Updating video activity...')
    try {
      let res: any
      if (isYouTube) {
        res = await updateExternalVideoActivity(
          activity.activity_uuid,
          youtubeUrl,
          videoDetails,
          access_token,
          name !== activity.name ? name : undefined,
        )
      } else {
        res = await updateHostedVideoActivity(
          activity.activity_uuid,
          videoDetails,
          access_token,
          name !== activity.name ? name : undefined,
          videoFile,
        )
      }

      if (res?.success === false) {
        toast.error('Failed to update video activity', { id: toastId })
      } else {
        toast.success('Video activity updated', { id: toastId })
        mutate((key: string) => typeof key === 'string' && key.includes('/courses/org_slug/'))
        onClose()
      }
    } catch {
      toast.error('Failed to update video activity', { id: toastId })
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-12">
        <BarLoader color="#6b7280" width={120} />
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div
        className="relative flex items-center justify-center h-20 rounded-xl overflow-hidden"
        style={{
          backgroundImage:
            'repeating-linear-gradient(-45deg, transparent, transparent 6px, rgba(196,181,253,0.25) 6px, rgba(196,181,253,0.25) 7px)',
        }}
      >
        <span className="flex items-center gap-2 bg-white nice-shadow rounded-full px-4 py-1.5 text-sm font-medium text-gray-600">
          <PlayCircle size={18} weight="duotone" className="text-violet-400" />
          {isYouTube ? 'YouTube Video' : 'Hosted Video'}
        </span>
      </div>

      <div className="rounded-xl nice-shadow p-4 space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700">Activity name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            type="text"
            required
            placeholder="Enter a name..."
            className="w-full h-9 px-3 text-sm rounded-lg bg-gray-50 border border-gray-200 outline-none focus:border-gray-300 focus:ring-1 focus:ring-gray-200 transition-colors"
          />
        </div>

        {isYouTube ? (
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">YouTube URL</label>
            <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
              <YoutubeLogo size={14} weight="duotone" />
              <span>Update the YouTube link below</span>
            </div>
            <input
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
              type="text"
              required
              placeholder="https://youtube.com/watch?v=..."
              className="w-full h-9 px-3 text-sm rounded-lg bg-gray-50 border border-gray-200 outline-none focus:border-gray-300 focus:ring-1 focus:ring-gray-200 transition-colors"
            />
          </div>
        ) : (
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">Replace video file</label>
            <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
              <Upload size={14} weight="duotone" />
              <span>Leave empty to keep the current video</span>
            </div>
            <input
              type="file"
              accept={SUPPORTED_FILES}
              onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)}
              className="w-full text-sm text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-full file:border-0 file:text-xs file:font-medium file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200 transition-colors"
            />
          </div>
        )}
      </div>

      <div className="rounded-xl nice-shadow p-4 space-y-4">
        <h3 className="text-sm font-medium text-gray-700">Video Settings</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-500">Start Time</label>
            <div className="flex gap-2">
              <div className="flex-1">
                <input
                  type="number"
                  min="0"
                  value={startTimeParts.minutes}
                  onChange={(e) => {
                    const minutes = Math.max(0, parseInt(e.target.value) || 0)
                    setVideoDetails({ ...videoDetails, startTime: convertToSeconds(minutes, startTimeParts.seconds) })
                  }}
                  placeholder="0"
                  className="w-full h-9 px-3 text-sm rounded-lg bg-gray-50 border border-gray-200 outline-none focus:border-gray-300 focus:ring-1 focus:ring-gray-200 transition-colors"
                />
                <span className="text-[11px] text-gray-400 mt-0.5 block">Min</span>
              </div>
              <div className="flex-1">
                <input
                  type="number"
                  min="0"
                  max="59"
                  value={startTimeParts.seconds}
                  onChange={(e) => {
                    const seconds = Math.max(0, Math.min(59, parseInt(e.target.value) || 0))
                    setVideoDetails({ ...videoDetails, startTime: convertToSeconds(startTimeParts.minutes, seconds) })
                  }}
                  placeholder="0"
                  className="w-full h-9 px-3 text-sm rounded-lg bg-gray-50 border border-gray-200 outline-none focus:border-gray-300 focus:ring-1 focus:ring-gray-200 transition-colors"
                />
                <span className="text-[11px] text-gray-400 mt-0.5 block">Sec</span>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-500">End Time (optional)</label>
            <div className="flex gap-2">
              <div className="flex-1">
                <input
                  type="number"
                  min="0"
                  value={endTimeParts.minutes}
                  onChange={(e) => {
                    const minutes = Math.max(0, parseInt(e.target.value) || 0)
                    const totalSeconds = convertToSeconds(minutes, endTimeParts.seconds)
                    if (totalSeconds > videoDetails.startTime) {
                      setVideoDetails({ ...videoDetails, endTime: totalSeconds })
                    }
                  }}
                  placeholder="0"
                  className="w-full h-9 px-3 text-sm rounded-lg bg-gray-50 border border-gray-200 outline-none focus:border-gray-300 focus:ring-1 focus:ring-gray-200 transition-colors"
                />
                <span className="text-[11px] text-gray-400 mt-0.5 block">Min</span>
              </div>
              <div className="flex-1">
                <input
                  type="number"
                  min="0"
                  max="59"
                  value={endTimeParts.seconds}
                  onChange={(e) => {
                    const seconds = Math.max(0, Math.min(59, parseInt(e.target.value) || 0))
                    const totalSeconds = convertToSeconds(endTimeParts.minutes, seconds)
                    if (totalSeconds > videoDetails.startTime) {
                      setVideoDetails({ ...videoDetails, endTime: totalSeconds })
                    }
                  }}
                  placeholder="0"
                  className="w-full h-9 px-3 text-sm rounded-lg bg-gray-50 border border-gray-200 outline-none focus:border-gray-300 focus:ring-1 focus:ring-gray-200 transition-colors"
                />
                <span className="text-[11px] text-gray-400 mt-0.5 block">Sec</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-5 pt-1">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={videoDetails.autoplay}
              onChange={(e) => setVideoDetails({ ...videoDetails, autoplay: e.target.checked })}
              className="rounded border-gray-300 text-black focus:ring-black"
            />
            <span className="text-sm text-gray-600">Autoplay</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={videoDetails.muted}
              onChange={(e) => setVideoDetails({ ...videoDetails, muted: e.target.checked })}
              className="rounded border-gray-300 text-black focus:ring-black"
            />
            <span className="text-sm text-gray-600">Start muted</span>
          </label>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex items-center justify-center h-9 px-5 text-sm font-medium text-white bg-black rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50"
        >
          {isSubmitting ? (
            <BarLoader cssOverride={{ borderRadius: 60 }} width={60} color="#ffffff" />
          ) : (
            'Save changes'
          )}
        </button>
      </div>
    </form>
  )
}

export default EditVideoActivityModal
