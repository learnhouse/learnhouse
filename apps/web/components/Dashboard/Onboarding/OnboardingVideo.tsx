'use client'
import React, { useRef, useState } from 'react'
import YouTube, { YouTubeEvent, YouTubePlayer } from 'react-youtube'
import { motion, AnimatePresence } from 'motion/react'
import { SpeakerSimpleSlash, ArrowCounterClockwise } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { onboardingVideo } from './onboardingMedia'

/**
 * A walkthrough video, embedded the way YouTube video activities are (see
 * Activities/Video/Video.tsx). When it ends, `endSlot` puts the step's action
 * right where the eye already is. `autoPlayMuted` starts it silently (the
 * welcome) with a watch-with-sound pill. Callers key it by video id.
 */
export default function OnboardingVideo({
  id,
  autoPlayMuted = false,
  onEnded,
  endSlot,
  className = '',
}: {
  id: string
  autoPlayMuted?: boolean
  onEnded?: () => void
  endSlot?: React.ReactNode
  className?: string
}) {
  const { t } = useTranslation()
  const { track } = useLHAnalytics('dashboard')
  const v = onboardingVideo(id)
  const player = useRef<YouTubePlayer | null>(null)
  const played = useRef(false)
  const [muted, setMuted] = useState(autoPlayMuted)
  const [ended, setEnded] = useState(false)

  const restart = () => {
    const p = player.current
    if (!p) return
    p.unMute()
    p.seekTo(0, true)
    p.playVideo()
    setMuted(false)
    setEnded(false)
  }

  return (
    <div
      className={`relative aspect-video w-full overflow-hidden rounded-[20px] bg-gray-950 ring-1 ring-black/5 ${className}`}
    >
      <YouTube
        className="absolute inset-0 h-full w-full"
        iframeClassName="h-full w-full"
        videoId={v.youtubeId}
        opts={{
          width: '100%',
          height: '100%',
          playerVars: {
            autoplay: autoPlayMuted ? 1 : 0,
            mute: autoPlayMuted ? 1 : 0,
            controls: 1,
            modestbranding: 1,
            rel: 0,
            cc_load_policy: 1,
            playsinline: 1,
          },
        }}
        onReady={(e: YouTubeEvent) => {
          player.current = e.target
        }}
        onPlay={() => {
          setEnded(false)
          if (!played.current && !player.current?.isMuted()) {
            played.current = true
            track(AnalyticsEvent.OnboardingVideoPlayed, { video_id: id })
          }
        }}
        onEnd={() => {
          setEnded(true)
          track(AnalyticsEvent.OnboardingVideoFinished, { video_id: id })
          onEnded?.()
        }}
      />

      {/* Muted preview: one tap for sound, from the top */}
      {muted && !ended && (
        <button
          type="button"
          onClick={() => {
            restart()
            track(AnalyticsEvent.OnboardingVideoPlayed, { video_id: id, from: 'muted_preview' })
          }}
          className="absolute top-3 start-3 z-10 inline-flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-[12px] font-semibold text-gray-900 shadow-lg hover:bg-white transition-colors"
        >
          <SpeakerSimpleSlash size={14} weight="bold" />
          {t('onboarding.video.tap_for_sound')}
        </button>
      )}

      {/* End card: the step's action, or replay */}
      <AnimatePresence>
        {ended && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-gray-950/85 backdrop-blur-[2px]"
          >
            {endSlot}
            <button
              type="button"
              onClick={restart}
              className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-white/60 hover:text-white transition-colors"
            >
              <ArrowCounterClockwise size={13} weight="bold" />
              {t('onboarding.video.replay')}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
