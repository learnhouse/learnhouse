'use client'

import React, { useRef, useState, useCallback, useEffect } from 'react'
import { useMediaQuery } from 'usehooks-ts'
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Settings,
  Loader2,
} from 'lucide-react'

interface VideoDetails {
  startTime?: number
  endTime?: number | null
  autoplay?: boolean
  muted?: boolean
}

interface LearnHousePlayerProps {
  src: string
  details?: VideoDetails
  onReady?: () => void
  poster?: string
}

function formatTime(seconds: number): string {
  if (isNaN(seconds) || !isFinite(seconds)) return '0:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }
  return `${m}:${s.toString().padStart(2, '0')}`
}

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]

const LearnHousePlayer: React.FC<LearnHousePlayerProps> = ({
  src,
  details,
  onReady,
  poster,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const hideControlsTimeout = useRef<NodeJS.Timeout | null>(null)

  const [isReady, setIsReady] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isMuted, setIsMuted] = useState(details?.muted ?? false)
  const [volume, setVolume] = useState(0.8)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [showControls, setShowControls] = useState(true)
  const [isBuffering, setIsBuffering] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [showSettings, setShowSettings] = useState(false)
  const [showVolumeSlider, setShowVolumeSlider] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const isMobile = useMediaQuery('(max-width: 768px)')

  // Hide controls after inactivity
  const resetHideControlsTimer = useCallback(() => {
    if (hideControlsTimeout.current) {
      clearTimeout(hideControlsTimeout.current)
    }
    setShowControls(true)
    if (isPlaying) {
      hideControlsTimeout.current = setTimeout(() => {
        setShowControls(false)
        setShowSettings(false)
        setShowVolumeSlider(false)
      }, 3000)
    }
  }, [isPlaying])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (hideControlsTimeout.current) {
        clearTimeout(hideControlsTimeout.current)
      }
    }
  }, [])

  // Reset player state and reload video when src changes
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    // Reset all player state
    setIsReady(false)
    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setBuffered(0)
    setIsBuffering(true)
    setPlaybackRate(1)
    setShowSettings(false)

    // Force the video element to reload with the new source
    video.load()
  }, [src])

  // Handle fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [])

  // Sync volume state with video element
  useEffect(() => {
    if (videoRef.current && isReady) {
      videoRef.current.volume = volume
    }
  }, [volume, isReady])

  // Sync muted state with video element
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted
    }
  }, [isMuted])

  const handlePlayPause = useCallback(() => {
    const video = videoRef.current
    if (!video) return

    if (video.paused) {
      video.play().catch((err) => console.error('Play error:', err))
    } else {
      video.pause()
    }
  }, [])

  const handleLoadedMetadata = () => {
    const video = videoRef.current
    if (!video) return

    setDuration(video.duration)
    setIsReady(true)
    setIsBuffering(false)

    // Seek to start time if specified
    if (details?.startTime) {
      video.currentTime = details.startTime
    }

    // Start playing if autoplay is enabled
    if (details?.autoplay) {
      video.play().catch((err) => console.error('Autoplay error:', err))
    }

    onReady?.()
  }

  const handleTimeUpdate = () => {
    const video = videoRef.current
    if (!video) return

    setCurrentTime(video.currentTime)

    // Update buffered
    if (video.buffered.length > 0) {
      const bufferedEnd = video.buffered.end(video.buffered.length - 1)
      setBuffered(bufferedEnd / video.duration)
    }

    // Handle end time
    if (details?.endTime && video.currentTime >= details.endTime) {
      video.pause()
    }
  }

  const handleProgressBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current
    if (!video || !duration) return

    const rect = e.currentTarget.getBoundingClientRect()
    const pos = (e.clientX - rect.left) / rect.width
    video.currentTime = pos * duration
  }

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value)
    setVolume(newVolume)
    if (newVolume > 0) {
      setIsMuted(false)
    }
  }

  const toggleMute = () => {
    setIsMuted(!isMuted)
  }

  const toggleFullscreen = async () => {
    if (!containerRef.current) return
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else {
        await containerRef.current.requestFullscreen()
      }
    } catch (err) {
      console.error('Fullscreen error:', err)
    }
  }

  const handlePlaybackRateChange = (rate: number) => {
    const video = videoRef.current
    if (!video) return

    setPlaybackRate(rate)
    video.playbackRate = rate
    setShowSettings(false)
  }

  const played = duration > 0 ? currentTime / duration : 0

  return (
    <div
      ref={containerRef}
      className={`learnhouse-player relative w-full aspect-video overflow-hidden bg-black ${
        isMobile ? 'rounded-none' : 'rounded-xl shadow-md shadow-gray-300/25 outline outline-1 outline-neutral-200/40'
      }`}
      onMouseMove={!isMobile ? resetHideControlsTimer : undefined}
      onMouseLeave={!isMobile ? () => isPlaying && setShowControls(false) : undefined}
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        className="absolute inset-0 w-full h-full object-contain"
        preload="metadata"
        playsInline
        muted={isMuted}
        controls={isMobile}
        controlsList="nodownload"
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onWaiting={() => setIsBuffering(true)}
        onCanPlay={() => setIsBuffering(false)}
        onVolumeChange={() => {
          const video = videoRef.current
          if (video) {
            setVolume(video.volume)
            setIsMuted(video.muted)
          }
        }}
        onError={(e) => console.error('Video error:', e)}
      />

      {/* Custom controls - desktop only */}
      {!isMobile && (
        <>
      {/* Click overlay for play/pause */}
      <div
        className="absolute inset-0 z-10 cursor-pointer"
        onClick={handlePlayPause}
      />

      {/* Center play button (when paused and ready) */}
      {!isPlaying && isReady && !isBuffering && (
        <button
          onClick={handlePlayPause}
          className="absolute inset-0 z-20 flex items-center justify-center transition-opacity"
        >
          <Play className="w-16 h-16 text-white/90 drop-shadow-lg" fill="white" fillOpacity={0.9} />
        </button>
      )}

      {/* Buffering/Loading indicator */}
      {isBuffering && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/30 pointer-events-none">
          <Loader2 className="w-12 h-12 text-white animate-spin" />
        </div>
      )}

      {/* Controls overlay */}
      <div
        className={`absolute inset-0 z-30 flex flex-col justify-end transition-opacity duration-300 pointer-events-none ${
          showControls || !isPlaying ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {/* Gradient background */}
        <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/70 via-black/30 to-transparent" />

        {/* Controls container */}
        <div className="relative z-10 px-4 pb-3 space-y-2 pointer-events-auto">
          {/* Progress bar */}
          <div
            className="relative h-1 bg-white/30 rounded-full cursor-pointer group/progress hover:h-1.5 transition-all"
            onClick={handleProgressBarClick}
          >
            {/* Buffered */}
            <div
              className="absolute inset-y-0 start-0 bg-white/50 rounded-full"
              style={{ width: `${buffered * 100}%` }}
            />
            {/* Progress */}
            <div
              className="absolute inset-y-0 start-0 bg-white rounded-full"
              style={{ width: `${played * 100}%` }}
            />
            {/* Thumb */}
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow opacity-0 group-hover/progress:opacity-100 transition-opacity"
              style={{ left: `calc(${played * 100}% - 6px)` }}
            />
          </div>

          {/* Control buttons */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-0.5">
              {/* Play/Pause */}
              <button
                onClick={handlePlayPause}
                className="p-2 rounded-lg hover:bg-white/15 transition-colors"
              >
                {isPlaying ? (
                  <Pause className="w-5 h-5 text-white" />
                ) : (
                  <Play className="w-5 h-5 text-white" fill="white" />
                )}
              </button>

              {/* Volume */}
              <div
                className="relative flex items-center"
                onMouseEnter={() => setShowVolumeSlider(true)}
                onMouseLeave={() => setShowVolumeSlider(false)}
              >
                <button
                  onClick={toggleMute}
                  className="p-2 rounded-lg hover:bg-white/15 transition-colors"
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-5 h-5 text-white" />
                  ) : (
                    <Volume2 className="w-5 h-5 text-white" />
                  )}
                </button>
                <div
                  className={`flex items-center transition-all duration-200 overflow-hidden ${
                    showVolumeSlider ? 'w-20 ms-1' : 'w-0'
                  }`}
                >
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={isMuted ? 0 : volume}
                    onChange={handleVolumeChange}
                    className="w-full h-1 bg-white/30 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                  />
                </div>
              </div>

              {/* Time */}
              <div className="text-white/90 text-xs font-medium tabular-nums ms-2">
                {formatTime(currentTime)} / {formatTime(duration)}
              </div>
            </div>

            <div className="flex items-center gap-0.5">
              {/* Settings */}
              <div className="relative">
                <button
                  onClick={() => setShowSettings(!showSettings)}
                  className="p-2 rounded-lg hover:bg-white/15 transition-colors"
                >
                  <Settings className="w-5 h-5 text-white" />
                </button>
                {showSettings && (
                  <div className="absolute bottom-full end-0 mb-2 bg-neutral-900/95 backdrop-blur-lg border border-white/10 rounded-lg overflow-hidden min-w-[140px] shadow-xl">
                    <div className="px-3 py-2 text-xs text-white/60 font-medium border-b border-white/10">
                      Speed
                    </div>
                    {PLAYBACK_RATES.map((rate) => (
                      <button
                        key={rate}
                        onClick={() => handlePlaybackRateChange(rate)}
                        className={`w-full px-3 py-2 text-start text-sm hover:bg-white/10 transition-colors ${
                          playbackRate === rate ? 'text-white font-medium' : 'text-white/80'
                        }`}
                      >
                        {rate === 1 ? 'Normal' : `${rate}x`}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Fullscreen */}
              <button
                onClick={toggleFullscreen}
                className="p-2 rounded-lg hover:bg-white/15 transition-colors"
              >
                {isFullscreen ? (
                  <Minimize className="w-5 h-5 text-white" />
                ) : (
                  <Maximize className="w-5 h-5 text-white" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
        </>
      )}
    </div>
  )
}

export default LearnHousePlayer
