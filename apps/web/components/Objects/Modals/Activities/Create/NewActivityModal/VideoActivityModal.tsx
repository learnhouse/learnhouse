import React, { useState } from 'react'
import * as Form from '@radix-ui/react-form'
import BarLoader from 'react-spinners/BarLoader'
import { PlayCircle, Upload, YoutubeLogo } from '@phosphor-icons/react'
import { constructAcceptValue } from '@/lib/constants'

const SUPPORTED_FILES = constructAcceptValue(['mp4', 'webm'])

interface VideoDetails {
  startTime: number
  endTime: number | null
  autoplay: boolean
  muted: boolean
}

interface ExternalVideoObject {
  name: string
  type: string
  uri: string
  chapter_id: string
  details: VideoDetails
}

function VideoModal({
  submitFileActivity,
  submitExternalVideo,
  chapterId,
  course,
}: any) {
  const [video, setVideo] = React.useState<File | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [name, setName] = React.useState('')
  const [youtubeUrl, setYoutubeUrl] = React.useState('')
  const [selectedView, setSelectedView] = React.useState<'file' | 'youtube'>(
    'file'
  )
  const [videoDetails, setVideoDetails] = React.useState<VideoDetails>({
    startTime: 0,
    endTime: null,
    autoplay: false,
    muted: false,
  })

  const handleVideoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files?.[0]) {
      setVideo(event.target.files[0])
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    try {
      if (selectedView === 'file' && video) {
        await submitFileActivity(
          video,
          'video',
          {
            name: name,
            chapter_id: chapterId,
            activity_type: 'TYPE_VIDEO',
            activity_sub_type: 'SUBTYPE_VIDEO_HOSTED',
            published_version: 1,
            version: 1,
            course_id: course.id,
            details: videoDetails,
          },
          chapterId
        )
      }

      if (selectedView === 'youtube') {
        const external_video_object: ExternalVideoObject = {
          name,
          type: 'youtube',
          uri: youtubeUrl,
          chapter_id: chapterId,
          details: videoDetails,
        }

        await submitExternalVideo(external_video_object, 'activity', chapterId)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const convertToSeconds = (minutes: number, seconds: number) =>
    minutes * 60 + seconds
  const convertFromSeconds = (totalSeconds: number) => ({
    minutes: Math.floor(totalSeconds / 60),
    seconds: totalSeconds % 60,
  })

  const startTimeParts = convertFromSeconds(videoDetails.startTime)
  const endTimeParts = videoDetails.endTime
    ? convertFromSeconds(videoDetails.endTime)
    : { minutes: 0, seconds: 0 }

  return (
    <Form.Root onSubmit={handleSubmit} className="space-y-4">
      <div
        className="relative flex items-center justify-center h-20 rounded-xl overflow-hidden"
        style={{
          backgroundImage:
            'repeating-linear-gradient(-45deg, transparent, transparent 6px, rgba(196,181,253,0.25) 6px, rgba(196,181,253,0.25) 7px)',
        }}
      >
        <span className="flex items-center gap-2 bg-white nice-shadow rounded-full px-4 py-1.5 text-sm font-medium text-gray-600">
          <PlayCircle size={18} weight="duotone" className="text-violet-400" />
          Video
        </span>
      </div>

      <div className="rounded-xl nice-shadow p-4 space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700">
            Activity name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            type="text"
            required
            placeholder="Enter a name..."
            className="w-full h-9 px-3 text-sm rounded-lg bg-gray-50 border border-gray-200 outline-none focus:border-gray-300 focus:ring-1 focus:ring-gray-200 transition-colors"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700">Source</label>
          <div className="grid grid-cols-2 gap-0 rounded-lg overflow-hidden border border-gray-200">
            <button
              type="button"
              onClick={() => setSelectedView('file')}
              className={`flex items-center justify-center py-2.5 gap-2 text-sm font-medium transition-colors ${
                selectedView === 'file'
                  ? 'bg-gray-100 text-gray-900'
                  : 'bg-white text-gray-500 hover:bg-gray-50'
              }`}
            >
              <Upload size={16} weight="duotone" />
              Upload
            </button>
            <button
              type="button"
              onClick={() => setSelectedView('youtube')}
              className={`flex items-center justify-center py-2.5 gap-2 text-sm font-medium border-s border-gray-200 transition-colors ${
                selectedView === 'youtube'
                  ? 'bg-gray-100 text-gray-900'
                  : 'bg-white text-gray-500 hover:bg-gray-50'
              }`}
            >
              <YoutubeLogo size={16} weight="duotone" />
              YouTube
            </button>
          </div>
        </div>

        {selectedView === 'file' && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">
              Video file
            </label>
            <input
              type="file"
              accept={SUPPORTED_FILES}
              onChange={handleVideoChange}
              required
              className="w-full text-sm text-gray-500 file:me-3 file:py-1.5 file:px-3 file:rounded-full file:border-0 file:text-xs file:font-medium file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200 transition-colors"
            />
          </div>
        )}

        {selectedView === 'youtube' && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">
              YouTube URL
            </label>
            <input
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
              type="text"
              required
              placeholder="https://youtube.com/watch?v=..."
              className="w-full h-9 px-3 text-sm rounded-lg bg-gray-50 border border-gray-200 outline-none focus:border-gray-300 focus:ring-1 focus:ring-gray-200 transition-colors"
            />
          </div>
        )}
      </div>

      <div className="rounded-xl nice-shadow p-4 space-y-4">
        <h3 className="text-sm font-medium text-gray-700">Video Settings</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-500">
              Start Time
            </label>
            <div className="flex gap-2">
              <div className="flex-1">
                <input
                  type="number"
                  min="0"
                  value={startTimeParts.minutes}
                  onChange={(e) => {
                    const minutes = Math.max(0, parseInt(e.target.value) || 0)
                    setVideoDetails({
                      ...videoDetails,
                      startTime: convertToSeconds(
                        minutes,
                        startTimeParts.seconds
                      ),
                    })
                  }}
                  placeholder="0"
                  className="w-full h-9 px-3 text-sm rounded-lg bg-gray-50 border border-gray-200 outline-none focus:border-gray-300 focus:ring-1 focus:ring-gray-200 transition-colors"
                />
                <span className="text-[11px] text-gray-400 mt-0.5 block">
                  Min
                </span>
              </div>
              <div className="flex-1">
                <input
                  type="number"
                  min="0"
                  max="59"
                  value={startTimeParts.seconds}
                  onChange={(e) => {
                    const seconds = Math.max(
                      0,
                      Math.min(59, parseInt(e.target.value) || 0)
                    )
                    setVideoDetails({
                      ...videoDetails,
                      startTime: convertToSeconds(
                        startTimeParts.minutes,
                        seconds
                      ),
                    })
                  }}
                  placeholder="0"
                  className="w-full h-9 px-3 text-sm rounded-lg bg-gray-50 border border-gray-200 outline-none focus:border-gray-300 focus:ring-1 focus:ring-gray-200 transition-colors"
                />
                <span className="text-[11px] text-gray-400 mt-0.5 block">
                  Sec
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-500">
              End Time (optional)
            </label>
            <div className="flex gap-2">
              <div className="flex-1">
                <input
                  type="number"
                  min="0"
                  value={endTimeParts.minutes}
                  onChange={(e) => {
                    const minutes = Math.max(0, parseInt(e.target.value) || 0)
                    const totalSeconds = convertToSeconds(
                      minutes,
                      endTimeParts.seconds
                    )
                    if (totalSeconds > videoDetails.startTime) {
                      setVideoDetails({ ...videoDetails, endTime: totalSeconds })
                    }
                  }}
                  placeholder="0"
                  className="w-full h-9 px-3 text-sm rounded-lg bg-gray-50 border border-gray-200 outline-none focus:border-gray-300 focus:ring-1 focus:ring-gray-200 transition-colors"
                />
                <span className="text-[11px] text-gray-400 mt-0.5 block">
                  Min
                </span>
              </div>
              <div className="flex-1">
                <input
                  type="number"
                  min="0"
                  max="59"
                  value={endTimeParts.seconds}
                  onChange={(e) => {
                    const seconds = Math.max(
                      0,
                      Math.min(59, parseInt(e.target.value) || 0)
                    )
                    const totalSeconds = convertToSeconds(
                      endTimeParts.minutes,
                      seconds
                    )
                    if (totalSeconds > videoDetails.startTime) {
                      setVideoDetails({ ...videoDetails, endTime: totalSeconds })
                    }
                  }}
                  placeholder="0"
                  className="w-full h-9 px-3 text-sm rounded-lg bg-gray-50 border border-gray-200 outline-none focus:border-gray-300 focus:ring-1 focus:ring-gray-200 transition-colors"
                />
                <span className="text-[11px] text-gray-400 mt-0.5 block">
                  Sec
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-5 pt-1">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={videoDetails.autoplay}
              onChange={(e) =>
                setVideoDetails({ ...videoDetails, autoplay: e.target.checked })
              }
              className="rounded border-gray-300 text-black focus:ring-black"
            />
            <span className="text-sm text-gray-600">Autoplay</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={videoDetails.muted}
              onChange={(e) =>
                setVideoDetails({ ...videoDetails, muted: e.target.checked })
              }
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
            <BarLoader
              cssOverride={{ borderRadius: 60 }}
              width={60}
              color="#ffffff"
            />
          ) : (
            'Create activity'
          )}
        </button>
      </div>
    </Form.Root>
  )
}

export default VideoModal
