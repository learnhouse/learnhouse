import { NodeViewProps, NodeViewWrapper } from '@tiptap/react'
import { Node } from '@tiptap/core'
import { CreditCost } from '@components/Objects/AI/CreditCost'
import { useAICreditPrices, useRefreshAICredits } from '@components/Hooks/useAICredits'
import { minutesFromText } from '@services/ai/credits'
import {
  CircleNotch, Headphones, UploadSimple, WarningCircle, Play, Pause, MusicNote, Radio, List,
  SkipBack, SkipForward, Clock, Users
} from '@phosphor-icons/react'
import { AIButton, AIMark } from '@components/Objects/AI/AIBrand'
import React from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { generateAudioBlock, generateScript, type GenerateAudioSpeaker } from '../../../../../services/blocks/Audio/audio'
import { getAudioBlockStreamUrl, getPodcastAudioStreamUrl } from '@services/media/media'
import { useOrg } from '@components/Contexts/OrgContext'
import { useOrgMembership } from '@components/Contexts/OrgContext'
import { useCourse } from '@components/Contexts/CourseContext'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { cn } from '@/lib/utils'
import { getOrgPodcasts, getPodcastMeta, type Podcast, type PodcastEpisode, type PodcastMeta } from '@services/podcasts/podcasts'
import { safePlay } from '@/lib/media/safePlay'
import InlineAudioPlayer, { formatTime } from '@components/Objects/Media/InlineAudioPlayer'
import { BlockChrome, BlockPopover, BlockToolbarButton, BlockToolbarDivider, CommitInput, Segmented, SettingsField } from '../../Blocks/ui/BlockChrome'
import BlockCaption from '../../Blocks/ui/BlockCaption'
import MediaSourcePicker from '../../Blocks/ui/MediaSourcePicker'
import { useBlockUpload } from '../../Blocks/media/useBlockUpload'
import { fetchRemoteFile, UrlImportError } from '../../Blocks/media/urlImport'
import { normalizeUserUrl } from '../../Blocks/embeds/embedProviders'
import { libraryMediaNodeAttrs } from '../../Blocks/media/librarySnapshot'
import { uploadErrorText } from '../../Blocks/media/uploadMessages'
import { deleteBlock, replaceBlock } from '../../Blocks/nodeViewUtils'
import { ArrowsHorizontal, Article, Trash, ArrowCounterClockwise } from '@phosphor-icons/react'

// The AI tab/mode icon: the brand mark sized like the Phosphor icons around it.
const AITabIcon = ({ size = 14 }: { size?: number }) => <AIMark size={size} alt="" />

const AUDIO_SIZES = {
  small: { maxWidth: 400, labelKey: 'editor.blocks.common.small' },
  medium: { maxWidth: 600, labelKey: 'editor.blocks.common.medium' },
  large: { maxWidth: 800, labelKey: 'editor.blocks.common.large' },
  full: { maxWidth: '100%', labelKey: 'editor.blocks.common.full_width' },
} as const

type AudioSize = keyof typeof AUDIO_SIZES
type SourceType = 'upload' | 'episode' | 'podcast'
type TabType = 'upload' | 'generate' | 'episode' | 'podcast'

// AI audio generation (Gemini TTS). Curated subset of the prebuilt voices, and a
// list of well-supported languages. Language is otherwise auto-detected from the
// text; picking one just nudges the model.
const TTS_VOICES = [
  { name: 'Kore', descKey: 'editor.blocks.audio_block.voice_firm' },
  { name: 'Puck', descKey: 'editor.blocks.audio_block.voice_upbeat' },
  { name: 'Zephyr', descKey: 'editor.blocks.audio_block.voice_bright' },
  { name: 'Charon', descKey: 'editor.blocks.audio_block.voice_informative' },
  { name: 'Aoede', descKey: 'editor.blocks.audio_block.voice_breezy' },
  { name: 'Achird', descKey: 'editor.blocks.audio_block.voice_friendly' },
  { name: 'Sulafat', descKey: 'editor.blocks.audio_block.voice_warm' },
  { name: 'Enceladus', descKey: 'editor.blocks.audio_block.voice_breathy' },
  { name: 'Leda', descKey: 'editor.blocks.audio_block.voice_youthful' },
  { name: 'Sadaltager', descKey: 'editor.blocks.audio_block.voice_knowledgeable' },
]
const TTS_LANGUAGES = [
  'Auto-detect', 'English', 'Spanish', 'French', 'German', 'Portuguese',
  'Italian', 'Dutch', 'Arabic', 'Hindi', 'Japanese', 'Korean',
  'Chinese (Mandarin)', 'Russian', 'Turkish', 'Polish', 'Indonesian', 'Vietnamese',
]
// Approximate podcast/talk length options, in minutes (from 2).
const LENGTH_OPTIONS = [2, 3, 5, 10]

