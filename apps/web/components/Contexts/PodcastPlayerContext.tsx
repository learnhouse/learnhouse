'use client'

import React, { createContext, useContext, useReducer, useCallback, useRef, useEffect, useMemo } from 'react'
import { Podcast, PodcastEpisode } from '@services/podcasts/podcasts'

interface PodcastPlayerState {
  currentEpisode: PodcastEpisode | null
  podcast: Podcast | null
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  isMinimized: boolean
  isVisible: boolean
}

type PodcastPlayerAction =
  | { type: 'SET_EPISODE'; payload: { episode: PodcastEpisode; podcast: Podcast } }
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'TOGGLE_PLAY' }
  | { type: 'SET_TIME'; payload: number }
  | { type: 'SET_DURATION'; payload: number }
  | { type: 'SET_VOLUME'; payload: number }
  | { type: 'TOGGLE_MINIMIZE' }
  | { type: 'CLOSE_PLAYER' }
  | { type: 'NEXT_EPISODE'; payload: PodcastEpisode }
  | { type: 'PREVIOUS_EPISODE'; payload: PodcastEpisode }

const initialState: PodcastPlayerState = {
  currentEpisode: null,
  podcast: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 1,
  isMinimized: true,  // Default to minimized
  isVisible: false,
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
        isVisible: true,
        isMinimized: true,  // Start minimized by default
      }
    case 'PLAY':
      return { ...state, isPlaying: true }
    case 'PAUSE':
      return { ...state, isPlaying: false }
    case 'TOGGLE_PLAY':
      return { ...state, isPlaying: !state.isPlaying }
    case 'SET_TIME':
      return { ...state, currentTime: action.payload }
    case 'SET_DURATION':
      return { ...state, duration: action.payload }
    case 'SET_VOLUME':
      return { ...state, volume: action.payload }
    case 'TOGGLE_MINIMIZE':
      return { ...state, isMinimized: !state.isMinimized }
    case 'CLOSE_PLAYER':
      return {
        ...initialState,
      }
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
  playEpisode: (episode: PodcastEpisode, podcast: Podcast) => void
  play: () => void
  pause: () => void
  togglePlay: () => void
  setTime: (time: number) => void
  setDuration: (duration: number) => void
  setVolume: (volume: number) => void
  toggleMinimize: () => void
  closePlayer: () => void
  seekTo: (time: number) => void
  audioRef: React.RefObject<HTMLAudioElement | null>
}

const PodcastPlayerContext = createContext<PodcastPlayerContextValue | null>(null)

export function PodcastPlayerProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(podcastPlayerReducer, initialState)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const playEpisode = useCallback((episode: PodcastEpisode, podcast: Podcast) => {
    dispatch({ type: 'SET_EPISODE', payload: { episode, podcast } })
  }, [])

  const play = useCallback(() => {
    dispatch({ type: 'PLAY' })
    audioRef.current?.play()
  }, [])

  const pause = useCallback(() => {
    dispatch({ type: 'PAUSE' })
    audioRef.current?.pause()
  }, [])

  const togglePlay = useCallback(() => {
    if (state.isPlaying) {
      audioRef.current?.pause()
    } else {
      audioRef.current?.play()
    }
    dispatch({ type: 'TOGGLE_PLAY' })
  }, [state.isPlaying])

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

  const toggleMinimize = useCallback(() => {
    dispatch({ type: 'TOGGLE_MINIMIZE' })
  }, [])

  const closePlayer = useCallback(() => {
    audioRef.current?.pause()
    dispatch({ type: 'CLOSE_PLAYER' })
  }, [])

  const seekTo = useCallback((time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time
      dispatch({ type: 'SET_TIME', payload: time })
    }
  }, [])

  // Sync audio element with state
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleTimeUpdate = () => {
      dispatch({ type: 'SET_TIME', payload: audio.currentTime })
    }

    const handleLoadedMetadata = () => {
      dispatch({ type: 'SET_DURATION', payload: audio.duration })
    }

    const handleEnded = () => {
      dispatch({ type: 'PAUSE' })
    }

    audio.addEventListener('timeupdate', handleTimeUpdate)
    audio.addEventListener('loadedmetadata', handleLoadedMetadata)
    audio.addEventListener('ended', handleEnded)

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate)
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
      audio.removeEventListener('ended', handleEnded)
    }
  }, [])

  const value: PodcastPlayerContextValue = useMemo(() => ({
    state,
    playEpisode,
    play,
    pause,
    togglePlay,
    setTime,
    setDuration,
    setVolume,
    toggleMinimize,
    closePlayer,
    seekTo,
    audioRef,
  }), [state, playEpisode, play, pause, togglePlay, setTime, setDuration, setVolume, toggleMinimize, closePlayer, seekTo, audioRef])

  return (
    <PodcastPlayerContext.Provider value={value}>
      {children}
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
