import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CaretDown, Link as LinkIcon, UploadSimple } from '@phosphor-icons/react'
import { constructAcceptValue } from '@/lib/constants'
import CaptionsSettings, {
  type CaptionsValue,
  EMPTY_CAPTIONS,
} from '@components/Objects/Activities/Video/CaptionsSettings'
import { INPUT, SegmentedControl } from '@components/Dashboard/Shared/DashKit/DashKit'
import { VideoLinkField, VideoTrimFields } from '@components/Objects/Activities/Video/VideoSourceFields'
import type { VideoLinkMatch } from '@components/Objects/Activities/Video/providers/registry'
import { ActivityField, FilePicker, ModalFormActions, nameFromFile, useModalFormId } from '../../activityFormKit'

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
  const { t } = useTranslation()
  const formId = useModalFormId()
  const [video, setVideo] = useState<File | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [name, setName] = useState('')
  const [videoUrl, setVideoUrl] = useState('')
  const [linkMatch, setLinkMatch] = useState<VideoLinkMatch | null>(null)
  const [source, setSource] = useState<'file' | 'link'>('file')
  const [showPlayback, setShowPlayback] = useState(false)
  const [videoDetails, setVideoDetails] = useState<VideoDetails>({
    startTime: 0,
    endTime: null,
    autoplay: true,
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

      if (source === 'link' && linkMatch) {
        const external_video_object: ExternalVideoObject = {
          name: name.trim(),
          type: linkMatch.provider,
          uri: linkMatch.sourceUrl,
          chapter_id: chapterId,
          details: videoDetails,
        }
        await submitExternalVideo(external_video_object, 'activity', chapterId)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const canSubmit = !!name.trim() && (source === 'file' ? !!video : !!linkMatch)

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
              { key: 'link', label: <><LinkIcon size={13} />{t('activities.modal.link', 'Link')}</> },
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
          <VideoLinkField value={videoUrl} onChange={setVideoUrl} onMatch={setLinkMatch} />
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
            <VideoTrimFields
              start={videoDetails.startTime}
              end={videoDetails.endTime}
              onChange={(trim) => setVideoDetails({ ...videoDetails, ...trim })}
            />
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
