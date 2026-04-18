import { NodeViewProps, NodeViewWrapper } from '@tiptap/react'
import { Node } from '@tiptap/core'
import {
  Loader2, Headphones, Upload, X, ArrowLeftRight,
  CheckCircle2, AlertCircle, Play, Pause, Music, Radio, List,
  SkipBack, SkipForward, Volume2, VolumeX, Clock
} from 'lucide-react'
import React from 'react'
import toast from 'react-hot-toast'
import { uploadNewAudioFile } from '../../../../../services/blocks/Audio/audio'
import { getAudioBlockStreamUrl, getPodcastAudioStreamUrl } from '@services/media/media'
import { useOrg } from '@components/Contexts/OrgContext'
import { useOrgMembership } from '@components/Contexts/OrgContext'
import { useCourse } from '@components/Contexts/CourseContext'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { constructAcceptValue } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { getOrgPodcasts, getPodcastMeta, type Podcast, type PodcastEpisode, type PodcastMeta } from '@services/podcasts/podcasts'

const SUPPORTED_FILES = constructAcceptValue(['mp3', 'wav', 'ogg', 'm4a'])

const AUDIO_SIZES = {
  small: { maxWidth: 400, label: 'Small' },
  medium: { maxWidth: 600, label: 'Medium' },
  large: { maxWidth: 800, label: 'Large' },
  full: { maxWidth: '100%', label: 'Full Width' },
} as const

type AudioSize = keyof typeof AUDIO_SIZES
type SourceType = 'upload' | 'episode' | 'podcast'
type TabType = 'upload' | 'episode' | 'podcast'

interface AudioBlockObject {
  block_uuid?: string
  source_type: SourceType
  content?: {
    file_id: string
    file_format: string
    activity_uuid?: string
  }
  episode?: {
    podcast_uuid: string
    episode_uuid: string
    audio_file: string
    title: string
  }
  podcast?: {
    podcast_uuid: string
    name: string
  }
  size: AudioSize
}

interface Organization {
  org_uuid: string
}

interface Course {
  courseStructure: {
    course_uuid: string
  }
}

interface EditorState {
  isEditable: boolean
}

interface Session {
  data?: {
    tokens?: {
      access_token?: string
    }
  }
}

interface ExtendedNodeViewProps extends Omit<NodeViewProps, 'extension'> {
  extension: Node & {
    options: {
      activity: {
        activity_uuid: string
      }
    }
  }
}

// ─── Inline Audio Player (podcast-player inspired) ───

