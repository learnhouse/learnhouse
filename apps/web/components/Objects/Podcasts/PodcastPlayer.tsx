'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  CaretDown,
  Pause,
  Play,
  SpeakerHigh,
  SpeakerLow,
  SpeakerSlash,
  X,
} from '@phosphor-icons/react'
import { PLAYBACK_RATES, usePodcastPlayer } from '@components/Contexts/PodcastPlayerContext'
import { useShortcut } from '@/lib/shortcuts/ShortcutsContext'
import { useOrg, useOrgMembership } from '@components/Contexts/OrgContext'
import ThumbnailImage from '@components/Objects/Thumbnails/ThumbnailImage'
import { getUriWithOrg } from '@services/config/config'
import { episodeCover, formatClock } from '@components/Objects/Podcasts/podcastUi'
import { resourcePath } from '@/lib/seo/paths'

/**
 * The persistent podcast player. Desktop: one bar along the bottom with every
 * control. Phones: a compact floating bar above the tab bar that opens into a
 * full-screen "now playing" sheet. Playback itself lives in the context, so
 * the audio keeps going across page navigations.
 */
export default function PodcastPlayer() {
  const { state, togglePlay, seekTo, skip, setVolume, setPlaybackRate, closePlayer, toggleMinimize } = usePodcastPlayer()
  const { t } = useTranslation()
  const org = useOrg() as any
  const { orgslug } = useOrgMembership()
  const { currentEpisode, podcast, isPlaying, currentTime, duration, volume, isMinimized, isVisible, playbackRate } = state

  useShortcut(
    { id: 'podcast.toggle', keys: 'p', group: 'global', label: t('shortcuts.play_pause_podcast'), run: togglePlay },
    isVisible && !!currentEpisode,
  )

  // The full-screen sheet locks page scroll while open, on phones only.
  const sheetOpen = isVisible && !isMinimized
  useEffect(() => {
    if (!sheetOpen || window.matchMedia('(min-width: 768px)').matches) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [sheetOpen])

  if (!isVisible || !currentEpisode || !podcast) return null

  const cover = episodeCover(org?.org_uuid, podcast, currentEpisode)
  const podcastHref = orgslug ? getUriWithOrg(orgslug, resourcePath('podcast', podcast)) : null
  const total = duration || currentEpisode.duration_seconds || 0
  const fraction = total ? Math.min(1, currentTime / total) : 0
  const nextRate = () => {
    const i = PLAYBACK_RATES.indexOf(playbackRate as (typeof PLAYBACK_RATES)[number])
    setPlaybackRate(PLAYBACK_RATES[(i + 1) % PLAYBACK_RATES.length])
  }

  // Space toggles playback while focus is anywhere in the player, except on
  // controls that already use it (buttons, links, the volume slider).
  const onKeyDown = (e: React.KeyboardEvent) => {
    const el = e.target as HTMLElement
    const onScrubber = el.tagName === 'INPUT' && 'scrubber' in el.dataset
    if (e.key === ' ' && (onScrubber || !['BUTTON', 'A', 'INPUT'].includes(el.tagName))) {
      e.preventDefault()
      togglePlay()
    } else if (e.key === 'Escape' && !isMinimized) {
      toggleMinimize()
    }
  }

  const playLabel = isPlaying ? t('podcasts.listen.pause') : t('podcasts.listen.play')

  return (
    <>
      {/* Room at the end of every page so the bar never covers the footer. */}
      <div aria-hidden className="h-[76px] md:h-16" />

      {/* Desktop bar */}
      <div
        role="region"
        aria-label={t('podcasts.listen.player')}
        onKeyDown={onKeyDown}
        className="hidden md:block fixed bottom-0 inset-x-0 h-16 bg-white shadow-[0_-1px_0_rgba(0,0,0,0.06),0_-12px_32px_-16px_rgba(0,0,0,0.18)]"
        style={{ zIndex: 'var(--z-nav)' }}
      >
        <div className="h-full px-4 lg:px-6 grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)] items-center gap-4">
          {/* Now playing */}
          <div className="flex items-center gap-3 min-w-0">
            <NowPlayingCover src={cover} playing={isPlaying} className="w-11 h-11 rounded-lg" />
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-neutral-900 truncate" dir="auto" title={currentEpisode.title}>
                {currentEpisode.title}
              </p>
              {podcastHref ? (
                <Link href={podcastHref} className="block text-xs text-neutral-500 hover:text-neutral-900 hover:underline underline-offset-2 truncate" dir="auto">
                  {podcast.name}
                </Link>
              ) : (
                <p className="text-xs text-neutral-500 truncate" dir="auto">{podcast.name}</p>
              )}
            </div>
          </div>

          {/* Transport + scrubber */}
          <div className="flex flex-col items-center justify-center gap-0.5 min-w-0">
            <div className="flex items-center gap-2">
              <SkipButton dir="back" onClick={() => skip(-15)} label={t('media.audio.skip_back')} />
              <button
                type="button"
                onClick={togglePlay}
                aria-label={playLabel}
                title={`${playLabel} (P)`}
                className="w-8 h-8 rounded-full bg-neutral-900 text-white flex items-center justify-center shadow-[0_1px_1px_rgba(0,0,0,0.12)] hover:bg-neutral-800 hover:scale-105 active:scale-95 transition"
              >
                {isPlaying ? <Pause size={15} weight="fill" /> : <Play size={15} weight="fill" className="ms-0.5 rtl:-scale-x-100" />}
              </button>
              <SkipButton dir="forward" onClick={() => skip(15)} label={t('media.audio.skip_forward')} />
            </div>
            <div className="w-full max-w-xl flex items-center gap-2.5">
              <span className="w-10 text-end text-[11px] text-neutral-500 tabular-nums">{formatClock(currentTime)}</span>
              <Scrubber value={currentTime} max={total} onSeek={seekTo} label={t('podcasts.listen.seek')} />
              <span className="w-10 text-[11px] text-neutral-500 tabular-nums">-{formatClock(Math.max(0, total - currentTime))}</span>
            </div>
          </div>

          {/* Speed, volume, close */}
          <div className="flex items-center justify-end gap-1.5 min-w-0">
            <RateButton rate={playbackRate} onClick={nextRate} label={t('podcasts.listen.speed')} />
            <VolumeControl volume={volume} setVolume={setVolume} t={t} />
            <button
              type="button"
              onClick={closePlayer}
              aria-label={t('podcasts.listen.close_player')}
              title={t('podcasts.listen.close_player')}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Phone: compact floating bar */}
      {isMinimized && (
        <div
          className="md:hidden fixed inset-x-2 px-0"
          style={{ bottom: 'calc(var(--lh-mobile-nav-h) + 8px)', zIndex: 'var(--z-nav)' }}
        >
          <div className="relative overflow-hidden rounded-2xl bg-white shadow-[0_8px_24px_-8px_rgba(0,0,0,0.25),0_0_0_1px_rgba(0,0,0,0.06)]">
            <div className="flex items-center gap-3 p-2 pe-1.5">
              <button
                type="button"
                onClick={toggleMinimize}
                className="flex items-center gap-3 min-w-0 flex-1 text-start"
                aria-label={t('podcasts.listen.open_player')}
              >
                <NowPlayingCover src={cover} playing={isPlaying} className="w-11 h-11 rounded-xl" />
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-neutral-900 truncate" dir="auto">{currentEpisode.title}</span>
                  <span className="block text-xs text-neutral-500 truncate" dir="auto">{podcast.name}</span>
                </span>
              </button>
              <button
                type="button"
                onClick={togglePlay}
                aria-label={playLabel}
                className="w-10 h-10 rounded-full flex items-center justify-center text-neutral-900 active:bg-neutral-100 shrink-0"
              >
                {isPlaying ? <Pause size={22} weight="fill" /> : <Play size={22} weight="fill" className="rtl:-scale-x-100" />}
              </button>
              <button
                type="button"
                onClick={closePlayer}
                aria-label={t('podcasts.listen.close_player')}
                className="w-9 h-10 rounded-full flex items-center justify-center text-neutral-400 active:bg-neutral-100 shrink-0"
              >
                <X size={18} />
              </button>
            </div>
            <div className="absolute bottom-0 inset-x-3 h-[2px] rounded-full bg-neutral-200 overflow-hidden">
              <div className="h-full bg-neutral-900" style={{ width: `${fraction * 100}%` }} />
            </div>
          </div>
        </div>
      )}

      {/* Phone: full-screen now playing */}
      {!isMinimized && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('podcasts.listen.now_playing')}
          onKeyDown={onKeyDown}
          className="md:hidden fixed inset-0 flex flex-col bg-white px-6 pt-[max(env(safe-area-inset-top),12px)] pb-[max(env(safe-area-inset-bottom),20px)] animate-in slide-in-from-bottom-8 fade-in duration-200 motion-reduce:animate-none"
          style={{ zIndex: 'var(--z-modal)' }}
        >
          <div className="flex items-center justify-between h-12 -mx-2">
            <button
              type="button"
              onClick={toggleMinimize}
              aria-label={t('podcasts.player.minimize')}
              className="w-10 h-10 rounded-full flex items-center justify-center text-neutral-700 active:bg-neutral-100"
            >
              <CaretDown size={22} />
            </button>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">{t('podcasts.listen.now_playing')}</span>
            <button
              type="button"
              onClick={closePlayer}
              aria-label={t('podcasts.listen.close_player')}
              className="w-10 h-10 rounded-full flex items-center justify-center text-neutral-500 active:bg-neutral-100"
            >
              <X size={20} />
            </button>
          </div>

          <div className="flex-1 min-h-0 flex items-center justify-center py-4">
            <ThumbnailImage
              src={cover}
              alt=""
              loading="eager"
              className={`w-full max-w-[min(20rem,42vh)] aspect-square rounded-3xl ring-1 ring-black/5 shadow-[0_24px_48px_-24px_rgba(0,0,0,0.45)] transition-transform duration-300 motion-reduce:transition-none ${isPlaying ? 'scale-100' : 'scale-[0.92]'}`}
            />
          </div>

          <div className="space-y-1">
            <p className="text-xl font-bold tracking-tight text-neutral-900 line-clamp-2" dir="auto">{currentEpisode.title}</p>
            {podcastHref ? (
              <Link href={podcastHref} onClick={toggleMinimize} className="block text-sm text-neutral-500 truncate" dir="auto">
                {podcast.name}
              </Link>
            ) : (
              <p className="text-sm text-neutral-500 truncate" dir="auto">{podcast.name}</p>
            )}
          </div>

          <div className="mt-6">
            <Scrubber value={currentTime} max={total} onSeek={seekTo} label={t('podcasts.listen.seek')} large />
            <div className="mt-1.5 flex justify-between text-xs text-neutral-500 tabular-nums">
              <span>{formatClock(currentTime)}</span>
              <span>-{formatClock(Math.max(0, total - currentTime))}</span>
            </div>
          </div>

          <div className="mt-5 flex items-center justify-between">
            <RateButton rate={playbackRate} onClick={nextRate} label={t('podcasts.listen.speed')} large />
            <div className="flex items-center gap-5">
              <SkipButton dir="back" onClick={() => skip(-15)} label={t('media.audio.skip_back')} large />
              <button
                type="button"
                onClick={togglePlay}
                aria-label={playLabel}
                className="w-16 h-16 rounded-full bg-neutral-900 text-white flex items-center justify-center shadow-[0_8px_20px_-8px_rgba(0,0,0,0.5)] active:scale-95 transition-transform"
              >
                {isPlaying ? <Pause size={28} weight="fill" /> : <Play size={28} weight="fill" className="ms-1 rtl:-scale-x-100" />}
              </button>
              <SkipButton dir="forward" onClick={() => skip(15)} label={t('media.audio.skip_forward')} large />
            </div>
            {/* Balances the speed button so the transport stays centred. */}
            <span className="w-12" aria-hidden />
          </div>
        </div>
      )}
    </>
  )
}

