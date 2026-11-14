'use client'
import React, { useEffect, useState } from 'react'
import { CreditsIcon } from '@components/Objects/AI/CreditCost'
import { useAICreditPrices } from '@components/Hooks/useAICredits'
import BarLoader from 'react-spinners/BarLoader'
import { YoutubeLogo } from '@phosphor-icons/react'
import { AIButton } from '@components/Objects/AI/AIBrand'
import { constructAcceptValue } from '@/lib/constants'
import CaptionsSettings, {
  type CaptionsValue,
  EMPTY_CAPTIONS,
} from '@components/Objects/Activities/Video/CaptionsSettings'
import ChaptersSettings, { type ChaptersMeta } from '@components/Objects/Activities/Video/ChaptersSettings'
import {
  getActivity,
  updateHostedVideoActivity,
  updateExternalVideoActivity,
  updateVideoCaptions,
} from '@services/courses/activities'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import toast from 'react-hot-toast'
import { mutate } from 'swr'
import { useTranslation } from 'react-i18next'
import { Button, INPUT } from '@components/Dashboard/Shared/DashKit/DashKit'
import { FilePicker, ModalFormActions, useModalFormId } from '../activityFormKit'

const SUPPORTED_FILES = constructAcceptValue(['mp4', 'webm'])

interface VideoDetails {
  startTime: number
  endTime: number | null
  autoplay: boolean
  muted: boolean
}

interface EditVideoActivityModalProps {
  activity: any
  courseUuid?: string
  orgSlug?: string
  onClose: () => void
}