function formatTime(seconds: number): string {
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${r.toString().padStart(2, '0')}`
  return `${m}:${r.toString().padStart(2, '0')}`
}

function InlineAudioPlayer({ src, title }: { src: string; title?: string }) {
  const audioRef = React.useRef<HTMLAudioElement>(null)
  const progressRef = React.useRef<HTMLDivElement>(null)
  const [isPlaying, setIsPlaying] = React.useState(false)
  const [currentTime, setCurrentTime] = React.useState(0)
  const [duration, setDuration] = React.useState(0)
  const [volume, setVolume] = React.useState(1)
  const [isMuted, setIsMuted] = React.useState(false)
  const [prevVolume, setPrevVolume] = React.useState(1)

  React.useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onTimeUpdate = () => setCurrentTime(audio.currentTime)
    const onLoadedMetadata = () => setDuration(audio.duration)
    const onEnded = () => setIsPlaying(false)

    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('loadedmetadata', onLoadedMetadata)
    audio.addEventListener('ended', onEnded)
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
      audio.removeEventListener('ended', onEnded)
    }
  }, [src])

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return
    if (isPlaying) { audio.pause() } else { audio.play() }
    setIsPlaying(!isPlaying)
  }

  const skip = (delta: number) => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = Math.max(0, Math.min(audio.currentTime + delta, duration))
  }

  const seekTo = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current
    const bar = progressRef.current
    if (!audio || !bar) return
    const rect = bar.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    audio.currentTime = ratio * duration
  }

  const toggleMute = () => {
    const audio = audioRef.current
    if (!audio) return
    if (isMuted) {
      audio.volume = prevVolume
      setVolume(prevVolume)
    } else {
      setPrevVolume(volume)
      audio.volume = 0
      setVolume(0)
    }
    setIsMuted(!isMuted)
  }

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value)
    if (audioRef.current) audioRef.current.volume = v
    setVolume(v)
    setIsMuted(v === 0)
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <audio ref={audioRef} src={src} preload="metadata" />

      {/* Title bar */}
      {title && (
        <div className="px-4 pt-3 pb-1 flex items-center gap-2">
          <Headphones size={14} className="text-gray-400 flex-shrink-0" />
          <span className="text-sm font-semibold text-gray-900 truncate">{title}</span>
        </div>
      )}

      {/* Player controls */}
      <div className="px-4 py-3 flex items-center gap-3">
        {/* Skip back */}
        <button
          onClick={() => skip(-15)}
          className="p-1.5 rounded-full hover:bg-gray-100 transition-colors outline-none"
          title="Skip back 15s"
        >
          <SkipBack size={16} className="text-gray-600" />
        </button>

        {/* Play/Pause */}
        <button
          onClick={togglePlay}
          className="rounded-full bg-gray-900 hover:bg-gray-800 p-2.5 transition-colors outline-none"
        >
          {isPlaying ? (
            <Pause size={16} className="text-white" fill="white" />
          ) : (
            <Play size={16} className="text-white" fill="white" />
          )}
        </button>

        {/* Skip forward */}
        <button
          onClick={() => skip(15)}
          className="p-1.5 rounded-full hover:bg-gray-100 transition-colors outline-none"
          title="Skip forward 15s"
        >
          <SkipForward size={16} className="text-gray-600" />
        </button>

        {/* Time + Progress */}
        <span className="text-xs text-gray-500 w-10 text-end tabular-nums flex-shrink-0">
          {formatTime(currentTime)}
        </span>

        <div
          ref={progressRef}
          onClick={seekTo}
          className="flex-1 h-1.5 bg-gray-200 rounded-full cursor-pointer relative group"
        >
          <div
            className="h-full bg-gray-900 rounded-full transition-all duration-100"
            style={{ width: `${progress}%` }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-gray-900 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ left: `calc(${progress}% - 6px)` }}
          />
        </div>

        <span className="text-xs text-gray-500 w-10 tabular-nums flex-shrink-0">
          {formatTime(duration)}
        </span>

        {/* Volume */}
        <button
          onClick={toggleMute}
          className="p-1.5 rounded-full hover:bg-gray-100 transition-colors outline-none"
        >
          {isMuted || volume === 0 ? (
            <VolumeX size={16} className="text-gray-600" />
          ) : (
            <Volume2 size={16} className="text-gray-600" />
          )}
        </button>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume}
          onChange={handleVolumeChange}
          className="w-16 h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-gray-900"
        />
      </div>
    </div>
  )
}

// ─── Playlist Player (podcast-player inspired episode list) ───

function PlaylistPlayer({
  episodes,
  podcastName,
  orgUUID,
  podcastUUID,
}: {
  episodes: PodcastEpisode[]
  podcastName: string
  orgUUID: string
  podcastUUID: string
}) {
  const audioRef = React.useRef<HTMLAudioElement>(null)
  const progressRef = React.useRef<HTMLDivElement>(null)
  const [activeEpisode, setActiveEpisode] = React.useState<PodcastEpisode | null>(null)
  const [isPlaying, setIsPlaying] = React.useState(false)
  const [currentTime, setCurrentTime] = React.useState(0)
  const [duration, setDuration] = React.useState(0)

  React.useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onTimeUpdate = () => setCurrentTime(audio.currentTime)
    const onLoadedMetadata = () => setDuration(audio.duration)
    const onEnded = () => {
      setIsPlaying(false)
      // Auto-advance to next episode
      if (activeEpisode) {
        const idx = episodes.findIndex((e) => e.episode_uuid === activeEpisode.episode_uuid)
        if (idx >= 0 && idx < episodes.length - 1) {
          playEpisode(episodes[idx + 1])
        }
      }
    }
    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('loadedmetadata', onLoadedMetadata)
    audio.addEventListener('ended', onEnded)
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
      audio.removeEventListener('ended', onEnded)
    }
  }, [activeEpisode])

  const playEpisode = (episode: PodcastEpisode) => {
    const url = getPodcastAudioStreamUrl(orgUUID, podcastUUID, episode.episode_uuid, episode.audio_file)
    setActiveEpisode(episode)
    setCurrentTime(0)
    setDuration(0)
    if (audioRef.current) {
      audioRef.current.src = url
      audioRef.current.play()
      setIsPlaying(true)
    }
  }

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio || !activeEpisode) return
    if (isPlaying) { audio.pause() } else { audio.play() }
    setIsPlaying(!isPlaying)
  }

  const skip = (delta: number) => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = Math.max(0, Math.min(audio.currentTime + delta, duration))
  }

  const seekTo = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current
    const bar = progressRef.current
    if (!audio || !bar) return
    const rect = bar.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    audio.currentTime = ratio * duration
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <audio ref={audioRef} preload="metadata" />

      {/* Header */}
      <div className="px-4 pt-3 pb-2 border-b border-gray-100 flex items-center gap-2">
        <Radio size={14} className="text-gray-400 flex-shrink-0" />
        <span className="text-sm font-semibold text-gray-900">{podcastName}</span>
        <span className="text-xs text-gray-400 ms-auto">{episodes.length} episodes</span>
      </div>

      {/* Episode list */}
      <div className="max-h-64 overflow-y-auto divide-y divide-gray-50">
        {episodes.map((ep) => {
          const isCurrent = activeEpisode?.episode_uuid === ep.episode_uuid
          const isEpPlaying = isCurrent && isPlaying
          return (
            <div
              key={ep.episode_uuid}
              onClick={() => (isCurrent ? togglePlay() : playEpisode(ep))}
              className={cn(
                'flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors',
                isCurrent ? 'bg-gray-100' : 'hover:bg-gray-50'
              )}
            >
              {/* Play/Pause indicator */}
              <div
                className={cn(
                  'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors',
                  isCurrent ? 'bg-gray-900' : 'bg-gray-100 group-hover:bg-gray-200'
                )}
              >
                {isEpPlaying ? (
                  <Pause size={14} className={isCurrent ? 'text-white' : 'text-gray-600'} fill={isCurrent ? 'white' : 'currentColor'} />
                ) : (
                  <Play size={14} className={isCurrent ? 'text-white' : 'text-gray-600'} fill={isCurrent ? 'white' : 'currentColor'} />
                )}
              </div>

              {/* Episode info */}
              <div className="flex-1 min-w-0">
                <h4 className={cn('text-sm truncate', isCurrent ? 'font-semibold text-gray-900' : 'text-gray-800')}>
                  {ep.title}
                </h4>
                {ep.duration_seconds > 0 && (
                  <span className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                    <Clock size={10} />
                    {formatTime(ep.duration_seconds)}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Bottom player bar (visible when an episode is active) */}
      {activeEpisode && (
        <div className="border-t border-gray-200 px-4 py-3 bg-gray-50">
          {/* Now playing title */}
          <div className="flex items-center gap-2 mb-2">
            <Music size={12} className="text-gray-400 flex-shrink-0" />
            <span className="text-xs font-medium text-gray-700 truncate">{activeEpisode.title}</span>
          </div>

          {/* Controls row */}
          <div className="flex items-center gap-2">
            <button onClick={() => skip(-15)} className="p-1 rounded-full hover:bg-gray-200 transition-colors outline-none">
              <SkipBack size={14} className="text-gray-600" />
            </button>

            <button
              onClick={togglePlay}
              className="rounded-full bg-gray-900 hover:bg-gray-800 p-2 transition-colors outline-none"
            >
              {isPlaying ? (
                <Pause size={14} className="text-white" fill="white" />
              ) : (
                <Play size={14} className="text-white" fill="white" />
              )}
            </button>

            <button onClick={() => skip(15)} className="p-1 rounded-full hover:bg-gray-200 transition-colors outline-none">
              <SkipForward size={14} className="text-gray-600" />
            </button>

            <span className="text-xs text-gray-500 tabular-nums flex-shrink-0 w-8 text-end">
              {formatTime(currentTime)}
            </span>

            <div
              ref={progressRef}
              onClick={seekTo}
              className="flex-1 h-1 bg-gray-200 rounded-full cursor-pointer relative group"
            >
              <div className="h-full bg-gray-900 rounded-full transition-all duration-100" style={{ width: `${progress}%` }} />
              <div
                className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-gray-900 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ left: `calc(${progress}% - 5px)` }}
              />
            </div>

            <span className="text-xs text-gray-500 tabular-nums flex-shrink-0 w-8">
              {formatTime(duration)}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main AudioBlockComponent ───

function AudioBlockComponent(props: ExtendedNodeViewProps) {
  const { node, extension, updateAttributes } = props
  const org = useOrg() as Organization | null
  const { orgslug } = useOrgMembership()
  const course = useCourse() as Course | null
  const editorState = useEditorProvider() as EditorState
  const session = useLHSession() as Session

  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const uploadZoneRef = React.useRef<HTMLDivElement>(null)

  const [blockObject, setBlockObject] = React.useState<AudioBlockObject | null>(
    node.attrs.blockObject || null
  )
  const [selectedSize, setSelectedSize] = React.useState<AudioSize>(
    node.attrs.blockObject?.size || 'medium'
  )
  const [activeTab, setActiveTab] = React.useState<TabType>('upload')
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [isDragging, setIsDragging] = React.useState(false)
  const [uploadProgress, setUploadProgress] = React.useState(0)

  // Podcast selection state
  const [podcasts, setPodcasts] = React.useState<Podcast[]>([])
  const [podcastsLoading, setPodcastsLoading] = React.useState(false)
  const [selectedPodcast, setSelectedPodcast] = React.useState<Podcast | null>(null)
  const [episodes, setEpisodes] = React.useState<PodcastEpisode[]>([])
  const [episodesLoading, setEpisodesLoading] = React.useState(false)

  // Playlist meta for preview mode
  const [playlistMeta, setPlaylistMeta] = React.useState<PodcastMeta | null>(null)

  const isEditable = editorState?.isEditable
  const access_token = session?.data?.tokens?.access_token

  // Update block object when size changes
  React.useEffect(() => {
    if (blockObject && blockObject.size !== selectedSize) {
      const newBlockObject = { ...blockObject, size: selectedSize }
      setBlockObject(newBlockObject)
      updateAttributes({ blockObject: newBlockObject })
    }
  }, [selectedSize])

  // Fetch podcasts when episode or podcast tab is active
  React.useEffect(() => {
    if ((activeTab === 'episode' || activeTab === 'podcast') && podcasts.length === 0 && !podcastsLoading) {
      fetchPodcasts()
    }
  }, [activeTab])

  // Fetch playlist meta for podcast source_type
  React.useEffect(() => {
    if (blockObject?.source_type === 'podcast' && blockObject.podcast) {
      fetchPlaylistMeta(blockObject.podcast.podcast_uuid)
    }
  }, [blockObject?.source_type, blockObject?.podcast?.podcast_uuid])

  const fetchPodcasts = async () => {
    if (!orgslug) return
    setPodcastsLoading(true)
    try {
      const res = await getOrgPodcasts(orgslug, null, access_token, true)
      setPodcasts(res?.data || res || [])
    } catch {
      setPodcasts([])
    } finally {
      setPodcastsLoading(false)
    }
  }

  const fetchEpisodes = async (podcast_uuid: string) => {
    setEpisodesLoading(true)
    try {
      const meta = await getPodcastMeta(podcast_uuid, null, access_token)
      setEpisodes(meta?.episodes || [])
    } catch {
      setEpisodes([])
    } finally {
      setEpisodesLoading(false)
    }
  }

  const fetchPlaylistMeta = async (podcast_uuid: string) => {
    try {
      const meta = await getPodcastMeta(podcast_uuid, null, access_token)
      setPlaylistMeta(meta)
    } catch {
      setPlaylistMeta(null)
    }
  }

  const handleSelectPodcast = (podcast: Podcast) => {
    setSelectedPodcast(podcast)
    fetchEpisodes(podcast.podcast_uuid)
  }

  const handleSelectEpisode = (episode: PodcastEpisode) => {
    if (!selectedPodcast) return
    const newBlockObject: AudioBlockObject = {
      source_type: 'episode',
      episode: {
        podcast_uuid: selectedPodcast.podcast_uuid,
        episode_uuid: episode.episode_uuid,
        audio_file: episode.audio_file,
        title: episode.title,
      },
      size: selectedSize,
    }
    setBlockObject(newBlockObject)
    updateAttributes({ blockObject: newBlockObject })
  }

  const handleSelectPodcastPlaylist = (podcast: Podcast) => {
    const newBlockObject: AudioBlockObject = {
      source_type: 'podcast',
      podcast: {
        podcast_uuid: podcast.podcast_uuid,
        name: podcast.name,
      },
      size: selectedSize,
    }
    setBlockObject(newBlockObject)
    updateAttributes({ blockObject: newBlockObject })
  }

  const handleAudioChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      setError(null)
      handleUpload(file)
    }
  }

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.currentTarget === uploadZoneRef.current) setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    const ext = file?.name.split('.').pop()?.toLowerCase()
    if (file && ext && ['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) {
      setError(null)
      handleUpload(file)
    } else {
      setError('Please upload a supported audio format (MP3, WAV, OGG, or M4A)')
    }
  }

  const handleUpload = async (file: File) => {
    if (!access_token) return
    try {
      setIsLoading(true)
      setError(null)
      setUploadProgress(0)
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => Math.min(prev + 10, 90))
      }, 200)
      const object = await uploadNewAudioFile(file, extension.options.activity.activity_uuid, access_token)
      clearInterval(progressInterval)
      setUploadProgress(100)
      const newBlockObject: AudioBlockObject = { ...object, source_type: 'upload', size: selectedSize }
      setBlockObject(newBlockObject)
      updateAttributes({ blockObject: newBlockObject })
      setTimeout(() => setUploadProgress(0), 1000)
    } catch (err: any) {
      const errorMessage = err?.message || 'Failed to upload audio. Please try again.'
      setError(errorMessage)
      toast.error(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }

  const handleRemove = () => {
    setBlockObject(null)
    updateAttributes({ blockObject: null })
    setError(null)
    setUploadProgress(0)
    setSelectedPodcast(null)
    setEpisodes([])
    setPlaylistMeta(null)
  }

  // Build audio URLs
  const uploadAudioUrl =
    blockObject?.source_type === 'upload' && blockObject.content && org?.org_uuid && course?.courseStructure.course_uuid
      ? getAudioBlockStreamUrl(
          org.org_uuid,
          course.courseStructure.course_uuid,
          blockObject.content.activity_uuid || extension.options.activity.activity_uuid,
          blockObject.block_uuid || '',
          `${blockObject.content.file_id}.${blockObject.content.file_format}`
        )
      : null

  const episodeAudioUrl =
    blockObject?.source_type === 'episode' && blockObject.episode && org?.org_uuid
      ? getPodcastAudioStreamUrl(
          org.org_uuid,
          blockObject.episode.podcast_uuid,
          blockObject.episode.episode_uuid,
          blockObject.episode.audio_file
        )
      : null

  const getMaxWidth = (size: AudioSize) => {
    const mw = AUDIO_SIZES[size].maxWidth
    return typeof mw === 'number' ? mw : '100%'
  }

  // ===== PREVIEW MODE =====
  if (!isEditable) {
    if (!blockObject) return null
    const maxWidth = getMaxWidth(blockObject.size || 'medium')

    return (
      <NodeViewWrapper className="block-audio w-full">
        <div className="w-full flex justify-center my-4">
          <div style={{ maxWidth, width: '100%' }}>
            {blockObject.source_type === 'upload' && uploadAudioUrl && (
              <InlineAudioPlayer src={uploadAudioUrl} />
            )}

            {blockObject.source_type === 'episode' && episodeAudioUrl && (
              <InlineAudioPlayer src={episodeAudioUrl} title={blockObject.episode?.title} />
            )}

            {blockObject.source_type === 'podcast' && blockObject.podcast && org?.org_uuid && (
              playlistMeta?.episodes && playlistMeta.episodes.length > 0 ? (
                <PlaylistPlayer
                  episodes={playlistMeta.episodes}
                  podcastName={blockObject.podcast.name}
                  orgUUID={org.org_uuid}
                  podcastUUID={blockObject.podcast.podcast_uuid}
                />
              ) : (
                <div className="bg-white border border-gray-200 rounded-xl shadow-sm px-4 py-6 text-center">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-400" />
                  <p className="text-sm text-gray-400 mt-2">Loading playlist...</p>
                </div>
              )
            )}
          </div>
        </div>
      </NodeViewWrapper>
    )
  }

  // ===== EDIT MODE =====
  return (
    <NodeViewWrapper className="block-audio w-full">
      <div className="bg-neutral-50 rounded-xl px-5 py-4 nice-shadow transition-all ease-linear">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Headphones className="text-neutral-400" size={16} />
            <span className="uppercase tracking-widest text-xs font-bold text-neutral-400">Audio</span>
          </div>
          {blockObject && (
            <button onClick={handleRemove} className="text-neutral-400 hover:text-red-500 transition-colors">
              <X size={16} />
            </button>
          )}
        </div>

        {/* Selection UI (no block object yet) */}
        {!blockObject && (
          <div className="space-y-4">
            {/* Tabs */}
            <div className="flex gap-1 bg-neutral-100 rounded-lg p-1">
              {([
                { key: 'upload' as TabType, icon: Upload, label: 'Upload' },
                { key: 'episode' as TabType, icon: Music, label: 'Episode' },
                { key: 'podcast' as TabType, icon: List, label: 'Playlist' },
              ]).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors flex-1 justify-center outline-none',
                    activeTab === tab.key
                      ? 'bg-white text-neutral-800 shadow-sm'
                      : 'text-neutral-500 hover:text-neutral-700'
                  )}
                >
                  <tab.icon size={14} />
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Upload Tab */}
            {activeTab === 'upload' && (
              <div className="space-y-3">
                <input ref={fileInputRef} type="file" onChange={handleAudioChange} accept={SUPPORTED_FILES} className="hidden" />
                <div
                  ref={uploadZoneRef}
                  onClick={() => fileInputRef.current?.click()}
                  onDragEnter={handleDragEnter}
                  onDragOver={handleDragEnter}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={cn(
                    'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all',
                    isDragging ? 'border-blue-400 bg-blue-50' : 'border-neutral-200 bg-white hover:border-blue-400 hover:bg-blue-50/50'
                  )}
                >
                  {isLoading ? (
                    <div className="space-y-3">
                      <Loader2 className="w-8 h-8 animate-spin mx-auto text-blue-500" />
                      <p className="text-sm text-neutral-600">Uploading... {uploadProgress}%</p>
                      <div className="w-48 h-1 bg-neutral-200 rounded-full mx-auto overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full transition-all duration-200" style={{ width: `${uploadProgress}%` }} />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <Upload className="w-8 h-8 mx-auto text-neutral-400" />
                      <div>
                        <p className="text-sm font-medium text-neutral-700">Drop an audio file or click to browse</p>
                        <p className="text-xs text-neutral-500 mt-1">Supports MP3, WAV, OGG, M4A</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Episode Tab */}
            {activeTab === 'episode' && (
              <div className="space-y-3">
                {podcastsLoading ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="w-5 h-5 animate-spin text-neutral-400" />
                  </div>
                ) : !selectedPodcast ? (
                  <div className="space-y-1 max-h-60 overflow-y-auto">
                    {podcasts.length === 0 ? (
                      <p className="text-sm text-neutral-400 text-center py-4">No podcasts found</p>
                    ) : (
                      podcasts.map((p) => (
                        <div
                          key={p.podcast_uuid}
                          onClick={() => handleSelectPodcast(p)}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer hover:bg-neutral-100 transition-colors"
                        >
                          <Radio size={14} className="text-neutral-400 flex-shrink-0" />
                          <span className="text-sm text-neutral-700 truncate">{p.name}</span>
                        </div>
                      ))
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <button
                      onClick={() => { setSelectedPodcast(null); setEpisodes([]) }}
                      className="text-xs text-blue-500 hover:text-blue-600 flex items-center gap-1 outline-none"
                    >
                      &larr; Back to podcasts
                    </button>
                    <p className="text-sm font-medium text-neutral-700">{selectedPodcast.name}</p>
                    {episodesLoading ? (
                      <div className="flex items-center justify-center py-4">
                        <Loader2 className="w-5 h-5 animate-spin text-neutral-400" />
                      </div>
                    ) : (
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {episodes.length === 0 ? (
                          <p className="text-sm text-neutral-400 text-center py-4">No episodes found</p>
                        ) : (
                          episodes.map((ep) => (
                            <div
                              key={ep.episode_uuid}
                              onClick={() => handleSelectEpisode(ep)}
                              className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer hover:bg-blue-50 transition-colors"
                            >
                              <Music size={14} className="text-neutral-400 flex-shrink-0" />
                              <span className="text-sm text-neutral-700 truncate">{ep.title}</span>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Podcast (Playlist) Tab */}
            {activeTab === 'podcast' && (
              <div className="space-y-3">
                {podcastsLoading ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="w-5 h-5 animate-spin text-neutral-400" />
                  </div>
                ) : (
                  <div className="space-y-1 max-h-60 overflow-y-auto">
                    {podcasts.length === 0 ? (
                      <p className="text-sm text-neutral-400 text-center py-4">No podcasts found</p>
                    ) : (
                      podcasts.map((p) => (
                        <div
                          key={p.podcast_uuid}
                          onClick={() => handleSelectPodcastPlaylist(p)}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer hover:bg-blue-50 transition-colors"
                        >
                          <Radio size={14} className="text-neutral-400 flex-shrink-0" />
                          <div className="min-w-0">
                            <span className="text-sm text-neutral-700 truncate block">{p.name}</span>
                            <span className="text-xs text-neutral-400">{p.description}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 text-sm text-red-500 font-medium bg-red-50 rounded-lg p-3">
                <AlertCircle size={16} />
                {error}
              </div>
            )}
          </div>
        )}

        {/* Block exists — preview + controls */}
        {blockObject && (
          <div className="space-y-4">
            {/* Size Controls */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="text-sm text-neutral-500 font-medium flex items-center gap-1">
                <ArrowLeftRight size={14} />
                Size:
              </div>
              {(Object.keys(AUDIO_SIZES) as AudioSize[]).map((size) => (
                <button
                  key={size}
                  onClick={() => setSelectedSize(size)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors outline-none',
                    selectedSize === size
                      ? 'bg-neutral-700 text-white'
                      : 'bg-neutral-200 text-neutral-700 hover:bg-neutral-300'
                  )}
                >
                  {size === selectedSize && <CheckCircle2 size={14} />}
                  {AUDIO_SIZES[size].label}
                </button>
              ))}
            </div>

            {/* Audio Preview */}
            <div className="flex justify-center">
              <div style={{ maxWidth: getMaxWidth(selectedSize), width: '100%' }}>
                {blockObject.source_type === 'upload' && uploadAudioUrl && (
                  <InlineAudioPlayer src={uploadAudioUrl} />
                )}

                {blockObject.source_type === 'episode' && episodeAudioUrl && (
                  <InlineAudioPlayer src={episodeAudioUrl} title={blockObject.episode?.title} />
                )}

                {blockObject.source_type === 'podcast' && blockObject.podcast && org?.org_uuid && (
                  playlistMeta?.episodes && playlistMeta.episodes.length > 0 ? (
                    <PlaylistPlayer
                      episodes={playlistMeta.episodes}
                      podcastName={blockObject.podcast.name}
                      orgUUID={org.org_uuid}
                      podcastUUID={blockObject.podcast.podcast_uuid}
                    />
                  ) : (
                    <div className="bg-white border border-gray-200 rounded-xl shadow-sm px-4 py-4">
                      <div className="flex items-center gap-2">
                        <Radio size={14} className="text-gray-400" />
                        <span className="text-sm font-medium text-gray-700">{blockObject.podcast.name}</span>
                      </div>
                      <p className="text-xs text-gray-400 mt-1">Loading playlist...</p>
                    </div>
                  )
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </NodeViewWrapper>
  )
}

export default AudioBlockComponent
