'use client'

import React, { createContext, useContext, useReducer, useCallback, useRef, useEffect, useMemo } from 'react'
import { Podcast, PodcastEpisode } from '@services/podcasts/podcasts'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { createMilestoneTracker } from '@services/analytics/rules'
import { safePlay } from '@/lib/media/safePlay'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { useOrg } from '@components/Contexts/OrgContext'
import { getPodcastAudioStreamUrl, getEpisodeThumbnailMediaDirectory, getPodcastThumbnailMediaDirectory } from '@services/media/media'
import { resumePoint, saveListening } from '@components/Objects/Podcasts/listeningProgress'

interface PodcastPlayerState {
  currentEpisode: PodcastEpisode | null
  podcast: Podcast | null
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  isMinimized: boolean
  isVisible: boolean
  playbackRate: number
}

type PodcastPlayerAction =
  | { type: 'SET_EPISODE'; payload: { episode: PodcastEpisode; podcast: Podcast } }
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'TOGGLE_PLAY' }
  | { type: 'SET_TIME'; payload: number }
  | { type: 'SET_DURATION'; payload: number }
  | { type: 'SET_VOLUME'; payload: number }
  | { type: 'SET_RATE'; payload: number }
  | { type: 'TOGGLE_MINIMIZE' }
  | { type: 'CLOSE_PLAYER' }
  | { type: 'NEXT_EPISODE'; payload: PodcastEpisode }
  | { type: 'PREVIOUS_EPISODE'; payload: PodcastEpisode }

export const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const
const RATE_KEY = 'lh:podcast-rate'

const initialState: PodcastPlayerState = {
  currentEpisode: null,
  podcast: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 1,
  isMinimized: true,  // Default to minimized
  isVisible: false,
  playbackRate: 1,
}

function podcastPlayerReducer(
  state: PodcastPlayerState,
  action: PodcastPlayerAction
): PodcastPlayerState {
  switch (action.type) {
    case 'SET_EPISODE':
      return {
        ...state,
        currentEpisode: action.payload.episode,
        podcast: action.payload.podcast,
        isPlaying: true,
        currentTime: 0,
        duration: action.payload.episode.duration_seconds || 0,
        isVisible: true,
        isMinimized: true,  // Start minimized by default
      }
    case 'PLAY':
      return state.isPlaying ? state : { ...state, isPlaying: true }
    case 'PAUSE':
      return state.isPlaying ? { ...state, isPlaying: false } : state
    case 'TOGGLE_PLAY':
      return { ...state, isPlaying: !state.isPlaying }
    case 'SET_TIME':
      return { ...state, currentTime: action.payload }
    case 'SET_DURATION':
      return { ...state, duration: action.payload }
    case 'SET_VOLUME':
      return { ...state, volume: action.payload }
    case 'SET_RATE':
      return { ...state, playbackRate: action.payload }
    case 'TOGGLE_MINIMIZE':
      return { ...state, isMinimized: !state.isMinimized }
    case 'CLOSE_PLAYER':
      // The speed is a listener preference, not part of the session.
      return { ...initialState, playbackRate: state.playbackRate, volume: state.volume }
    case 'NEXT_EPISODE':
      return {
        ...state,
        currentEpisode: action.payload,
        currentTime: 0,
        isPlaying: true,
      }
    case 'PREVIOUS_EPISODE':
      return {
        ...state,
        currentEpisode: action.payload,
        currentTime: 0,
        isPlaying: true,
      }
    default:
      return state
  }
}

interface PodcastPlayerContextValue {
  state: PodcastPlayerState
  playEpisode: (_episode: PodcastEpisode, _podcast: Podcast) => void
  play: () => void
  pause: () => void
  togglePlay: () => void
  setTime: (_time: number) => void
  setDuration: (_duration: number) => void
  setVolume: (_volume: number) => void
  setPlaybackRate: (_rate: number) => void
  /** Jump by a number of seconds (negative goes back). */
  skip: (_seconds: number) => void
  toggleMinimize: () => void
  closePlayer: () => void
  seekTo: (_time: number) => void
  audioRef: React.RefObject<HTMLAudioElement | null>
}

const PodcastPlayerContext = createContext<PodcastPlayerContextValue | null>(null)

