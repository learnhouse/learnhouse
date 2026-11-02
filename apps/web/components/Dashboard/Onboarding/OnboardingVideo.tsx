'use client'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { motion, AnimatePresence } from 'motion/react'
import { SpeakerSimpleSlash, ArrowCounterClockwise, FilmSlate } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { onboardingVideo } from './onboardingMedia'

// The player is client-only (media elements, blob URLs); keep it out of the server bundle.
const LearnHousePlayer = dynamic(() => import('@components/Objects/Activities/Video/LearnHousePlayer'), {
  ssr: false,
})

/**
 * A walkthrough video in the LearnHouse player (the one courses use), with
 * captions on. When it ends, `endSlot` puts the step's action right where the
 * eye already is. `autoPlayMuted` starts it silently (the welcome) with a
 * watch-with-sound pill. Callers key it by video id so a new step starts fresh.
 */
export default function OnboardingVideo({
  id,
  title,
  autoPlayMuted = false,
  onEnded,
  endSlot,
  className = '',
}: {
  id: string
  title?: string
  autoPlayMuted?: boolean
  onEnded?: () => void
  endSlot?: React.ReactNode
  className?: string
}) {
  const { t } = useTranslation()
  const { track } = useLHAnalytics('dashboard')
  const v = onboardingVideo(id)
  // State drives the listeners; the ref is what handlers act on.
  const [el, setEl] = useState<HTMLVideoElement | null>(null)
  const elRef = useRef<HTMLVideoElement | null>(null)
  const [muted, setMuted] = useState(autoPlayMuted)
  const [ended, setEnded] = useState(false)
  const [failed, setFailed] = useState(false)

  const onVideoElement = useCallback((node: HTMLVideoElement | null) => {
    elRef.current = node
    setEl(node)
  }, [])

  useEffect(() => {
    if (!el) return
    let played = false
    const onPlay = () => {
      setEnded(false)
      if (!played && !el.muted) {
        played = true
        track(AnalyticsEvent.OnboardingVideoPlayed, { video_id: id })
      }
    }
    const onEnd = () => {
      setEnded(true)
      track(AnalyticsEvent.OnboardingVideoFinished, { video_id: id })
      onEnded?.()
    }
    const onVolume = () => setMuted(el.muted)
    const onError = () => setFailed(true)
    el.addEventListener('play', onPlay)
    el.addEventListener('ended', onEnd)
    el.addEventListener('volumechange', onVolume)
    el.addEventListener('error', onError)
    return () => {
      el.removeEventListener('play', onPlay)
      el.removeEventListener('ended', onEnd)
      el.removeEventListener('volumechange', onVolume)
      el.removeEventListener('error', onError)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el, id])

  const restart = (withSound: boolean) => {
    const node = elRef.current
    if (!node) return
    if (withSound) node.muted = false
    node.currentTime = 0
    setEnded(false)
    node.play().catch(() => {})
  }

  return (
    <div
      className={`relative aspect-video w-full overflow-hidden rounded-[20px] bg-gray-950 shadow-[0_18px_50px_-18px_rgba(17,24,39,0.45)] ${className}`}
    >
      {failed ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/50">
          <FilmSlate size={28} weight="duotone" />
          <span className="text-[12px] font-medium">
            {t('onboarding.video.unavailable')}
          </span>
        </div>
      ) : (
        <LearnHousePlayer
          src={v.src}
          poster={v.poster}
          title={title}
          captions={[{ code: 'en', label: 'English', url: v.captions }]}
          details={{ autoplay: autoPlayMuted, muted: autoPlayMuted }}
          onVideoElement={onVideoElement}
        />
      )}

      {/* Muted preview: one tap for sound, from the top */}
      {muted && !ended && !failed && (
        <button
          type="button"
          onClick={() => restart(true)}
          className="absolute top-3 start-3 z-10 inline-flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-[12px] font-semibold text-gray-900 shadow-lg hover:bg-white transition-colors"
        >
          <SpeakerSimpleSlash size={14} weight="bold" />
          {t('onboarding.video.tap_for_sound')}
        </button>
      )}

      {/* End card: the step's action, or replay */}
      <AnimatePresence>
        {ended && !failed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-gray-950/80 backdrop-blur-[2px]"
          >
            {endSlot}
            <button
              type="button"
              onClick={() => restart(true)}
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