function EditVideoActivityModal({ activity, onClose }: EditVideoActivityModalProps) {
  const { t } = useTranslation()
  const { estimate: estimateCredits } = useAICreditPrices()
  const formId = useModalFormId()
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

  // --- AI captions state (hosted video only) ---
  const [captions, setCaptions] = useState<CaptionsValue>(EMPTY_CAPTIONS)
  const [capStatus, setCapStatus] = useState<string | null>(null)
  const [isSavingCaptions, setIsSavingCaptions] = useState(false)
  const [chaptersMeta, setChaptersMeta] = useState<ChaptersMeta | null>(null)
  const [hasReadyCaptions, setHasReadyCaptions] = useState(false)

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
      setChaptersMeta(data?.extra_metadata?.chapters || null)
      const caps = data?.extra_metadata?.captions
      setHasReadyCaptions(!!caps?.languages?.some((l: any) => l?.status === 'ready'))
      if (caps) {
        setCapStatus(caps.status || null)
        setCaptions({
          enabled: !!caps.enabled,
          sourceLang: caps.source_language || 'auto',
          languages: (caps.languages || []).map((l: any) => ({
            code: l.code,
            label: l.label || l.code,
            status: l.status,
          })),
        })
      }
      setIsLoading(false)
    }
    loadActivity()
  }, [activity.activity_uuid])

  const saveCaptions = async () => {
    setIsSavingCaptions(true)
    const toastId = toast.loading(t('activities.edit_modal.saving_captions'))
    try {
      const res = await updateVideoCaptions(
        activity.activity_uuid,
        {
          enabled: captions.enabled,
          source_language: captions.sourceLang,
          languages: captions.languages.map((l) => ({ code: l.code, label: l.label })),
        },
        access_token
      )
      if (res?.success === false) {
        toast.error(res?.data?.detail || t('activities.edit_modal.save_captions_failed'), { id: toastId })
      } else {
        toast.success(
          captions.enabled ? t('activities.edit_modal.captions_queued') : t('activities.edit_modal.captions_disabled'),
          { id: toastId }
        )
        setCapStatus(res?.data?.status || (captions.enabled ? 'queued' : 'idle'))
      }
    } catch {
      toast.error(t('activities.edit_modal.save_captions_failed'), { id: toastId })
    } finally {
      setIsSavingCaptions(false)
    }
  }

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

    const toastId = toast.loading(t('activities.edit_modal.updating_video'))
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
        toast.error(t('activities.edit_modal.update_video_failed'), { id: toastId })
      } else {
        toast.success(t('activities.edit_modal.video_updated'), { id: toastId })
        mutate((key: string) => typeof key === 'string' && key.includes('/courses/org_slug/'))
        onClose()
      }
    } catch {
      toast.error(t('activities.edit_modal.update_video_failed'), { id: toastId })
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
    <form id={formId} onSubmit={handleSubmit} className="space-y-4">

      <div className="rounded-xl ring-1 ring-inset ring-neutral-200 p-4 space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-neutral-800">{t('activities.modal.activity_name')}</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            type="text"
            required
            placeholder={t('activities.modal.enter_name')}
            className={INPUT}
          />
        </div>

        {isYouTube ? (
          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-neutral-800">{t('activities.modal.youtube_url')}</label>
            <div className="flex items-center gap-2 text-xs text-neutral-400 mb-1">
              <YoutubeLogo size={14} weight="duotone" />
              <span>{t('activities.edit_modal.update_youtube_hint')}</span>
            </div>
            <input
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
              type="text"
              required
              placeholder="https://youtube.com/watch?v=..."
              className={INPUT}
            />
          </div>
        ) : (
          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-neutral-800">{t('activities.edit_modal.replace_video')}</label>
            <FilePicker
              accept={SUPPORTED_FILES}
              file={videoFile}
              onChange={setVideoFile}
              title={t('dashboard.courses.editor.activity_form.video_title')}
              hint={t('activities.edit_modal.keep_current_video')}
            />
          </div>
        )}
      </div>

      <div className="rounded-xl ring-1 ring-inset ring-neutral-200 p-4 space-y-4">
        <h3 className="text-sm font-semibold text-neutral-800">{t('activities.modal.video_settings')}</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-neutral-500">{t('activities.modal.start_time')}</label>
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
                  className={INPUT}
                />
                <span className="text-[11px] text-neutral-400 mt-0.5 block">{t('activities.modal.min')}</span>
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
                  className={INPUT}
                />
                <span className="text-[11px] text-neutral-400 mt-0.5 block">{t('activities.modal.sec')}</span>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-neutral-500">{t('activities.modal.end_time_optional')}</label>
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
                  className={INPUT}
                />
                <span className="text-[11px] text-neutral-400 mt-0.5 block">{t('activities.modal.min')}</span>
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
                  className={INPUT}
                />
                <span className="text-[11px] text-neutral-400 mt-0.5 block">{t('activities.modal.sec')}</span>
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
              className="accent-neutral-900"
            />
            <span className="text-sm text-neutral-600">{t('activities.modal.autoplay')}</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={videoDetails.muted}
              onChange={(e) => setVideoDetails({ ...videoDetails, muted: e.target.checked })}
              className="accent-neutral-900"
            />
            <span className="text-sm text-neutral-600">{t('activities.modal.start_muted')}</span>
          </label>
        </div>
      </div>

      {!isYouTube && (
        <div className="space-y-2">
          <CaptionsSettings value={captions} onChange={setCaptions} status={capStatus} />
          <div className="flex items-center justify-end gap-3">
            {captions.enabled && estimateCredits('captions') != null && (
              <span className="inline-flex items-center gap-1 text-[12px] text-neutral-500">
                <CreditsIcon size={11} />
                {t('ai_credits.captions.per_minute', {
                  count: estimateCredits('captions') ?? 0,
                  defaultValue: 'About {{count}} credits per minute of video, plus each translation',
                })}
              </span>
            )}
            {captions.enabled ? (
              <AIButton size="sm" onClick={saveCaptions} loading={isSavingCaptions}>
                {t('activities.edit_modal.generate_captions')}
              </AIButton>
            ) : (
              <Button variant="primary" size="sm" onClick={saveCaptions} loading={isSavingCaptions}>
                {t('common.save')}
              </Button>
            )}
          </div>
          <ChaptersSettings
            activityUuid={activity.activity_uuid}
            accessToken={access_token}
            initial={chaptersMeta}
            hasCaptions={hasReadyCaptions}
          />
        </div>
      )}

      <ModalFormActions submitting={isSubmitting} canSubmit={!!name.trim()} label={t('common.save_changes')} />
    </form>
  )
}

export default EditVideoActivityModal
