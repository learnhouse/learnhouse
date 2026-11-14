'use client'

import React from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle, Pause, Play } from '@phosphor-icons/react'
import { PodcastEpisode, Podcast } from '@services/podcasts/podcasts'
import { usePodcastPlayer } from '@components/Contexts/PodcastPlayerContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import ThumbnailImage from '@components/Objects/Thumbnails/ThumbnailImage'
import { type ListeningEntry, listenedFraction } from '@components/Objects/Podcasts/listeningProgress'
import {
  Equalizer,
  ListenBar,
  episodeCover,
  formatEpisodeDate,
  formatLength,
} from '@components/Objects/Podcasts/podcastUi'

interface EpisodeCardProps {
  episode: PodcastEpisode
  podcast: Podcast
  /** Show the episode's own cover when it has one. */
  showThumbnail?: boolean
  /** Where the listener stopped in this episode, if anywhere. */
  progress?: ListeningEntry
}

/**
 * One row of a podcast's episode list: number (or the equalizer while it
 * plays), title, date, length, a line of description and how much is left.
 * The whole row plays/pauses; the round button on the end is the keyboard
 * and screen-reader target.
 */
export default function EpisodeCard({ episode, podcast, showThumbnail = true, progress }: EpisodeCardProps) {
  const { t, i18n } = useTranslation()
  const { state, playEpisode, togglePlay } = usePodcastPlayer()
  const org = useOrg() as any
  const { track } = useLHAnalytics('learner')

  const isCurrent = state.currentEpisode?.episode_uuid === episode.episode_uuid
  const isPlaying = isCurrent && state.isPlaying
  const playable = !!episode.audio_file

  const handlePlay = () => {
    if (!playable) return
    if (isCurrent) {
      if (!isPlaying) {
        track(AnalyticsEvent.EpisodePlayed, {
          episode_number: episode.episode_number,
          duration_seconds: episode.duration_seconds,
        })
      }
      togglePlay()
    } else {
      track(AnalyticsEvent.EpisodePlayed, {
        episode_number: episode.episode_number,
        duration_seconds: episode.duration_seconds,
      })
      playEpisode(episode, podcast)
    }
  }

  // Live position for the episode in the player, saved position otherwise.
  const length = (isCurrent && state.duration) || progress?.d || episode.duration_seconds || 0
  const listened = isCurrent ? state.currentTime : progress?.t ?? 0
  const fraction = isCurrent ? (length ? Math.min(1, listened / length) : 0) : listenedFraction(progress)
  const played = !isCurrent && !!progress?.done && fraction >= 0.99
  const started = fraction > 0.01 && !played
  const date = formatEpisodeDate(episode.creation_date, i18n.language)
  const ownCover = showThumbnail && episode.thumbnail_image ? episodeCover(org?.org_uuid, podcast, episode) : null
  const label = isPlaying ? t('podcasts.listen.pause_episode', { title: episode.title }) : t('podcasts.listen.play_episode', { title: episode.title })

  return (
    <div
      data-kbd-item=""
      onClick={handlePlay}
      className={`group relative flex items-start gap-3 sm:gap-4 px-3 sm:px-5 py-3.5 sm:py-4 transition-colors ${
        playable ? 'cursor-pointer' : 'opacity-60'
      } ${isCurrent ? 'bg-neutral-50' : 'hover:bg-neutral-50/70'}`}
    >
      {isCurrent && <span aria-hidden className="absolute inset-y-0 start-0 w-0.5 bg-neutral-900" />}

      {/* Number, or what is happening with this episode */}
      <div className="w-7 sm:w-8 h-10 shrink-0 flex items-center justify-center text-neutral-400">
        {isCurrent ? (
          isPlaying ? (
            <Equalizer className="text-neutral-900 group-hover:hidden" />
          ) : (
            <Play size={16} weight="fill" className="text-neutral-900 rtl:-scale-x-100" />
          )
        ) : played ? (
          <CheckCircle size={18} weight="fill" className="text-emerald-500 group-hover:hidden" />
        ) : (
          <span className="text-sm font-semibold tabular-nums group-hover:hidden">{episode.episode_number}</span>
        )}
        {isPlaying ? (
          <Pause size={16} weight="fill" className="hidden group-hover:block text-neutral-900" />
        ) : (
          !isCurrent && playable && <Play size={16} weight="fill" className="hidden group-hover:block text-neutral-900 rtl:-scale-x-100" />
        )}
      </div>

      {ownCover && (
        <ThumbnailImage src={ownCover} alt="" className="w-12 h-12 sm:w-14 sm:h-14 rounded-lg ring-1 ring-black/5 shrink-0" />
      )}

      <div className="flex-1 min-w-0">
        <h3
          className={`text-[15px] leading-snug line-clamp-2 sm:line-clamp-1 ${isCurrent ? 'font-bold text-neutral-900' : 'font-semibold text-neutral-800'}`}
          dir="auto"
        >
          {episode.title}
        </h3>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-neutral-500">
          {date && <span>{date}</span>}
          {date && <span aria-hidden className="text-neutral-300">·</span>}
          <span className="tabular-nums">
            {started
              ? t('podcasts.listen.time_left', { time: formatLength(length - listened, t) })
              : formatLength(length, t)}
          </span>
          {played && (
            <>
              <span aria-hidden className="text-neutral-300">·</span>
              <span className="font-medium text-emerald-700">{t('podcasts.listen.played')}</span>
            </>
          )}
          {!episode.published && (
            <span className="ms-1 rounded-full px-1.5 py-px text-[10px] font-semibold text-amber-800 bg-amber-50 ring-1 ring-inset ring-amber-600/10">
              {t('podcasts.unpublished')}
            </span>
          )}
        </div>
        {episode.description && (
          <p className="mt-1.5 text-[13px] text-neutral-500 leading-relaxed line-clamp-2" dir="auto">
            {episode.description}
          </p>
        )}
        {started && <ListenBar fraction={fraction} className="mt-2.5 w-28 sm:w-40" />}
      </div>

      <button
        type="button"
        disabled={!playable}
        onClick={(e) => {
          e.stopPropagation()
          handlePlay()
        }}
        aria-label={label}
        aria-pressed={isPlaying}
        className={`mt-0.5 w-9 h-9 rounded-full shrink-0 flex items-center justify-center transition ${
          isCurrent
            ? 'bg-neutral-900 text-white shadow-[0_1px_1px_rgba(0,0,0,0.12)] hover:bg-neutral-800'
            : 'bg-white text-neutral-700 shadow-[0_1px_1px_rgba(0,0,0,0.03),0_0_0_1px_rgba(0,0,0,0.08)] hover:text-neutral-900 group-hover:shadow-[0_1px_1px_rgba(0,0,0,0.05),0_0_0_1px_rgba(0,0,0,0.14)]'
        } active:scale-95 disabled:opacity-50`}
      >
        {isPlaying ? <Pause size={15} weight="fill" /> : <Play size={15} weight="fill" className="ms-0.5 rtl:-scale-x-100" />}
      </button>
    </div>
  )
}