export function PodcastPlayerProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(podcastPlayerReducer, initialState)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const org = useOrg() as any
  const { t } = useTranslation()
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  }, [t])
  const { track } = useLHAnalytics('learner')
  const trackRef = useRef(track)
  useEffect(() => {
    trackRef.current = track
  }, [track])

  // Latest values for the audio element's event handlers, which are bound once.
  const live = useRef(state)
  useEffect(() => {
    live.current = state
  }, [state])

  const { currentEpisode, podcast } = state
  // The <audio> lives here rather than in the player UI, so playback never
  // depends on that (lazily loaded) component having mounted yet.
  const src =
    currentEpisode?.audio_file && podcast && org?.org_uuid
      ? getPodcastAudioStreamUrl(org.org_uuid, podcast.podcast_uuid, currentEpisode.episode_uuid, currentEpisode.audio_file)
      : undefined

  // Speed is remembered across visits.
  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(RATE_KEY))
      if ((PLAYBACK_RATES as readonly number[]).includes(saved)) dispatch({ type: 'SET_RATE', payload: saved })
    } catch {
      /* storage blocked */
    }
  }, [])

  const playEpisode = useCallback((episode: PodcastEpisode, podcast: Podcast) => {
    dispatch({ type: 'SET_EPISODE', payload: { episode, podcast } })
  }, [])

  // Start the element; if the browser refuses (autoplay policy, superseded
  // source) the button must not stay on "pause".
  const startAudio = useCallback(() => {
    const audio = audioRef.current
    void Promise.resolve(safePlay(audio)).then(() => {
      if (audio?.paused) dispatch({ type: 'PAUSE' })
    })
  }, [])

  const play = useCallback(() => {
    dispatch({ type: 'PLAY' })
    startAudio()
  }, [startAudio])

  const pause = useCallback(() => {
    dispatch({ type: 'PAUSE' })
    audioRef.current?.pause()
  }, [])

  const togglePlay = useCallback(() => {
    if (state.isPlaying) {
      audioRef.current?.pause()
    } else {
      startAudio()
    }
    dispatch({ type: 'TOGGLE_PLAY' })
  }, [state.isPlaying, startAudio])

  const setTime = useCallback((time: number) => {
    dispatch({ type: 'SET_TIME', payload: time })
  }, [])

  const setDuration = useCallback((duration: number) => {
    dispatch({ type: 'SET_DURATION', payload: duration })
  }, [])

  const setVolume = useCallback((volume: number) => {
    dispatch({ type: 'SET_VOLUME', payload: volume })
    if (audioRef.current) {
      audioRef.current.volume = volume
    }
  }, [])

  const setPlaybackRate = useCallback((rate: number) => {
    dispatch({ type: 'SET_RATE', payload: rate })
    try {
      window.localStorage.setItem(RATE_KEY, String(rate))
    } catch {
      /* storage blocked */
    }
  }, [])

  const toggleMinimize = useCallback(() => {
    dispatch({ type: 'TOGGLE_MINIMIZE' })
  }, [])

  const closePlayer = useCallback(() => {
    const audio = audioRef.current
    const { currentEpisode: ep, podcast: pod } = live.current
    if (audio && ep && pod) saveListening(ep, pod, audio.currentTime, audio.duration)
    audio?.pause()
    dispatch({ type: 'CLOSE_PLAYER' })
  }, [])

  // Org analytics: count an episode once, the first time it starts playing
  // while this player is mounted (resuming or replaying it doesn't recount).
  const playedEpisodes = useRef<Set<string>>(new Set())
  const playingEpisodeUuid = state.isPlaying ? state.currentEpisode?.episode_uuid : undefined
  const playingPodcastUuid = state.podcast?.podcast_uuid
  useEffect(() => {
    if (!playingEpisodeUuid || playedEpisodes.current.has(playingEpisodeUuid)) return
    playedEpisodes.current.add(playingEpisodeUuid)
    trackRef.current(AnalyticsEvent.PodcastEpisodePlayed, {
      podcast_uuid: playingPodcastUuid,
      episode_uuid: playingEpisodeUuid,
    })
  }, [playingEpisodeUuid, playingPodcastUuid])

  // Listening depth: 25/50/75/100% of each episode, each reported once per
  // episode while this player is mounted.
  const progressMilestones = useRef(createMilestoneTracker())
  const currentEpisodeUuid = state.currentEpisode?.episode_uuid
  useEffect(() => {
    if (!currentEpisodeUuid) return
    const reached = progressMilestones.current.reached(currentEpisodeUuid, state.currentTime, state.duration)
    for (const percent of reached) {
      trackRef.current(AnalyticsEvent.PodcastEpisodeProgress, {
        podcast_uuid: playingPodcastUuid,
        episode_uuid: currentEpisodeUuid,
        percent,
      })
    }
  }, [currentEpisodeUuid, playingPodcastUuid, state.currentTime, state.duration])

  const seekTo = useCallback((time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time
      dispatch({ type: 'SET_TIME', payload: time })
    }
  }, [])

  const skip = useCallback((seconds: number) => {
    const audio = audioRef.current
    if (!audio) return
    const end = Number.isFinite(audio.duration) ? audio.duration : live.current.duration
    const next = Math.min(Math.max(audio.currentTime + seconds, 0), end || Infinity)
    audio.currentTime = next
    dispatch({ type: 'SET_TIME', payload: next })
  }, [])

  // Keep the element's speed in step (a new source resets it to the default).
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.defaultPlaybackRate = state.playbackRate
    audio.playbackRate = state.playbackRate
  }, [state.playbackRate, src])

  // A new episode: start it (playEpisode always means "play this").
  useEffect(() => {
    if (src && live.current.isPlaying) startAudio()
  }, [src, startAudio])

  // Sync audio element with state
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    let lastSaved = 0
    const persist = (force = false) => {
      const { currentEpisode: ep, podcast: pod } = live.current
      if (!ep || !pod || !audio.currentTime) return
      const now = Date.now()
      if (!force && now - lastSaved < 5000) return
      lastSaved = now
      saveListening(ep, pod, audio.currentTime, audio.duration)
    }

    const handleTimeUpdate = () => {
      dispatch({ type: 'SET_TIME', payload: audio.currentTime })
      persist()
    }

    const handleLoadedMetadata = () => {
      if (Number.isFinite(audio.duration)) dispatch({ type: 'SET_DURATION', payload: audio.duration })
      // Pick up where the listener left off in this browser.
      const ep = live.current.currentEpisode
      const from = ep ? resumePoint(ep.episode_uuid) : 0
      if (from > 0) {
        audio.currentTime = from
        dispatch({ type: 'SET_TIME', payload: from })
      }
    }

    const handleEnded = () => {
      trackRef.current(AnalyticsEvent.EpisodeCompleted, { duration: audio.duration })
      const { currentEpisode: ep, podcast: pod } = live.current
      if (ep && pod) saveListening(ep, pod, audio.duration, audio.duration)
      dispatch({ type: 'PAUSE' })
    }

    // The OS media keys, headphones and the browser can also start or stop it.
    const handlePlay = () => dispatch({ type: 'PLAY' })
    const handlePause = () => {
      if (!audio.ended) dispatch({ type: 'PAUSE' })
      persist(true)
    }

    // A missing or unsupported file: say so instead of a play button that does nothing.
    const handleError = () => {
      if (!audio.getAttribute('src')) return
      dispatch({ type: 'PAUSE' })
      toast.error(tRef.current('podcasts.listen.play_error'), { id: 'podcast-play-error' })
    }

    audio.addEventListener('timeupdate', handleTimeUpdate)
    audio.addEventListener('error', handleError)
    audio.addEventListener('loadedmetadata', handleLoadedMetadata)
    audio.addEventListener('ended', handleEnded)
    audio.addEventListener('play', handlePlay)
    audio.addEventListener('pause', handlePause)

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate)
      audio.removeEventListener('error', handleError)
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
      audio.removeEventListener('ended', handleEnded)
      audio.removeEventListener('play', handlePlay)
      audio.removeEventListener('pause', handlePause)
    }
  }, [])

  // Lock screen / notification controls where the browser supports them.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return
    const session = navigator.mediaSession
    if (!currentEpisode || !podcast) {
      session.metadata = null
      return
    }
    const art = currentEpisode.thumbnail_image && org?.org_uuid
      ? getEpisodeThumbnailMediaDirectory(org.org_uuid, podcast.podcast_uuid, currentEpisode.episode_uuid, currentEpisode.thumbnail_image)
      : podcast.thumbnail_image && org?.org_uuid
        ? getPodcastThumbnailMediaDirectory(org.org_uuid, podcast.podcast_uuid, podcast.thumbnail_image)
        : null
    try {
      session.metadata = new MediaMetadata({
        title: currentEpisode.title,
        artist: podcast.name,
        album: org?.name,
        artwork: art ? [{ src: art, sizes: '512x512' }] : [],
      })
      session.setActionHandler('play', () => play())
      session.setActionHandler('pause', () => pause())
      session.setActionHandler('seekbackward', () => skip(-15))
      session.setActionHandler('seekforward', () => skip(15))
    } catch {
      /* an action the browser doesn't know */
    }
  }, [currentEpisode, podcast, org?.org_uuid, org?.name, play, pause, skip])

  const value: PodcastPlayerContextValue = useMemo(() => ({
    state,
    playEpisode,
    play,
    pause,
    togglePlay,
    setTime,
    setDuration,
    setVolume,
    setPlaybackRate,
    skip,
    toggleMinimize,
    closePlayer,
    seekTo,
    audioRef,
  }), [state, playEpisode, play, pause, togglePlay, setTime, setDuration, setVolume, setPlaybackRate, skip, toggleMinimize, closePlayer, seekTo, audioRef])

  return (
    <PodcastPlayerContext.Provider value={value}>
      {children}
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />
    </PodcastPlayerContext.Provider>
  )
}

export function usePodcastPlayer() {
  const context = useContext(PodcastPlayerContext)
  if (!context) {
    throw new Error('usePodcastPlayer must be used within a PodcastPlayerProvider')
  }
  return context
}