type GenMode = 'tts' | 'speak' | 'podcast'

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

  const playEpisode = (episode: PodcastEpisode) => {
    const url = getPodcastAudioStreamUrl(orgUUID, podcastUUID, episode.episode_uuid, episode.audio_file)
    setActiveEpisode(episode)
    setCurrentTime(0)
    setDuration(0)
    if (audioRef.current) {
      audioRef.current.src = url
      safePlay(audioRef.current)
      setIsPlaying(true)
    }
  }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEpisode])

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio || !activeEpisode) return
    if (isPlaying) { audio.pause() } else { safePlay(audio) }
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
        <Radio weight="duotone" size={14} className="text-gray-400 flex-shrink-0" />
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
                  <Pause weight="duotone" size={14} className={isCurrent ? 'text-white' : 'text-gray-600'} fill={isCurrent ? 'white' : 'currentColor'} />
                ) : (
                  <Play weight="duotone" size={14} className={isCurrent ? 'text-white' : 'text-gray-600'} fill={isCurrent ? 'white' : 'currentColor'} />
                )}
              </div>

              {/* Episode info */}
              <div className="flex-1 min-w-0">
                <h4 className={cn('text-sm truncate', isCurrent ? 'font-semibold text-gray-900' : 'text-gray-800')}>
                  {ep.title}
                </h4>
                {ep.duration_seconds > 0 && (
                  <span className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                    <Clock weight="duotone" size={10} />
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
            <MusicNote weight="duotone" size={12} className="text-gray-400 flex-shrink-0" />
            <span className="text-xs font-medium text-gray-700 truncate">{activeEpisode.title}</span>
          </div>

          {/* Controls row */}
          <div className="flex items-center gap-2">
            <button onClick={() => skip(-15)} className="p-1 max-md:p-2.5 rounded-full hover:bg-gray-200 transition-colors outline-none">
              <SkipBack weight="duotone" size={14} className="text-gray-600" />
            </button>

            <button
              onClick={togglePlay}
              className="rounded-full bg-gray-900 hover:bg-gray-800 p-2 max-md:p-3 transition-colors outline-none"
            >
              {isPlaying ? (
                <Pause weight="duotone" size={14} className="text-white" fill="white" />
              ) : (
                <Play weight="duotone" size={14} className="text-white" fill="white" />
              )}
            </button>

            <button onClick={() => skip(15)} className="p-1 max-md:p-2.5 rounded-full hover:bg-gray-200 transition-colors outline-none">
              <SkipForward weight="duotone" size={14} className="text-gray-600" />
            </button>

            <span className="text-xs text-gray-500 tabular-nums flex-shrink-0 w-8 text-end">
              {formatTime(currentTime)}
            </span>

            <div
              ref={progressRef}
              onClick={seekTo}
              // dir="ltr": see InlineAudioPlayer. Fill, thumb and seek math all
              // assume left-to-right, and audio transport is LTR everywhere.
              dir="ltr"
              className="flex-1 h-1 max-md:h-1.5 bg-gray-200 rounded-full cursor-pointer relative group"
            >
              <div className="h-full bg-gray-900 rounded-full transition-all duration-100" style={{ width: `${progress}%` }} />
              <div
                className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 max-md:w-3.5 max-md:h-3.5 bg-gray-900 rounded-full opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity"
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
  const { t } = useTranslation()
  const { node, extension, updateAttributes } = props
  const org = useOrg() as Organization | null
  const { orgslug } = useOrgMembership()
  const course = useCourse() as Course | null
  const editorState = useEditorProvider() as EditorState
  const session = useLHSession() as Session

  // The block reads its source from the node attrs (the shared document), so
  // undo and collaborators' changes show; writes go through updateAttributes.
  const blockObject: AudioBlockObject | null = node.attrs.blockObject || null
  const setBlockObject = (_next: AudioBlockObject | null) => {}
  const [pendingSize, setPendingSize] = React.useState<AudioSize>('medium')
  const selectedSize: AudioSize = blockObject?.size || pendingSize
  const setSelectedSize = (size: AudioSize) => {
    if (blockObject) updateAttributes({ blockObject: { ...blockObject, size } })
    else setPendingSize(size)
  }
  const caption: string = node.attrs.caption || ''
  const transcript: string = node.attrs.transcript || ''
  // ai-credits: prices before, what the last generation used after.
  const { estimate: estimateCredits } = useAICreditPrices()
  const refreshCredits = useRefreshAICredits()
  const [creditsUsed, setCreditsUsed] = React.useState<number | null>(null)
  const [popover, setPopover] = React.useState<null | 'size' | 'transcript'>(null)
  const [activeTab, setActiveTab] = React.useState<TabType>('upload')
  const [error, setError] = React.useState<string | null>(null)

  // AI generation state
  const [genMode, setGenMode] = React.useState<GenMode>('tts')
  const [genText, setGenText] = React.useState('')
  const [genVoice, setGenVoice] = React.useState(TTS_VOICES[0].name)
  const [genLanguage, setGenLanguage] = React.useState(TTS_LANGUAGES[0])
  const [genStyle, setGenStyle] = React.useState('')
  const [genMinutes, setGenMinutes] = React.useState<number>(LENGTH_OPTIONS[0])
  const [genSpeakers, setGenSpeakers] = React.useState<GenerateAudioSpeaker[]>([
    { name: 'Host', voice: 'Kore' },
    { name: 'Guest', voice: 'Puck' },
  ])
  const [isGenerating, setIsGenerating] = React.useState(false)
  const [isGeneratingScript, setIsGeneratingScript] = React.useState(false)

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

  const upload = useBlockUpload({
    kind: 'audio',
    activityUuid: extension.options.activity?.activity_uuid,
    accessToken: access_token,
    onUploaded: (object) => {
      updateAttributes({ blockObject: { ...object, source_type: 'upload', size: selectedSize } })
    },
  })

  const importFromUrl = async (input: string): Promise<string | void> => {
    const url = normalizeUserUrl(input)
    if (!url) return uploadErrorText(t, { code: 'url' })
    try {
      upload.start(await fetchRemoteFile(url, 'audio'))
    } catch (err) {
      if (err instanceof UrlImportError) return uploadErrorText(t, { code: err.code, kind: 'audio', error: err.message })
      return uploadErrorText(t, { code: 'server', error: (err as any)?.message })
    }
  }

  const handleGenerate = async () => {
    setCreditsUsed(null)
    if (!access_token) return
    if (!genText.trim()) {
      setError(t('editor.blocks.audio_block.text_required'))
      return
    }
    try {
      setIsGenerating(true)
      setError(null)
      // 'speak' narrates a single voice, same as plain text-to-speech.
      const object = await generateAudioBlock(
        {
          activity_uuid: extension.options.activity.activity_uuid,
          mode: genMode === 'podcast' ? 'podcast' : 'tts',
          text: genText,
          voice: genMode !== 'podcast' ? genVoice : undefined,
          speakers: genMode === 'podcast' ? genSpeakers : undefined,
          style: genStyle.trim() || undefined,
          language: genLanguage === 'Auto-detect' ? undefined : genLanguage,
        },
        access_token,
        setCreditsUsed
      )
      refreshCredits()
      // Generated audio is stored like an upload, so treat it identically.
      const newBlockObject: AudioBlockObject = { ...object, source_type: 'upload', size: selectedSize }
      setBlockObject(newBlockObject)
      updateAttributes({ blockObject: newBlockObject })
      toast.success(t('editor.blocks.audio_block.generated'))
    } catch (err: any) {
      const errorMessage = err?.message || t('editor.blocks.audio_block.generate_failed')
      setError(errorMessage)
      toast.error(errorMessage)
    } finally {
      setIsGenerating(false)
    }
  }

  const handleGenerateScript = async () => {
    if (!access_token) return
    if (!genText.trim()) {
      setError(t('editor.blocks.audio_block.topic_required'))
      return
    }
    try {
      setIsGeneratingScript(true)
      setError(null)
      const res = await generateScript(
        {
          activity_uuid: extension.options.activity.activity_uuid,
          mode: genMode === 'podcast' ? 'podcast' : 'speak',
          text: genText,
          speakers: genMode === 'podcast' ? genSpeakers : undefined,
          style: genStyle.trim() || undefined,
          language: genLanguage === 'Auto-detect' ? undefined : genLanguage,
          minutes: genMinutes,
        },
        access_token,
        setCreditsUsed
      )
      refreshCredits()
      if (res?.transcript) {
        setGenText(res.transcript)
        toast.success(t('editor.blocks.audio_block.script_ready'))
      }
    } catch (err: any) {
      const errorMessage = err?.message || t('editor.blocks.audio_block.script_failed')
      setError(errorMessage)
      toast.error(errorMessage)
    } finally {
      setIsGeneratingScript(false)
    }
  }

  const handleRemove = () => {
    updateAttributes({ blockObject: null })
    setError(null)
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
                  <CircleNotch weight="duotone" className="w-5 h-5 animate-spin mx-auto text-gray-400" />
                  <p className="text-sm text-gray-400 mt-2">{t('editor.blocks.audio_block.loading_playlist')}</p>
                </div>
              )
            )}
            <BlockCaption value={caption} editable={false} />
            {transcript.trim() && (
              <details className="group mt-2 rounded-xl bg-neutral-50 px-4 py-2.5 text-sm text-neutral-700 ring-1 ring-inset ring-black/[0.05]">
                <summary className="cursor-pointer select-none text-[13px] font-medium text-neutral-600 marker:text-neutral-400">
                  {t('editor.blocks_v2.transcript', 'Transcript')}
                </summary>
                <div className="mt-2 whitespace-pre-line leading-relaxed">{transcript}</div>
              </details>
            )}
          </div>
        </div>
      </NodeViewWrapper>
    )
  }

  // ===== EDIT MODE =====
  return (
    <NodeViewWrapper className="block-audio w-full">
      <BlockChrome tone="media"
        selected={props.selected}
        forceToolbar={!!popover}
        label={<><Headphones size={11} weight="bold" />{t('editor.blocks.audio')}</>}
        toolbar={
          <>
            {blockObject && (
              <>
                <BlockPopover
                  open={popover === 'size'}
                  onOpenChange={(o) => setPopover(o ? 'size' : null)}
                  title={t('editor.blocks.common.size', 'Size')}
                  width={300}
                  trigger={<BlockToolbarButton label={t('editor.blocks.common.size', 'Size')}><ArrowsHorizontal size={14} /></BlockToolbarButton>}
                >
                  <Segmented
                    ariaLabel={t('editor.blocks.common.size', 'Size')}
                    value={selectedSize}
                    onChange={(size) => setSelectedSize(size)}
                    options={(Object.keys(AUDIO_SIZES) as AudioSize[]).map((size) => ({ value: size, label: t(AUDIO_SIZES[size].labelKey) }))}
                  />
                </BlockPopover>
                <BlockPopover
                  open={popover === 'transcript'}
                  onOpenChange={(o) => setPopover(o ? 'transcript' : null)}
                  title={t('editor.blocks_v2.transcript', 'Transcript')}
                  width={380}
                  trigger={
                    <BlockToolbarButton label={t('editor.blocks_v2.transcript', 'Transcript')} active={!!transcript.trim()}>
                      <Article size={14} />
                    </BlockToolbarButton>
                  }
                >
                  <SettingsField
                    label={t('editor.blocks_v2.transcript_label', 'What is said in this recording')}
                    hint={t('editor.blocks_v2.transcript_hint', 'Learners can open it under the player. Helps deaf and hard-of-hearing learners and anyone who prefers reading.')}
                  >
                    <CommitInput
                      multiline
                      value={transcript}
                      onCommit={(v) => updateAttributes({ transcript: v.slice(0, 50000) })}
                      placeholder={t('editor.blocks_v2.transcript_placeholder', 'Paste or type the transcript…')}
                      aria-label={t('editor.blocks_v2.transcript', 'Transcript')}
                    />
                  </SettingsField>
                </BlockPopover>
                <BlockToolbarDivider />
                <BlockToolbarButton label={t('editor.blocks_v2.change_source', 'Change source')} onClick={handleRemove}>
                  <ArrowCounterClockwise size={14} />
                </BlockToolbarButton>
              </>
            )}
            <BlockToolbarButton label={t('common.delete', 'Delete')} tone="danger" onClick={() => deleteBlock(props as any)}>
              <Trash size={14} />
            </BlockToolbarButton>
          </>
        }
      >
      <div className="rounded-xl bg-white p-3 shadow-[0_0_0_1px_var(--lhb-border,rgba(0,0,0,0.07))] sm:p-4">

        {/* Selection UI (no block object yet) */}
        {!blockObject && (
          <div className="space-y-4">
            {/* Tabs */}
            <div className="flex gap-1 bg-neutral-100 rounded-lg p-1">
              {([
                { key: 'upload' as TabType, icon: UploadSimple, label: t('editor.blocks.common.upload') },
                { key: 'generate' as TabType, icon: AITabIcon, label: t('editor.blocks.audio_block.tab_generate') },
                { key: 'episode' as TabType, icon: MusicNote, label: t('editor.blocks.audio_block.tab_episode') },
                { key: 'podcast' as TabType, icon: List, label: t('editor.blocks.audio_block.tab_playlist') },
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
              <MediaSourcePicker
                kind="audio"
                icon={<Headphones size={20} weight="duotone" />}
                title={t('editor.blocks_v2.audio_title', 'Add an audio file')}
                onFile={(f) => upload.start(f)}
                onUrl={importFromUrl}
                urlPlaceholder={t('editor.blocks_v2.audio_link_placeholder', 'Paste a link to an MP3, WAV, OGG or M4A file…')}
                onLibrarySelect={(r) => replaceBlock(props as any, { type: 'blockLibrary', attrs: libraryMediaNodeAttrs(r) })}
                task={upload.task}
                rejection={upload.rejection}
                onCancel={upload.cancel}
                onRetry={upload.retry}
                onDismiss={upload.dismiss}
              />
            )}

            {/* Generate Tab (AI / Gemini TTS) */}
            {activeTab === 'generate' && (
              <div className="space-y-3">
                {/* Mode toggle */}
                <div className="flex gap-1 bg-neutral-100 rounded-lg p-1">
                  {([
                    { key: 'tts' as const, icon: AITabIcon, label: t('editor.blocks.audio_block.mode_tts') },
                    { key: 'podcast' as const, icon: Users, label: t('editor.blocks.audio_block.mode_podcast') },
                    { key: 'speak' as const, icon: Radio, label: t('editor.blocks.audio_block.mode_speak') },
                  ]).map((m) => (
                    <button
                      key={m.key}
                      onClick={() => setGenMode(m.key)}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors flex-1 justify-center outline-none',
                        genMode === m.key ? 'bg-white text-neutral-800 shadow-sm' : 'text-neutral-500 hover:text-neutral-700'
                      )}
                    >
                      <m.icon size={13} />
                      {m.label}
                    </button>
                  ))}
                </div>

                {/* Script / text */}
                <textarea
                  value={genText}
                  onChange={(e) => setGenText(e.target.value)}
                  rows={genMode === 'tts' ? 4 : 5}
                  placeholder={
                    genMode === 'podcast'
                      ? t('editor.blocks.audio_block.placeholder_podcast')
                      : genMode === 'speak'
                        ? t('editor.blocks.audio_block.placeholder_speak')
                        : t('editor.blocks.audio_block.placeholder_tts')
                  }
                  className="w-full rounded-lg border border-neutral-200 p-3 text-sm outline-none focus:border-blue-400 resize-y"
                />

                {/* Voice(s): single voice for text-to-speech and speak; two for podcast */}
                {genMode !== 'podcast' ? (
                  <label className="block">
                    <span className="text-xs font-medium text-neutral-600">{t('editor.blocks.audio_block.voice')}</span>
                    <select
                      value={genVoice}
                      onChange={(e) => setGenVoice(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-neutral-200 p-2 text-sm outline-none focus:border-blue-400 bg-white"
                    >
                      {TTS_VOICES.map((v) => (
                        <option key={v.name} value={v.name}>{v.name}: {t(v.descKey)}</option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <div className="space-y-2">
                    {genSpeakers.map((sp, i) => (
                      <div key={i} className="flex gap-2">
                        <input
                          value={sp.name}
                          onChange={(e) => {
                            const next = [...genSpeakers]
                            next[i] = { ...next[i], name: e.target.value }
                            setGenSpeakers(next)
                          }}
                          placeholder={t('editor.blocks.audio_block.speaker_name')}
                          className="flex-1 rounded-lg border border-neutral-200 p-2 text-sm outline-none focus:border-blue-400"
                        />
                        <select
                          value={sp.voice}
                          onChange={(e) => {
                            const next = [...genSpeakers]
                            next[i] = { ...next[i], voice: e.target.value }
                            setGenSpeakers(next)
                          }}
                          className="rounded-lg border border-neutral-200 p-2 text-sm outline-none focus:border-blue-400 bg-white"
                        >
                          {TTS_VOICES.map((v) => (
                            <option key={v.name} value={v.name}>{v.name}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                    <p className="text-[11px] text-neutral-400">
                      {t('editor.blocks.audio_block.podcast_hint')}
                    </p>
                  </div>
                )}

                {/* Length (podcast / speak) + language + tone */}
                <div className="flex gap-2">
                  {genMode !== 'tts' && (
                    <label className="w-28 shrink-0">
                      <span className="text-xs font-medium text-neutral-600">{t('editor.blocks.audio_block.length')}</span>
                      <select
                        value={genMinutes}
                        onChange={(e) => setGenMinutes(Number(e.target.value))}
                        className="mt-1 w-full rounded-lg border border-neutral-200 p-2 text-sm outline-none focus:border-blue-400 bg-white"
                      >
                        {LENGTH_OPTIONS.map((m) => (
                          <option key={m} value={m}>{t('editor.blocks.audio_block.minutes_short', { count: m })}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label className="flex-1">
                    <span className="text-xs font-medium text-neutral-600">{t('editor.blocks.audio_block.language')}</span>
                    <select
                      value={genLanguage}
                      onChange={(e) => setGenLanguage(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-neutral-200 p-2 text-sm outline-none focus:border-blue-400 bg-white"
                    >
                      {TTS_LANGUAGES.map((l) => (
                        <option key={l} value={l}>{l === 'Auto-detect' ? t('editor.blocks.audio_block.auto_detect') : l}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex-1">
                    <span className="text-xs font-medium text-neutral-600">{t('editor.blocks.audio_block.tone_style')}</span>
                    <input
                      value={genStyle}
                      onChange={(e) => setGenStyle(e.target.value)}
                      placeholder={t('editor.blocks.audio_block.tone_placeholder')}
                      className="mt-1 w-full rounded-lg border border-neutral-200 p-2 text-sm outline-none focus:border-blue-400"
                    />
                  </label>
                </div>

                {/* Podcast / Speak: turn the topic into a script first */}
                {genMode !== 'tts' && (
                  <button
                    onClick={handleGenerateScript}
                    disabled={isGeneratingScript || isGenerating || !genText.trim()}
                    className={cn(
                      'w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold border transition-colors',
                      isGeneratingScript || isGenerating || !genText.trim()
                        ? 'border-neutral-200 text-neutral-400 cursor-not-allowed'
                        : 'border-neutral-300 text-neutral-700 hover:bg-neutral-50'
                    )}
                  >
                    {isGeneratingScript ? (
                      <><CircleNotch size={15} className="animate-spin" /> {genMode === 'podcast' ? t('editor.blocks.audio_block.writing_discussion') : t('editor.blocks.audio_block.writing_talk')}</>
                    ) : (
                      <><AIMark size={16} alt="" /> {genMode === 'podcast' ? t('editor.blocks.audio_block.generate_discussion_script') : t('editor.blocks.audio_block.generate_talk_script')}</>
                    )}
                  </button>
                )}

                {/* Generate audio button */}
                <AIButton
                  size="lg"
                  onClick={handleGenerate}
                  disabled={isGeneratingScript || !genText.trim()}
                  loading={isGenerating}
                  className="w-full"
                >
                  {isGenerating ? t('editor.blocks.audio_block.generating') : t('editor.blocks.audio_block.generate_audio')}
                </AIButton>
                <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-center text-neutral-400">
                  {genMode !== 'tts' && (
                    <span>
                      {t('ai_credits.audio.script', { count: estimateCredits('podcast_script') ?? 1, defaultValue: 'Script: about {{count}} credits' })}
                    </span>
                  )}
                  <CreditCost
                    credits={estimateCredits('podcast_audio', minutesFromText(genText))}
                    className="!text-[11px] !text-neutral-400"
                  />
                  <span className="text-neutral-300">
                    {t('ai_credits.audio.per_minute', { count: estimateCredits('podcast_audio') ?? 0, defaultValue: '{{count}} credits per minute of audio' })}
                  </span>
                </p>
                {creditsUsed != null && !isGenerating && (
                  <p className="text-center"><CreditCost kind="used" credits={creditsUsed} /></p>
                )}
              </div>
            )}

            {/* Episode Tab */}
            {activeTab === 'episode' && (
              <div className="space-y-3">
                {podcastsLoading ? (
                  <div className="flex items-center justify-center py-6">
                    <CircleNotch weight="duotone" className="w-5 h-5 animate-spin text-neutral-400" />
                  </div>
                ) : !selectedPodcast ? (
                  <div className="space-y-1 max-h-60 overflow-y-auto">
                    {podcasts.length === 0 ? (
                      <p className="text-sm text-neutral-400 text-center py-4">{t('editor.blocks.audio_block.no_podcasts')}</p>
                    ) : (
                      podcasts.map((p) => (
                        <div
                          key={p.podcast_uuid}
                          onClick={() => handleSelectPodcast(p)}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer hover:bg-neutral-100 transition-colors"
                        >
                          <Radio weight="duotone" size={14} className="text-neutral-400 flex-shrink-0" />
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
                      &larr; {t('editor.blocks.audio_block.back_to_podcasts')}
                    </button>
                    <p className="text-sm font-medium text-neutral-700">{selectedPodcast.name}</p>
                    {episodesLoading ? (
                      <div className="flex items-center justify-center py-4">
                        <CircleNotch weight="duotone" className="w-5 h-5 animate-spin text-neutral-400" />
                      </div>
                    ) : (
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {episodes.length === 0 ? (
                          <p className="text-sm text-neutral-400 text-center py-4">{t('editor.blocks.audio_block.no_episodes')}</p>
                        ) : (
                          episodes.map((ep) => (
                            <div
                              key={ep.episode_uuid}
                              onClick={() => handleSelectEpisode(ep)}
                              className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer hover:bg-blue-50 transition-colors"
                            >
                              <MusicNote weight="duotone" size={14} className="text-neutral-400 flex-shrink-0" />
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
                    <CircleNotch weight="duotone" className="w-5 h-5 animate-spin text-neutral-400" />
                  </div>
                ) : (
                  <div className="space-y-1 max-h-60 overflow-y-auto">
                    {podcasts.length === 0 ? (
                      <p className="text-sm text-neutral-400 text-center py-4">{t('editor.blocks.audio_block.no_podcasts')}</p>
                    ) : (
                      podcasts.map((p) => (
                        <div
                          key={p.podcast_uuid}
                          onClick={() => handleSelectPodcastPlaylist(p)}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer hover:bg-blue-50 transition-colors"
                        >
                          <Radio weight="duotone" size={14} className="text-neutral-400 flex-shrink-0" />
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
                <WarningCircle weight="duotone" size={16} />
                {error}
              </div>
            )}
          </div>
        )}

        {/* Block exists: preview + controls */}
        {blockObject && (
          <div className="space-y-4">
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
                      <p className="text-xs text-gray-400 mt-1">{t('editor.blocks.audio_block.loading_playlist')}</p>
                    </div>
                  )
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      {blockObject && (
        <BlockCaption value={caption} editable selected={props.selected} onCommit={(value) => updateAttributes({ caption: value })} />
      )}
      </BlockChrome>
    </NodeViewWrapper>
  )
}

export default AudioBlockComponent
