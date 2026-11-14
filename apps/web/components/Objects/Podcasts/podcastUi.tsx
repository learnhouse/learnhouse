'use client'

import React from 'react'
import type { TFunction } from 'i18next'
import type { Podcast, PodcastEpisode } from '@services/podcasts/podcasts'
import { getEpisodeThumbnailMediaDirectory, getPodcastThumbnailMediaDirectory } from '@services/media/media'

// Shared bits of the learner podcast screens: covers, the "now playing" bars
// and the duration/date wording.

type CoverPodcast = Pick<Podcast, 'podcast_uuid' | 'thumbnail_image'>
type CoverEpisode = Pick<PodcastEpisode, 'episode_uuid' | 'thumbnail_image'>

export function podcastCover(orgUuid: string | undefined, podcast: CoverPodcast | null | undefined): string | null {
  if (!orgUuid || !podcast?.thumbnail_image) return null
  return getPodcastThumbnailMediaDirectory(orgUuid, podcast.podcast_uuid, podcast.thumbnail_image)
}

/** The episode's own cover, else the podcast's. */
export function episodeCover(
  orgUuid: string | undefined,
  podcast: CoverPodcast | null | undefined,
  episode: CoverEpisode | null | undefined
): string | null {
  if (orgUuid && podcast && episode?.thumbnail_image) {
    return getEpisodeThumbnailMediaDirectory(orgUuid, podcast.podcast_uuid, episode.episode_uuid, episode.thumbnail_image)
  }
  return podcastCover(orgUuid, podcast)
}

/** API dates come as "2026-11-01 10:04:27.9", which Safari won't parse. */
export function parseApiDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T'))
  return isNaN(date.getTime()) ? null : date
}

/** Playable episodes, most recently added first. */
export function newestFirst(episodes: PodcastEpisode[] | null | undefined): PodcastEpisode[] {
  const list = Array.isArray(episodes) ? episodes.filter((e) => e?.audio_file) : []
  return list.sort((a, b) => {
    const da = parseApiDate(a.creation_date)?.getTime() ?? 0
    const db = parseApiDate(b.creation_date)?.getTime() ?? 0
    return db - da || (b.episode_number ?? 0) - (a.episode_number ?? 0)
  })
}

export function latestEpisode(episodes: PodcastEpisode[] | null | undefined): PodcastEpisode | undefined {
  return newestFirst(episodes)[0]
}

/** "Nov 1, 2026", or "3 days ago" for the last week. */
export function formatEpisodeDate(value: string | null | undefined, locale: string): string | null {
  const date = parseApiDate(value)
  if (!date) return null
  const days = Math.round((date.getTime() - Date.now()) / 86_400_000)
  if (days > -7 && days <= 0) {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(days, 'day')
  }
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return new Intl.DateTimeFormat(locale, sameYear ? { month: 'short', day: 'numeric' } : { dateStyle: 'medium' }).format(date)
}

/** Added in the last seven days, for a "New" badge. */
export function isWithinWeek(value: string | null | undefined): boolean {
  const date = parseApiDate(value)
  return !!date && Date.now() - date.getTime() < 7 * 86_400_000
}

/** "42 min", "1 hr 5 min", "45 sec". */
export function formatLength(seconds: number, t: TFunction): string {
  const s = Math.max(0, Math.round(seconds || 0))
  if (s < 60) return t('podcasts.listen.length_sec', { count: s })
  const h = Math.floor(s / 3600)
  const m = Math.round((s % 3600) / 60)
  if (!h) return t('podcasts.listen.length_min', { count: m })
  return t('podcasts.listen.length_hr_min', { h, m })
}

/** Player clock: 0:42, 12:05, 1:02:03. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

const EQ_KEYFRAMES =
  '@keyframes lh-eq{0%,100%{transform:scaleY(.35)}50%{transform:scaleY(1)}}.lh-eq-bar{transform-origin:bottom;animation:lh-eq .9s ease-in-out infinite}@media (prefers-reduced-motion:reduce){.lh-eq-bar{animation:none}}'

/** Three bouncing bars for the episode that is playing; still when paused or
 *  when the listener prefers reduced motion. */
export function Equalizer({ playing = true, className = '' }: { playing?: boolean; className?: string }) {
  return (
    <span aria-hidden className={`inline-flex items-end gap-[2px] h-3.5 ${className}`}>
      {/* React hoists and dedupes this, so a long list adds one rule. */}
      <style href="lh-podcast-eq" precedence="default">
        {EQ_KEYFRAMES}
      </style>
      {[0, 0.3, 0.15].map((delay, i) => (
        <span
          key={i}
          className={`w-[3px] h-full rounded-full bg-current ${playing ? 'lh-eq-bar' : ''}`}
          style={playing ? { animationDelay: `${-delay * 3}s` } : { transform: `scaleY(${[0.5, 0.85, 0.65][i]})`, transformOrigin: 'bottom' }}
        />
      ))}
    </span>
  )
}

/** Thin listened-so-far bar. */
export function ListenBar({ fraction, className = '' }: { fraction: number; className?: string }) {
  return (
    <div className={`h-1 rounded-full bg-neutral-200/80 overflow-hidden ${className}`}>
      <div className="h-full rounded-full bg-neutral-900" style={{ width: `${Math.round(fraction * 100)}%` }} />
    </div>
  )
}
