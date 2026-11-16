'use client'

import { useSyncExternalStore } from 'react'
import type { Podcast, PodcastEpisode } from '@services/podcasts/podcasts'

// Where a listener stopped in each episode, kept in this browser only (the API
// has no listening history). Small and capped; every storage access is guarded
// because private windows and blocked site data throw.

const KEY = 'lh:podcast-progress:v1'
const MAX_ENTRIES = 40
// Closer than this to the end counts as played.
const DONE_MARGIN = 10

type StoredEpisode = Pick<
  PodcastEpisode,
  'episode_uuid' | 'title' | 'audio_file' | 'thumbnail_image' | 'duration_seconds' | 'episode_number'
>
type StoredPodcast = Pick<Podcast, 'podcast_uuid' | 'name' | 'thumbnail_image'>

export interface ListeningEntry {
  /** Seconds listened. */
  t: number
  /** Episode length in seconds, as the audio reported it. */
  d: number
  done: boolean
  /** Last update, ms since epoch. */
  at: number
  episode: StoredEpisode
  podcast: StoredPodcast
}

type Store = Record<string, ListeningEntry>

const EMPTY: Store = {}
let cache: Store | null = null
const listeners = new Set<() => void>()

function read(): Store {
  if (cache) return cache
  try {
    const raw = window.localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : null
    cache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    cache = {}
  }
  return cache as Store
}

function write(next: Store) {
  cache = next
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* storage full or blocked: progress just won't survive a reload */
  }
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  // Another tab saved progress: drop the cache so the next read picks it up.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return
    cache = null
    listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function getListening(episodeUuid: string): ListeningEntry | undefined {
  if (typeof window === 'undefined') return undefined
  return read()[episodeUuid]
}

export function saveListening(
  episode: PodcastEpisode | StoredEpisode,
  podcast: Podcast | StoredPodcast,
  time: number,
  duration: number
) {
  if (typeof window === 'undefined' || !episode?.episode_uuid || !podcast?.podcast_uuid) return
  const d = Number.isFinite(duration) && duration > 0 ? duration : episode.duration_seconds || 0
  if (!d || !Number.isFinite(time)) return
  const done = time >= d - DONE_MARGIN
  const prev = read()
  const entry: ListeningEntry = {
    t: done ? d : Math.max(0, time),
    d,
    done: done || !!prev[episode.episode_uuid]?.done,
    at: Date.now(),
    episode: {
      episode_uuid: episode.episode_uuid,
      title: episode.title,
      audio_file: episode.audio_file,
      thumbnail_image: episode.thumbnail_image,
      duration_seconds: episode.duration_seconds,
      episode_number: episode.episode_number,
    },
    podcast: {
      podcast_uuid: podcast.podcast_uuid,
      name: podcast.name,
      thumbnail_image: podcast.thumbnail_image,
    },
  }
  const next: Store = { ...prev, [episode.episode_uuid]: entry }
  const keys = Object.keys(next)
  if (keys.length > MAX_ENTRIES) {
    keys
      .sort((a, b) => next[a].at - next[b].at)
      .slice(0, keys.length - MAX_ENTRIES)
      .forEach((k) => delete next[k])
  }
  write(next)
}

/** Seconds to resume an episode from, or 0 to start over. */
export function resumePoint(episodeUuid: string): number {
  const entry = getListening(episodeUuid)
  if (!entry || entry.t < 5 || entry.t >= entry.d - DONE_MARGIN) return 0
  return entry.t
}

/** Fraction listened, 0..1, for a progress bar. */
export function listenedFraction(entry: ListeningEntry | undefined): number {
  if (!entry || !entry.d) return 0
  return Math.min(1, Math.max(0, entry.t / entry.d))
}

/** Every saved entry, re-rendering when progress is saved anywhere. */
export function useListening(): Store {
  return useSyncExternalStore(subscribe, read, () => EMPTY)
}