function NowPlayingCover({ src, playing, className }: { src: string | null; playing: boolean; className: string }) {
  return (
    <span className={`relative shrink-0 overflow-hidden bg-neutral-100 ring-1 ring-black/5 ${className}`}>
      <ThumbnailImage src={src} alt="" className="w-full h-full" />
      {playing && <span className="absolute inset-0 bg-gradient-to-t from-black/25 to-transparent" />}
    </span>
  )
}

function SkipButton({ dir, onClick, label, large }: { dir: 'back' | 'forward'; onClick: () => void; label: string; large?: boolean }) {
  const Icon = dir === 'back' ? ArrowCounterClockwise : ArrowClockwise
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`relative rounded-full flex items-center justify-center text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 active:scale-95 transition ${
        large ? 'w-12 h-12 text-neutral-800' : 'w-8 h-8'
      }`}
    >
      <Icon size={large ? 30 : 20} className="rtl:-scale-x-100" />
      <span className={`absolute inset-0 flex items-center justify-center font-bold tabular-nums ${large ? 'text-[9px] pt-0.5' : 'text-[7px] pt-px'}`}>
        15
      </span>
    </button>
  )
}

function RateButton({ rate, onClick, label, large }: { rate: number; onClick: () => void; label: string; large?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label}: ${rate}×`}
      title={label}
      className={`rounded-lg font-semibold tabular-nums transition-colors ${
        rate !== 1 ? 'text-neutral-900 bg-neutral-100' : 'text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100'
      } ${large ? 'w-12 h-9 text-sm' : 'min-w-10 h-7 px-1.5 text-xs'}`}
    >
      {rate}×
    </button>
  )
}

function VolumeControl({ volume, setVolume, t }: { volume: number; setVolume: (_v: number) => void; t: (_k: string) => string }) {
  // Volume to come back to after unmuting.
  const [restore, setRestore] = useState(1)
  const muted = volume === 0
  const Icon = muted ? SpeakerSlash : volume < 0.5 ? SpeakerLow : SpeakerHigh
  return (
    <div className="hidden lg:flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => {
          if (muted) setVolume(restore || 1)
          else {
            setRestore(volume)
            setVolume(0)
          }
        }}
        aria-label={muted ? t('podcasts.listen.unmute') : t('podcasts.listen.mute')}
        title={muted ? t('podcasts.listen.unmute') : t('podcasts.listen.mute')}
        className="w-8 h-8 rounded-lg flex items-center justify-center text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 transition-colors"
      >
        <Icon size={17} />
      </button>
      <div className="w-24">
        <Scrubber value={volume} max={1} step={0.01} onSeek={setVolume} label={t('podcasts.listen.volume')} />
      </div>
    </div>
  )
}

/** A slim track with a native range input over it, so dragging, clicking and
 *  the arrow keys all work and screen readers get a real slider. */
function Scrubber({
  value,
  max,
  onSeek,
  label,
  step = 1,
  large,
}: {
  value: number
  max: number
  onSeek: (_v: number) => void
  label: string
  step?: number
  large?: boolean
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  const isTime = step >= 1
  return (
    <div className={`group/scrub relative flex-1 min-w-0 flex items-center ${large ? 'h-6' : 'h-4'}`}>
      <div className={`w-full rounded-full bg-neutral-200 overflow-hidden ${large ? 'h-1.5' : 'h-1'}`}>
        <div className="h-full rounded-full bg-neutral-900 group-hover/scrub:bg-neutral-700" style={{ width: `${pct}%` }} />
      </div>
      <span
        aria-hidden
        className={`absolute top-1/2 -translate-y-1/2 rounded-full bg-neutral-900 shadow pointer-events-none transition-opacity ${
          large ? 'w-4 h-4 -ms-2 opacity-100' : 'w-3 h-3 -ms-1.5 opacity-0 group-hover/scrub:opacity-100 group-focus-within/scrub:opacity-100'
        }`}
        style={{ insetInlineStart: `${pct}%` }}
      />
      <input
        type="range"
        min={0}
        max={max || 0}
        step={step}
        value={Math.min(value, max || 0)}
        onChange={(e) => onSeek(Number(e.target.value))}
        aria-label={label}
        aria-valuetext={isTime ? formatClock(value) : `${Math.round(pct)}%`}
        data-scrubber={isTime ? '' : undefined}
        disabled={!max}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-default"
      />
    </div>
  )
}
