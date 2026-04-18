'use client'

import React, { useEffect, useRef, useState } from 'react'
import { usePodcastPlayer } from '@components/Contexts/PodcastPlayerContext'
import { useOrg } from '@components/Contexts/OrgContext'
import {
  getPodcastThumbnailMediaDirectory,
  getEpisodeThumbnailMediaDirectory,
  getPodcastAudioStreamUrl,
} from '@services/media/media'
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
  Minimize2,
  Maximize2,
} from 'lucide-react'
import { formatDuration } from '@services/podcasts/episodes'
import WaveSurfer from 'wavesurfer.js'

export default function PodcastPlayer() {
  const { state, togglePlay, seekTo, setVolume, closePlayer, toggleMinimize, audioRef } = usePodcastPlayer()
  const org = useOrg() as any
  const waveformRef = useRef<HTMLDivElement>(null)
  const miniWaveformRef = useRef<HTMLDivElement>(null)
  const wavesurferRef = useRef<WaveSurfer | null>(null)
  const miniWavesurferRef = useRef<WaveSurfer | null>(null)
  const [isMuted, setIsMuted] = useState(false)
  const [previousVolume, setPreviousVolume] = useState(1)

  const { currentEpisode, podcast, isPlaying, currentTime, duration, volume, isMinimized, isVisible } = state

  // Get audio URL
  const audioUrl = currentEpisode && podcast && org
    ? getPodcastAudioStreamUrl(
        org.org_uuid,
        podcast.podcast_uuid,
        currentEpisode.episode_uuid,
        currentEpisode.audio_file
      )
    : ''

  // Get thumbnail
  const thumbnailUrl = currentEpisode?.thumbnail_image && podcast && org
    ? getEpisodeThumbnailMediaDirectory(
        org.org_uuid,
        podcast.podcast_uuid,
        currentEpisode.episode_uuid,
        currentEpisode.thumbnail_image
      )
    : podcast?.thumbnail_image && org
    ? getPodcastThumbnailMediaDirectory(org.org_uuid, podcast.podcast_uuid, podcast.thumbnail_image)
    : '/empty_thumbnail.png'

  // Initialize WaveSurfer for expanded view
  useEffect(() => {
    if (!waveformRef.current || !audioUrl || isMinimized) return

    // Destroy existing instance
    if (wavesurferRef.current) {
      wavesurferRef.current.destroy()
    }

    // Create new WaveSurfer instance
    const wavesurfer = WaveSurfer.create({
      container: waveformRef.current,
      waveColor: '#d1d5db',
      progressColor: '#111827',
      cursorColor: '#111827',
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      height: 40,
      normalize: true,
      backend: 'MediaElement',
      media: audioRef.current || undefined,
    })

    wavesurferRef.current = wavesurfer

    // Load audio
    wavesurfer.load(audioUrl)

    // Event listeners
    wavesurfer.on('click', () => {
      const time = wavesurfer.getCurrentTime()
      seekTo(time)
    })

    return () => {
      wavesurfer.destroy()
    }
  }, [audioUrl, isMinimized])

  // Initialize mini WaveSurfer for minimized view
  useEffect(() => {
    if (!miniWaveformRef.current || !audioUrl || !isMinimized) return

    // Destroy existing instance
    if (miniWavesurferRef.current) {
      miniWavesurferRef.current.destroy()
    }

    // Create new mini WaveSurfer instance
    const wavesurfer = WaveSurfer.create({
      container: miniWaveformRef.current,
      waveColor: '#d1d5db',
      progressColor: '#111827',
      cursorColor: 'transparent',
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      height: 24,
      normalize: true,
      backend: 'MediaElement',
      media: audioRef.current || undefined,
    })

    miniWavesurferRef.current = wavesurfer

    // Load audio
    wavesurfer.load(audioUrl)

    // Event listeners
    wavesurfer.on('click', () => {
      const time = wavesurfer.getCurrentTime()
      seekTo(time)
    })

    return () => {
      wavesurfer.destroy()
    }
  }, [audioUrl, isMinimized])

  // Sync play/pause state with WaveSurfer
  useEffect(() => {
    if (wavesurferRef.current) {
      if (isPlaying) {
        wavesurferRef.current.play()
      } else {
        wavesurferRef.current.pause()
      }
    }
    if (miniWavesurferRef.current) {
      if (isPlaying) {
        miniWavesurferRef.current.play()
      } else {
        miniWavesurferRef.current.pause()
      }
    }
  }, [isPlaying])

  // Toggle mute
  const toggleMute = () => {
    if (isMuted) {
      setVolume(previousVolume)
      setIsMuted(false)
    } else {
      setPreviousVolume(volume)
      setVolume(0)
      setIsMuted(true)
    }
  }

  // Skip forward/backward
  const skipForward = () => {
    seekTo(Math.min(currentTime + 15, duration))
  }

  const skipBackward = () => {
    seekTo(Math.max(currentTime - 15, 0))
  }

  // Progress percentage
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  if (!isVisible || !currentEpisode || !podcast) {
    return null
  }

  return (
    <>
      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        src={audioUrl}
        preload="metadata"
      />

      {/* Player UI */}
      <div
        className={`fixed bottom-0 start-0 end-0 bg-white border-t border-gray-200 shadow-lg transition-all duration-300 z-50 ${
          isMinimized ? 'h-16' : 'h-24'
        }`}
      >
        <div className="h-full max-w-7xl mx-auto px-4 flex items-center gap-4">
          {/* Thumbnail */}
          <div className="flex-shrink-0">
            <div
              className={`bg-gray-200 rounded-lg overflow-hidden ${
                isMinimized ? 'w-10 h-10' : 'w-16 h-16'
              }`}
            >
              <img
                src={thumbnailUrl}
                alt={currentEpisode.title}
                className="w-full h-full object-cover"
              />
            </div>
          </div>

          {/* Episode info */}
          <div className={`flex-shrink-0 min-w-0 ${isMinimized ? 'max-w-[120px]' : 'w-48'}`}>
            <h4 className="text-sm font-semibold text-gray-900 truncate">
              {currentEpisode.title}
            </h4>
            {!isMinimized && (
              <p className="text-xs text-gray-500 truncate">{podcast.name}</p>
            )}
          </div>

          {/* Controls */}
          <div className="flex items-center gap-1">
            {!isMinimized && (
              <button
                onClick={skipBackward}
                className="p-2 rounded-full hover:bg-gray-100 transition-colors"
                title="Skip back 15s"
              >
                <SkipBack size={18} className="text-gray-600" />
              </button>
            )}

            <button
              onClick={togglePlay}
              className={`rounded-full bg-gray-900 hover:bg-gray-800 transition-colors ${
                isMinimized ? 'p-2' : 'p-3'
              }`}
            >
              {isPlaying ? (
                <Pause size={isMinimized ? 16 : 20} className="text-white" fill="white" />
              ) : (
                <Play size={isMinimized ? 16 : 20} className="text-white" fill="white" />
              )}
            </button>

            {!isMinimized && (
              <button
                onClick={skipForward}
                className="p-2 rounded-full hover:bg-gray-100 transition-colors"
                title="Skip forward 15s"
              >
                <SkipForward size={18} className="text-gray-600" />
              </button>
            )}
          </div>

          {/* Waveform / Progress */}
          {isMinimized ? (
            <div className="flex-1 flex items-center gap-2 min-w-0">
              <div ref={miniWaveformRef} className="flex-1 cursor-pointer min-w-[100px]" />
              <span className="text-xs text-gray-500 flex-shrink-0 tabular-nums">
                {formatDuration(Math.floor(currentTime))}
              </span>
            </div>
          ) : (
            <div className="flex-1 flex items-center gap-3">
              <span className="text-xs text-gray-500 w-12 text-end tabular-nums">
                {formatDuration(Math.floor(currentTime))}
              </span>
              <div ref={waveformRef} className="flex-1 cursor-pointer" />
              <span className="text-xs text-gray-500 w-12 tabular-nums">
                {formatDuration(Math.floor(duration))}
              </span>
            </div>
          )}

          {/* Volume control (expanded only) */}
          {!isMinimized && (
            <div className="flex items-center gap-2">
              <button
                onClick={toggleMute}
                className="p-2 rounded-full hover:bg-gray-100 transition-colors"
              >
                {isMuted || volume === 0 ? (
                  <VolumeX size={18} className="text-gray-600" />
                ) : (
                  <Volume2 size={18} className="text-gray-600" />
                )}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={volume}
                onChange={(e) => {
                  const newVolume = parseFloat(e.target.value)
                  setVolume(newVolume)
                  setIsMuted(newVolume === 0)
                }}
                className="w-20 h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-gray-900"
              />
            </div>
          )}

          {/* Minimize/Close buttons */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={toggleMinimize}
              className="p-2 rounded-full hover:bg-gray-100 transition-colors"
              title={isMinimized ? 'Expand' : 'Minimize'}
            >
              {isMinimized ? (
                <Maximize2 size={16} className="text-gray-600" />
              ) : (
                <Minimize2 size={18} className="text-gray-600" />
              )}
            </button>
            <button
              onClick={closePlayer}
              className="p-2 rounded-full hover:bg-gray-100 transition-colors"
              title="Close"
            >
              <X size={isMinimized ? 16 : 18} className="text-gray-600" />
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
