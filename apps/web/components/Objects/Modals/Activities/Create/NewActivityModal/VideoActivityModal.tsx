import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CaretDown, UploadSimple, YoutubeLogo } from '@phosphor-icons/react'
import { constructAcceptValue } from '@/lib/constants'
import CaptionsSettings, {
  type CaptionsValue,
  EMPTY_CAPTIONS,
} from '@components/Objects/Activities/Video/CaptionsSettings'
import { INPUT, SegmentedControl } from '@components/Dashboard/Shared/DashKit/DashKit'
import { ActivityField, FilePicker, ModalFormActions, nameFromFile, useModalFormId } from '../../activityFormKit'

const SUPPORTED_FILES = constructAcceptValue(['mp4', 'webm'])
const SMALL_INPUT = `${INPUT} text-center tabular-nums`

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

const toParts = (total: number) => ({ minutes: Math.floor(total / 60), seconds: total % 60 })

function VideoModal({
  submitFileActivity,
  submitExternalVideo,
  chapterId,
  course,
}: any) {
  const { t } = useTranslation()
  const formId = useModalFormId()
  const [video, setVideo] = useState<File | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [name, setName] = useState('')
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [source, setSource] = useState<'file' | 'youtube'>('file')
  const [showPlayback, setShowPlayback] = useState(false)
  const [videoDetails, setVideoDetails] = useState<VideoDetails>({
    startTime: 0,
    endTime: null,
    autoplay: false,
    muted: false,
  })
  const [captions, setCaptions] = useState<CaptionsValue>(EMPTY_CAPTIONS)

  const handleFile = (file: File | null) => {
    setVideo(file)
    if (file && !name.trim()) setName(nameFromFile(file))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSubmitting) return
    setIsSubmitting(true)

    try {
      if (source === 'file' && video) {
        await submitFileActivity(
          video,
          'video',
          {
            name: name.trim(),
            chapter_id: chapterId,
            activity_type: 'TYPE_VIDEO',
            activity_sub_type: 'SUBTYPE_VIDEO_HOSTED',
            published_version: 1,
            version: 1,
            course_id: course.id,
            details: videoDetails,
          },
          chapterId,
          captions.enabled && captions.languages.length > 0
            ? {
                enabled: true,
                source_language: captions.sourceLang,
                languages: captions.languages.map((l) => ({ code: l.code, label: l.label })),
              }
            : undefined
        )
      }

      if (source === 'youtube') {
        const external_video_object: ExternalVideoObject = {
          name: name.trim(),
          type: 'youtube',
          uri: youtubeUrl.trim(),
          chapter_id: chapterId,
          details: videoDetails,
        }
        await submitExternalVideo(external_video_object, 'activity', chapterId)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const start = toParts(videoDetails.startTime)
  const end = videoDetails.endTime ? toParts(videoDetails.endTime) : { minutes: 0, seconds: 0 }
  const setStart = (minutes: number, seconds: number) =>
    setVideoDetails({ ...videoDetails, startTime: Math.max(0, minutes) * 60 + Math.min(59, Math.max(0, seconds)) })
  const setEnd = (minutes: number, seconds: number) => {
    const total = Math.max(0, minutes) * 60 + Math.min(59, Math.max(0, seconds))
    // An end before the start is ignored, as before; 0 clears it.
    if (total === 0) setVideoDetails({ ...videoDetails, endTime: null })
    else if (total > videoDetails.startTime) setVideoDetails({ ...videoDetails, endTime: total })
  }

  const canSubmit = !!name.trim() && (source === 'file' ? !!video : !!youtubeUrl.trim())

  const timeInputs = (
    value: { minutes: number; seconds: number },
    onChange: (minutes: number, seconds: number) => void,
    label: string
  ) => (
    <div className="flex items-center gap-1.5" role="group" aria-label={label}>
      <input
        type="number"
        min={0}
        value={value.minutes}
        onChange={(e) => onChange(parseInt(e.target.value) || 0, value.seconds)}
        className={`${SMALL_INPUT} w-16`}
        aria-label={`${label} (${t('activities.modal.min')})`}
      />
      <span className="text-xs text-neutral-400">{t('activities.modal.min')}</span>
      <input
        type="number"
        min={0}
        max={59}
        value={value.seconds}
        onChange={(e) => onChange(value.minutes, parseInt(e.target.value) || 0)}
        className={`${SMALL_INPUT} w-16`}
        aria-label={`${label} (${t('activities.modal.sec')})`}
      />
      <span className="text-xs text-neutral-400">{t('activities.modal.sec')}</span>
    </div>
  )

  return (
    <form id={formId} onSubmit={handleSubmit} className="space-y-4">
      <ActivityField label={t('activities.modal.activity_name')} htmlFor="video-activity-name">
        <input
          id="video-activity-name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          type="text"
          required
          placeholder={t('activities.modal.enter_name')}
          className={INPUT}
        />
      </ActivityField>

      <ActivityField
        label={t('activities.modal.source')}
        aside={
          <SegmentedControl
            ariaLabel={t('activities.modal.source')}
            value={source}
            onChange={(v) => v && setSource(v)}
            options={[
              { key: 'file', label: <><UploadSimple size={13} />{t('media.upload')}</> },
              { key: 'youtube', label: <><YoutubeLogo size={13} />YouTube</> },
            ]}
          />
        }
      >
        {source === 'file' ? (
          <FilePicker
            accept={SUPPORTED_FILES}
            file={video}
            onChange={handleFile}
            required
            title={t('dashboard.courses.editor.activity_form.video_title')}
            hint={t('dashboard.courses.editor.activity_form.video_hint')}
          />
        ) : (
          <input
            value={youtubeUrl}
            onChange={(e) => setYoutubeUrl(e.target.value)}
            type="url"
            required
            aria-label={t('activities.modal.youtube_url')}
            placeholder="https://youtube.com/watch?v=..."
            className={INPUT}
          />
        )}
      </ActivityField>

      {/* Rarely needed, so folded away by default. */}
      <div className="rounded-xl ring-1 ring-inset ring-neutral-200">
        <button
          type="button"
          onClick={() => setShowPlayback((v) => !v)}
          aria-expanded={showPlayback}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 text-start"
        >
          <span>
            <span className="block text-sm font-semibold text-neutral-800">{t('activities.modal.video_settings')}</span>
            <span className="block text-xs text-neutral-400">{t('dashboard.courses.editor.activity_form.playback_hint')}</span>
          </span>
          <CaretDown size={14} className={`text-neutral-400 transition-transform ${showPlayback ? 'rotate-180' : ''}`} />
        </button>
        {showPlayback && (
          <div className="border-t border-neutral-100 px-4 py-4 space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <ActivityField label={t('activities.modal.start_time')}>
                {timeInputs(start, setStart, t('activities.modal.start_time'))}
              </ActivityField>
              <ActivityField label={t('activities.modal.end_time_optional')}>
                {timeInputs(end, setEnd, t('activities.modal.end_time_optional'))}
              </ActivityField>
            </div>
            <div className="flex flex-wrap items-center gap-5">
              <label className="flex items-center gap-2 cursor-pointer text-sm text-neutral-700">
                <input
                  type="checkbox"
                  checked={videoDetails.autoplay}
                  onChange={(e) => setVideoDetails({ ...videoDetails, autoplay: e.target.checked })}
                  className="accent-neutral-900"
                />
                {t('activities.modal.autoplay')}
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm text-neutral-700">
                <input
                  type="checkbox"
                  checked={videoDetails.muted}
                  onChange={(e) => setVideoDetails({ ...videoDetails, muted: e.target.checked })}
                  className="accent-neutral-900"
                />
                {t('activities.modal.start_muted')}
              </label>
            </div>
          </div>
        )}
      </div>

      {source === 'file' && <CaptionsSettings value={captions} onChange={setCaptions} />}

      <ModalFormActions submitting={isSubmitting} canSubmit={canSubmit} label={t('activities.modal.create_activity')} />
    </form>
  )
}

export default VideoModal
