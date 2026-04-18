'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Headphones, ArrowLeft, Play, Pause } from '@phosphor-icons/react'
import BoardBlockWrapper from './BoardBlockWrapper'
import DragHandle from './DragHandle'
import ResizeHandle from './ResizeHandle'
import { useDragResize } from './useDragResize'
import { useBoardSelection } from '../BoardSelectionContext'
import { getOrgPodcasts, getPodcastMeta } from '@services/podcasts/podcasts'
import type { Podcast, PodcastEpisode, PodcastMeta } from '@services/podcasts/podcasts'
import { formatDuration } from '@services/podcasts/episodes'
import { getPodcastThumbnailMediaDirectory, getPodcastAudioStreamUrl } from '@services/media/media'

export default function PodcastBlockComponent({ node, updateAttributes, selected, deleteNode, editor, getPos }: any) {
  const { podcastUuid, episodeUuid, x, y, width, height } = node.attrs
  const boardCtx = editor?.storage?.boardContext
  const orgslug: string = boardCtx?.orgslug || ''
  const accessToken: string = boardCtx?.accessToken || ''
  const orgUUID: string = boardCtx?.orgUuid || ''

  const { isSelected: isMultiSelected } = useBoardSelection()
  const multiSelected = getPos ? isMultiSelected(getPos()) : false
  const isBlockSelected = selected || multiSelected

  // Picker state
  const [podcasts, setPodcasts] = useState<Podcast[]>([])
  const [podcastMeta, setPodcastMeta] = useState<PodcastMeta | null>(null)
  const [loading, setLoading] = useState(false)

  // Player state
  const [episode, setEpisode] = useState<PodcastEpisode | null>(null)
  const [podcastName, setPodcastName] = useState('')
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const audioRef = useRef<HTMLAudioElement>(null)

  const { handleDragStart, handleResizeStart } = useDragResize({
    x, y, width, height,
    minWidth: 300, minHeight: 200,
    updateAttributes,
    editor,
    getPos,
  })

  // Fetch podcasts list
  useEffect(() => {
    if (podcastUuid || !orgslug) return
    setLoading(true)
    getOrgPodcasts(orgslug, null, accessToken, true)
      .then((res: any) => {
        const list = Array.isArray(res) ? res : res?.data || []
        setPodcasts(list)
      })
      .catch(() => setPodcasts([]))
      .finally(() => setLoading(false))
  }, [podcastUuid, orgslug, accessToken])

  // Fetch podcast meta (episodes)
  useEffect(() => {
    if (!podcastUuid || episodeUuid) return
    setLoading(true)
    getPodcastMeta(podcastUuid, null, accessToken)
      .then((meta: PodcastMeta) => setPodcastMeta(meta))
      .catch(() => setPodcastMeta(null))
      .finally(() => setLoading(false))
  }, [podcastUuid, episodeUuid, accessToken])

  // Fetch episode details when both are set
  useEffect(() => {
    if (!podcastUuid || !episodeUuid) return
    setLoading(true)
    getPodcastMeta(podcastUuid, null, accessToken)
      .then((meta: PodcastMeta) => {
        setPodcastName(meta.podcast.name)
        const ep = meta.episodes.find((e) => e.episode_uuid === episodeUuid)
        if (ep) setEpisode(ep)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [podcastUuid, episodeUuid, accessToken])

  // Audio time tracking
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onTimeUpdate = () => setCurrentTime(audio.currentTime)
    const onDurationChange = () => setDuration(audio.duration || 0)
    const onEnded = () => setIsPlaying(false)
    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('durationchange', onDurationChange)
    audio.addEventListener('ended', onEnded)
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('durationchange', onDurationChange)
      audio.removeEventListener('ended', onEnded)
    }
  }, [episode])

  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (isPlaying) {
      audio.pause()
      setIsPlaying(false)
    } else {
      audio.play()
      setIsPlaying(true)
    }
  }, [isPlaying])

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current
    if (!audio || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    audio.currentTime = ratio * duration
  }, [duration])

  const formatTime = (s: number) => {
    if (!isFinite(s)) return '0:00'
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  const selectPodcast = (uuid: string) => {
    updateAttributes({ podcastUuid: uuid })
  }

  const selectEpisode = (uuid: string) => {
    updateAttributes({ episodeUuid: uuid })
  }

  const goBackToPodcasts = () => {
    updateAttributes({ podcastUuid: '', episodeUuid: '' })
    setPodcastMeta(null)
  }

  // --- State 1: Podcast picker ---
  if (!podcastUuid) {
    return (
      <BoardBlockWrapper
        selected={selected} deleteNode={deleteNode} editor={editor} getPos={getPos}
        x={x} y={y} width={width}
        styled={false}
        className="rounded-2xl nice-shadow"
        style={{ minHeight: 160, backgroundColor: '#18181b' }}
      >
        <DragHandle onMouseDown={handleDragStart} dark />
        <div className="flex items-center px-4 pt-4 pb-0.5">
          <div className="flex items-center gap-1">
            <Headphones size={11} className="text-neutral-500" />
            <span className="text-[9px] font-semibold tracking-wider uppercase select-none text-neutral-500">
              Podcast
            </span>
          </div>
        </div>
        <div className="px-4 pt-2 pb-4 flex flex-col gap-1.5 overflow-y-auto" style={{ maxHeight: height - 60 }}>
          {loading && <p className="text-xs text-neutral-500">Loading...</p>}
          {!loading && podcasts.length === 0 && (
            <p className="text-xs text-neutral-500">No podcasts found</p>
          )}
          {podcasts.map((p) => (
            <button
              key={p.podcast_uuid}
              onClick={() => selectPodcast(p.podcast_uuid)}
              className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 transition-colors text-start"
            >
              {p.thumbnail_image && orgUUID ? (
                <img
                  src={getPodcastThumbnailMediaDirectory(orgUUID, p.podcast_uuid, p.thumbnail_image)}
                  alt={p.name}
                  className="w-8 h-8 rounded object-cover shrink-0"
                />
              ) : (
                <div className="w-8 h-8 rounded bg-neutral-700 flex items-center justify-center shrink-0">
                  <Headphones size={14} className="text-neutral-400" />
                </div>
              )}
              <span className="text-xs font-medium text-neutral-200 truncate">{p.name}</span>
            </button>
          ))}
        </div>
      </BoardBlockWrapper>
    )
  }

  // --- State 2: Episode picker ---
  if (!episodeUuid) {
    const episodes = podcastMeta?.episodes || []
    return (
      <BoardBlockWrapper
        selected={selected} deleteNode={deleteNode} editor={editor} getPos={getPos}
        x={x} y={y} width={width}
        styled={false}
        className="rounded-2xl nice-shadow"
        style={{ minHeight: 160, backgroundColor: '#18181b' }}
      >
        <DragHandle onMouseDown={handleDragStart} dark />
        <div className="flex items-center px-4 pt-4 pb-0.5 gap-2">
          <button
            onClick={goBackToPodcasts}
            className="text-neutral-500 hover:text-neutral-300 transition-colors"
          >
            <ArrowLeft size={12} />
          </button>
          <div className="flex items-center gap-1">
            <Headphones size={11} className="text-neutral-500" />
            <span className="text-[9px] font-semibold tracking-wider uppercase select-none text-neutral-500">
              {podcastMeta?.podcast?.name || 'Episodes'}
            </span>
          </div>
        </div>
        <div className="px-4 pt-2 pb-4 flex flex-col gap-1.5 overflow-y-auto" style={{ maxHeight: height - 60 }}>
          {loading && <p className="text-xs text-neutral-500">Loading...</p>}
          {!loading && episodes.length === 0 && (
            <p className="text-xs text-neutral-500">No episodes found</p>
          )}
          {episodes.map((ep) => (
            <button
              key={ep.episode_uuid}
              onClick={() => selectEpisode(ep.episode_uuid)}
              className="flex items-center justify-between w-full px-2.5 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 transition-colors text-start"
            >
              <span className="text-xs font-medium text-neutral-200 truncate me-2">{ep.title}</span>
              <span className="text-[10px] text-neutral-500 shrink-0">
                {formatDuration(ep.duration_seconds)}
              </span>
            </button>
          ))}
        </div>
      </BoardBlockWrapper>
    )
  }

  // --- State 3: Audio player ---
  const streamUrl = episode?.audio_file && orgUUID
    ? getPodcastAudioStreamUrl(orgUUID, podcastUuid, episodeUuid, episode.audio_file)
    : ''

  return (
    <BoardBlockWrapper
      selected={selected} deleteNode={deleteNode} editor={editor} getPos={getPos}
      x={x} y={y} width={width} height={height}
      styled={false}
      className="rounded-2xl nice-shadow"
      style={{ backgroundColor: '#18181b' }}
    >
      <DragHandle onMouseDown={handleDragStart} dark />

      <div className="flex flex-col h-full px-4 pt-4 pb-3">
        {/* Header */}
        <div className="flex items-center gap-1 mb-1">
          <Headphones size={11} className="text-neutral-500" />
          <span className="text-[9px] font-semibold tracking-wider uppercase select-none text-neutral-500">
            Podcast
          </span>
        </div>

        {/* Episode info */}
        <div className="mb-3">
          <p className="text-sm font-medium text-neutral-100 truncate">
            {episode?.title || 'Loading...'}
          </p>
          <p className="text-[10px] text-neutral-500 truncate">{podcastName}</p>
        </div>

        {/* Player controls */}
        <div className="mt-auto flex flex-col gap-2">
          {/* Progress bar */}
          <div
            className="w-full h-1.5 bg-neutral-700 rounded-full cursor-pointer group"
            onClick={handleSeek}
            style={{ pointerEvents: isBlockSelected ? 'auto' : 'none' }}
          >
            <div
              className="h-full bg-neutral-300 rounded-full transition-all group-hover:bg-white"
              style={{ width: duration ? `${(currentTime / duration) * 100}%` : '0%' }}
            />
          </div>

          {/* Controls row */}
          <div className="flex items-center gap-3">
            <button
              onClick={togglePlay}
              className="w-8 h-8 rounded-full bg-neutral-200 hover:bg-white flex items-center justify-center transition-colors"
              style={{ pointerEvents: isBlockSelected ? 'auto' : 'none' }}
            >
              {isPlaying ? (
                <Pause size={14} weight="fill" className="text-neutral-900" />
              ) : (
                <Play size={14} weight="fill" className="text-neutral-900 ms-0.5" />
              )}
            </button>
            <span className="text-[10px] text-neutral-400 font-mono tabular-nums">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>
        </div>
      </div>

      {streamUrl && (
        <audio ref={audioRef} src={streamUrl} preload="metadata" />
      )}

      <ResizeHandle onMouseDown={handleResizeStart} selected={selected} dark />
    </BoardBlockWrapper>
  )
}
