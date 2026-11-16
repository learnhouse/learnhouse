'use client'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { DragDropContext, Draggable, Droppable, DropResult } from '@hello-pangea/dnd'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { usePodcast } from '@components/Contexts/PodcastContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import {
  createEpisode,
  deleteEpisode,
  reorderEpisodes,
  updateEpisode,
  uploadEpisodeAudio,
  uploadEpisodeThumbnail,
  PodcastEpisode,
  formatDuration,
} from '@services/podcasts/episodes'
import { getEpisodeAudioMediaDirectory, getEpisodeThumbnailMediaDirectory } from '@services/media/media'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { revalidateTags } from '@services/utils/ts/requests'
import { getErrorMessage } from '@services/utils/ts/errorMessage'
import { useTranslation } from 'react-i18next'
import {
  ArrowDown,
  ArrowUp,
  CheckCircle,
  DotsSixVertical,
  DotsThree,
  Eye,
  EyeSlash,
  ImageSquare,
  ListNumbers,
  MusicNotes,
  Pause,
  PencilSimpleLine,
  Play,
  Plus,
  Trash,
  UploadSimple,
  Warning,
  X,
} from '@phosphor-icons/react'
import toast from 'react-hot-toast'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { Switch } from '@components/ui/switch'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import {
  Button,
  Chip,
  ConfirmDialog,
  EmptyState,
  FieldLabel,
  INPUT,
  SectionCard,
  TEXTAREA,
} from '@components/Dashboard/Shared/DashKit/DashKit'
import { PodcastEditorPage as EditorPage, PodcastEditorSkeleton as EditorSkeleton } from '../podcastEditorUi'
import { safePlay } from '@/lib/media/safePlay'

interface EditPodcastEpisodesProps {
  orgslug: string
  podcastuuid: string
}

const ITEM = 'flex items-center gap-2 cursor-pointer'

const byOrder = (list: PodcastEpisode[]) => [...list].sort((a, b) => a.order - b.order)

function EditPodcastEpisodes({ orgslug, podcastuuid }: EditPodcastEpisodesProps) {
  const { t } = useTranslation()
  const { podcast, episodes: rawEpisodes, refreshPodcast, setEpisodes, isLoading } = usePodcast()
  const session = useLHSession() as any
  const org = useOrg() as any
  const accessToken = session?.data?.tokens?.access_token
  const queryClient = useQueryClient()
  const { track } = useLHAnalytics('dashboard')

  const episodes = useMemo(() => byOrder(Array.isArray(rawEpisodes) ? rawEpisodes : []), [rawEpisodes])

  // `null` = closed, 'new' = create, otherwise the episode being edited.
  const [modal, setModalState] = useState<'new' | PodcastEpisode | null>(null)
  // Bumped on every open so the modal starts from fresh form state.
  const [modalSeq, setModalSeq] = useState(0)
  const setModal = (next: 'new' | PodcastEpisode | null) => {
    if (next) setModalSeq((n) => n + 1)
    setModalState(next)
  }
  const [toDelete, setToDelete] = useState<PodcastEpisode | null>(null)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Stop playback when leaving the tab.
  useEffect(() => () => audioRef.current?.pause(), [])

  const afterChange = async () => {
    await revalidateTags(['podcasts'], orgslug)
    queryClient.invalidateQueries({ queryKey: queryKeys.podcasts.episodes(podcastuuid) })
    queryClient.invalidateQueries({ queryKey: queryKeys.podcasts.list(orgslug) })
  }

  const handlePlayPause = (episode: PodcastEpisode) => {
    if (!episode.audio_file) return
    if (playingId === episode.episode_uuid) {
      audioRef.current?.pause()
      setPlayingId(null)
      return
    }
    audioRef.current?.pause()
    const audio = new Audio(getEpisodeAudioMediaDirectory(org?.org_uuid, podcastuuid, episode.episode_uuid, episode.audio_file))
    audio.onended = () => setPlayingId(null)
    safePlay(audio)
    audioRef.current = audio
    setPlayingId(episode.episode_uuid)
  }

  // Reorders locally first, then saves the whole order in one call.
  const applyOrder = async (next: PodcastEpisode[]) => {
    const previous = rawEpisodes
    const ordered = next.map((ep, index) => ({ ...ep, order: index }))
    setEpisodes(ordered)
    try {
      await reorderEpisodes(
        podcastuuid,
        ordered.map((ep) => ({ episode_uuid: ep.episode_uuid, order: ep.order })),
        accessToken
      )
      afterChange()
    } catch (error: any) {
      setEpisodes(previous)
      toast.error(getErrorMessage(error?.detail, t('podcasts.dashboard.episodes.reorder_error')))
    }
  }

  const onDragEnd = (result: DropResult) => {
    if (!result.destination || result.destination.index === result.source.index) return
    const next = [...episodes]
    const [moved] = next.splice(result.source.index, 1)
    next.splice(result.destination.index, 0, moved)
    applyOrder(next)
  }

  const move = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= episodes.length) return
    const next = [...episodes]
    ;[next[index], next[target]] = [next[target], next[index]]
    applyOrder(next)
  }

  const togglePublished = async (episode: PodcastEpisode) => {
    const previous = rawEpisodes
    setEpisodes(episodes.map((ep) => (ep.episode_uuid === episode.episode_uuid ? { ...ep, published: !ep.published } : ep)))
    try {
      await updateEpisode(episode.episode_uuid, { published: !episode.published }, accessToken)
      track(AnalyticsEvent.EpisodePublishToggled, { new_state: !episode.published })
      toast.success(t('podcasts.dashboard.episodes.updated'))
      afterChange()
    } catch (error) {
      console.error('Failed to update episode:', error)
      setEpisodes(previous)
      toast.error(t('podcasts.dashboard.episodes.update_error'))
    }
  }

  const remove = async (episode: PodcastEpisode) => {
    const toastId = toast.loading(t('podcasts.dashboard.episodes.deleting'))
    try {
      await deleteEpisode(episode.episode_uuid, accessToken)
      if (playingId === episode.episode_uuid) {
        audioRef.current?.pause()
        setPlayingId(null)
      }
      await refreshPodcast()
      afterChange()
      toast.success(t('podcasts.dashboard.episodes.deleted'), { id: toastId })
    } catch (error) {
      console.error('Failed to delete episode:', error)
      toast.error(t('podcasts.dashboard.episodes.delete_error'), { id: toastId })
    }
  }

  if (isLoading || !podcast) {
    return (
      <EditorPage>
        <EditorSkeleton sections={1} rows={4} />
      </EditorPage>
    )
  }

  const publishedCount = episodes.filter((ep) => ep.published).length
  const totalSeconds = episodes.reduce((sum, ep) => sum + (ep.duration_seconds || 0), 0)

  return (
    <EditorPage>
      <SectionCard
        icon={<ListNumbers size={16} />}
        title={t('podcasts.episodes')}
        description={
          episodes.length
            ? t('podcasts.dashboard.episodes.summary', {
                count: episodes.length,
                published: publishedCount,
                duration: totalSeconds ? formatDuration(totalSeconds) : '—',
              })
            : t('podcasts.dashboard.episodes.section_description')
        }
        actions={
          episodes.length > 0 && (
            <Button variant="primary" icon={<Plus size={14} weight="bold" />} onClick={() => setModal('new')}>
              {t('podcasts.dashboard.episodes.new_episode')}
            </Button>
          )
        }
        bodyClassName="pt-4 pb-2"
      >
        {episodes.length === 0 ? (
          <EmptyState
            icon={<MusicNotes size={22} />}
            title={t('podcasts.no_episodes')}
            description={t('podcasts.dashboard.episodes.no_episodes_description')}
            action={
              <Button variant="primary" icon={<Plus size={14} weight="bold" />} onClick={() => setModal('new')} className="mt-1">
                {t('podcasts.dashboard.episodes.create_first')}
              </Button>
            }
          />
        ) : (
          <>
            <p className="px-5 pb-2 text-xs text-neutral-400">{t('podcasts.dashboard.episodes.reorder_hint')}</p>
            <DragDropContext onDragEnd={onDragEnd}>
              <Droppable droppableId="podcast-episodes">
                {(drop) => (
                  <ul ref={drop.innerRef} {...drop.droppableProps} className="divide-y divide-neutral-100 border-t border-neutral-100">
                    {episodes.map((episode, index) => (
                      <Draggable key={episode.episode_uuid} draggableId={episode.episode_uuid} index={index}>
                        {(drag, snapshot) => (
                          <li
                            ref={drag.innerRef}
                            {...drag.draggableProps}
                            className={`bg-white ${snapshot.isDragging ? 'rounded-xl shadow-lg ring-1 ring-black/5' : ''}`}
                          >
                            <EpisodeRow
                              episode={episode}
                              index={index}
                              total={episodes.length}
                              dragHandleProps={drag.dragHandleProps}
                              isPlaying={playingId === episode.episode_uuid}
                              onPlayPause={() => handlePlayPause(episode)}
                              onEdit={() => setModal(episode)}
                              onDelete={() => setToDelete(episode)}
                              onTogglePublished={() => togglePublished(episode)}
                              onMove={(delta) => move(index, delta)}
                              orgUuid={org?.org_uuid}
                              podcastUuid={podcastuuid}
                            />
                          </li>
                        )}
                      </Draggable>
                    ))}
                    {drop.placeholder}
                  </ul>
                )}
              </Droppable>
            </DragDropContext>
          </>
        )}
      </SectionCard>

      <EpisodeModal
        key={modalSeq}
        open={modal !== null}
        episode={modal && modal !== 'new' ? modal : null}
        onClose={() => setModal(null)}
        podcastuuid={podcastuuid}
        orgUuid={org?.org_uuid}
        accessToken={accessToken}
        currentEpisodeCount={episodes.length}
        onSaved={async () => {
          await refreshPodcast()
          afterChange()
        }}
      />

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={t('podcasts.dashboard.episodes.delete_title')}
        message={t('podcasts.dashboard.episodes.delete_confirm')}
        confirmLabel={t('podcasts.dashboard.episodes.delete')}
        onConfirm={() => (toDelete ? remove(toDelete) : undefined)}
      />
    </EditorPage>
  )
}

function EpisodeRow({
  episode,
  index,
  total,
  dragHandleProps,
  isPlaying,
  onPlayPause,
  onEdit,
  onDelete,
  onTogglePublished,
  onMove,
  orgUuid,
  podcastUuid,
}: {
  episode: PodcastEpisode
  index: number
  total: number
  dragHandleProps: any
  isPlaying: boolean
  onPlayPause: () => void
  onEdit: () => void
  onDelete: () => void
  onTogglePublished: () => void
  onMove: (delta: number) => void
  orgUuid: string
  podcastUuid: string
}) {
  const { t } = useTranslation()
  // Remembers which file failed, so a newly uploaded cover gets a fresh try.
  const [failedThumb, setFailedThumb] = useState<string | null>(null)
  const thumbnailUrl =
    episode.thumbnail_image && failedThumb !== episode.thumbnail_image
      ? getEpisodeThumbnailMediaDirectory(orgUuid, podcastUuid, episode.episode_uuid, episode.thumbnail_image)
      : null

  return (
    <div className="group flex items-center gap-3 px-3 sm:px-5 py-3 hover:bg-neutral-50/70 transition-colors">
      <span
        {...dragHandleProps}
        aria-label={t('podcasts.dashboard.episodes.drag_to_reorder')}
        className="shrink-0 -ms-1 p-1 rounded-md text-neutral-300 hover:text-neutral-600 cursor-grab active:cursor-grabbing"
      >
        <DotsSixVertical size={16} weight="bold" />
      </span>
      <span className="hidden sm:block w-6 shrink-0 text-xs font-semibold text-neutral-400 tabular-nums text-center">{index + 1}</span>

      <div className="relative w-11 h-11 shrink-0 rounded-lg overflow-hidden bg-neutral-100 ring-1 ring-black/5">
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt="" onError={() => setFailedThumb(episode.thumbnail_image)} className="w-full h-full object-cover" />
        ) : (
          <span className="w-full h-full flex items-center justify-center text-neutral-400">
            <MusicNotes size={18} />
          </span>
        )}
        {episode.audio_file && (
          <button
            type="button"
            onClick={onPlayPause}
            aria-label={isPlaying ? t('podcasts.dashboard.episodes.pause') : t('podcasts.dashboard.episodes.play')}
            className={`absolute inset-0 flex items-center justify-center bg-neutral-900/50 text-white transition-opacity ${
              isPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
            }`}
          >
            {isPlaying ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" />}
          </button>
        )}
      </div>

      <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-start">
        <span className="block text-sm font-semibold text-neutral-900 truncate" dir="auto">
          {episode.title}
        </span>
        <span className="flex items-center gap-2 mt-0.5 text-xs text-neutral-500 min-w-0">
          {episode.duration_seconds > 0 && <span className="tabular-nums shrink-0">{formatDuration(episode.duration_seconds)}</span>}
          {episode.description && (
            <span className="truncate" dir="auto">
              {episode.description}
            </span>
          )}
        </span>
      </button>

      <div className="hidden sm:flex items-center gap-1.5 shrink-0">
        {!episode.audio_file && (
          <Chip tone="amber" icon={<Warning size={12} />}>
            {t('podcasts.dashboard.episodes.no_audio')}
          </Chip>
        )}
        {episode.published ? (
          <Chip tone="emerald" icon={<CheckCircle size={12} />}>{t('podcasts.published')}</Chip>
        ) : (
          <Chip tone="neutral" icon={<EyeSlash size={12} />}>{t('podcasts.dashboard.list.draft')}</Chip>
        )}
      </div>

      <div className="flex items-center gap-0.5 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          onClick={onEdit}
          aria-label={t('podcasts.dashboard.episodes.edit')}
          title={t('podcasts.dashboard.episodes.edit')}
        >
          <PencilSimpleLine size={15} />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t('podcasts.dashboard.episodes.actions')}
              className="h-7 w-7 inline-flex items-center justify-center rounded-md text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 data-[state=open]:bg-neutral-100 data-[state=open]:text-neutral-900 transition-colors"
            >
              <DotsThree size={16} weight="bold" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52 rounded-xl p-1.5">
            <DropdownMenuItem onSelect={onEdit} className={ITEM}>
              <PencilSimpleLine size={15} /> {t('podcasts.dashboard.episodes.edit')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onTogglePublished} className={ITEM}>
              {episode.published ? <EyeSlash size={15} /> : <Eye size={15} />}
              {episode.published ? t('podcasts.dashboard.episodes.unpublish') : t('podcasts.dashboard.episodes.publish')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onMove(-1)} disabled={index === 0} className={ITEM}>
              <ArrowUp size={15} /> {t('podcasts.dashboard.episodes.move_up')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onMove(1)} disabled={index === total - 1} className={ITEM}>
              <ArrowDown size={15} /> {t('podcasts.dashboard.episodes.move_down')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onDelete} className={`${ITEM} text-rose-600 focus:text-rose-700 focus:bg-rose-50`}>
              <Trash size={15} /> {t('podcasts.dashboard.episodes.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

// Reads the length of a picked audio file in the browser, so the episode
// list can show durations without the API decoding anything.
function readAudioDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const audio = document.createElement('audio')
    const done = (value: number) => {
      URL.revokeObjectURL(url)
      resolve(value)
    }
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => done(isFinite(audio.duration) ? Math.round(audio.duration) : 0)
    audio.onerror = () => done(0)
    audio.src = url
  })
}

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`

function FileDrop({
  accept,
  file,
  onFile,
  icon,
  label,
  hint,
  current,
}: {
  accept: string
  file: File | null
  onFile: (file: File | null) => void
  icon: React.ReactNode
  label: string
  hint: string
  current?: React.ReactNode
}) {
  const { t } = useTranslation()
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const kind = accept.split('/')[0]

  const pick = (f?: File | null) => {
    if (!f) return
    if (kind && !f.type.startsWith(kind)) {
      toast.error(t('podcasts.dashboard.episodes.wrong_file_type'))
      return
    }
    onFile(f)
  }

  if (file) {
    return (
      <div className="flex items-center gap-3 rounded-xl bg-neutral-50 ring-1 ring-inset ring-neutral-200 px-3 py-2.5">
        <span className="w-8 h-8 rounded-lg bg-white nice-shadow flex items-center justify-center text-neutral-600 shrink-0">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-neutral-800 truncate">{file.name}</p>
          <p className="text-xs text-neutral-500">{formatSize(file.size)}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            onFile(null)
            if (input.current) input.current.value = ''
          }}
          aria-label={t('podcasts.dashboard.episodes.remove_file')}
        >
          <X size={14} />
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {current}
      <input ref={input} type="file" accept={accept} className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          pick(e.dataTransfer.files?.[0])
        }}
        className={`w-full flex items-center gap-3 rounded-xl border-2 border-dashed px-4 py-3 text-start transition-colors ${
          over ? 'border-sky-400 bg-sky-50' : 'border-neutral-200 bg-neutral-50/50 hover:border-neutral-300 hover:bg-neutral-50'
        }`}
      >
        <span className="w-8 h-8 rounded-lg bg-white nice-shadow flex items-center justify-center text-neutral-500 shrink-0">
          <UploadSimple size={15} />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-neutral-700">{label}</span>
          <span className="block text-xs text-neutral-500">{hint}</span>
        </span>
      </button>
    </div>
  )
}

const FORM_ID = 'podcast-episode-form'

// One modal for both creating and editing an episode.
function EpisodeModal({
  open,
  episode,
  onClose,
  podcastuuid,
  orgUuid,
  accessToken,
  currentEpisodeCount,
  onSaved,
}: {
  open: boolean
  episode: PodcastEpisode | null
  onClose: () => void
  podcastuuid: string
  orgUuid: string
  accessToken: string
  currentEpisodeCount: number
  onSaved: () => Promise<void>
}) {
  const { t } = useTranslation()
  const { track } = useLHAnalytics('dashboard')
  const isEdit = !!episode
  // The parent remounts this per opening (see `modalSeq`), so the form
  // seeds straight from the episode.
  const [title, setTitle] = useState(episode?.title ?? '')
  const [description, setDescription] = useState(episode?.description ?? '')
  const [published, setPublished] = useState(episode?.published ?? false)
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const close = () => {
    if (!submitting) onClose()
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    setSubmitting(true)
    const toastId = toast.loading(isEdit ? t('podcasts.dashboard.episodes.updating') : t('podcasts.dashboard.episodes.creating'))
    try {
      const duration = audioFile ? await readAudioDuration(audioFile) : 0
      if (episode) {
        await updateEpisode(
          episode.episode_uuid,
          { title: title.trim(), description, published, ...(duration ? { duration_seconds: duration } : {}) },
          accessToken
        )
        if (audioFile) {
          const formData = new FormData()
          formData.append('audio', audioFile)
          const res = await uploadEpisodeAudio(episode.episode_uuid, formData, accessToken)
          if (!res?.success) throw new Error(getErrorMessage(res?.data?.detail, t('podcasts.dashboard.episodes.update_error')))
        }
        if (coverFile) {
          const formData = new FormData()
          formData.append('thumbnail', coverFile)
          await uploadEpisodeThumbnail(episode.episode_uuid, formData, accessToken)
        }
        toast.success(t('podcasts.dashboard.episodes.updated'), { id: toastId })
      } else {
        const res = await createEpisode(
          podcastuuid,
          { title: title.trim(), description, published, duration_seconds: duration },
          audioFile,
          coverFile,
          accessToken
        )
        if (!res.success) {
          throw new Error(getErrorMessage(res.data?.detail, t('podcasts.dashboard.episodes.create_error')))
        }
        track(AnalyticsEvent.EpisodeCreated, {
          has_audio_file: !!audioFile,
          resulting_episode_count: currentEpisodeCount + 1,
        })
        toast.success(t('podcasts.dashboard.episodes.created'), { id: toastId })
      }
      await onSaved()
      onClose()
    } catch (error: any) {
      console.error('Failed to save episode:', error)
      toast.error(
        error?.message || (isEdit ? t('podcasts.dashboard.episodes.update_error') : t('podcasts.dashboard.episodes.create_error')),
        { id: toastId }
      )
    } finally {
      setSubmitting(false)
    }
  }

  const currentAudio = episode?.audio_file
    ? getEpisodeAudioMediaDirectory(orgUuid, podcastuuid, episode.episode_uuid, episode.audio_file)
    : null
  const currentCover = episode?.thumbnail_image
    ? getEpisodeThumbnailMediaDirectory(orgUuid, podcastuuid, episode.episode_uuid, episode.thumbnail_image)
    : null

  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={(next) => !next && close()}
      preventClose={submitting}
      size="md"
      icon={isEdit ? <PencilSimpleLine size={16} /> : <MusicNotes size={16} />}
      dialogTitle={isEdit ? t('podcasts.dashboard.episodes.edit_episode') : t('podcasts.dashboard.episodes.new_episode')}
      dialogDescription={
        isEdit ? t('podcasts.dashboard.episodes.edit_episode_description') : t('podcasts.dashboard.episodes.new_episode_description')
      }
      footer={
        <>
          <Button onClick={close} disabled={submitting}>
            {t('podcasts.modals.create.cancel')}
          </Button>
          <Button type="submit" form={FORM_ID} variant="primary" loading={submitting} disabled={!title.trim()}>
            {isEdit ? t('podcasts.dashboard.episodes.save') : t('podcasts.dashboard.episodes.create')}
          </Button>
        </>
      }
      dialogContent={
        <form id={FORM_ID} onSubmit={submit} className="space-y-5">
          <div>
            <FieldLabel>{t('podcasts.dashboard.episodes.title_label')}</FieldLabel>
            <input
              value={title}
              autoFocus
              onChange={(e) => setTitle(e.target.value)}
              aria-label={t('podcasts.dashboard.episodes.title_label')}
              placeholder={t('podcasts.dashboard.episodes.title_placeholder')}
              className={INPUT}
              dir="auto"
              required
            />
          </div>

          <div>
            <FieldLabel>{t('podcasts.dashboard.episodes.description_label')}</FieldLabel>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              aria-label={t('podcasts.dashboard.episodes.description_label')}
              placeholder={t('podcasts.dashboard.episodes.description_placeholder')}
              rows={3}
              className={TEXTAREA}
              dir="auto"
            />
          </div>

          <div>
            <FieldLabel hint={t('podcasts.dashboard.episodes.audio_hint')}>{t('podcasts.dashboard.episodes.audio_label')}</FieldLabel>
            <FileDrop
              accept="audio/*"
              file={audioFile}
              onFile={setAudioFile}
              icon={<MusicNotes size={15} />}
              label={currentAudio ? t('podcasts.dashboard.episodes.replace_audio') : t('podcasts.dashboard.episodes.upload_audio')}
              hint={t('podcasts.dashboard.episodes.drop_hint')}
              current={
                currentAudio ? (
                  <div className="flex items-center gap-3 rounded-xl bg-neutral-50 ring-1 ring-inset ring-neutral-200 px-3 py-2">
                    <audio controls preload="none" src={currentAudio} className="h-8 flex-1 min-w-0" />
                    {episode && episode.duration_seconds > 0 && (
                      <span className="text-xs text-neutral-500 tabular-nums shrink-0">{formatDuration(episode.duration_seconds)}</span>
                    )}
                  </div>
                ) : null
              }
            />
          </div>

          <div>
            <FieldLabel hint={t('podcasts.dashboard.episodes.cover_hint')}>{t('podcasts.dashboard.episodes.cover_label')}</FieldLabel>
            <div className="flex items-start gap-3">
              {currentCover && !coverFile && (
                <img src={currentCover} alt="" className="w-[58px] h-[58px] rounded-lg object-cover ring-1 ring-black/5 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <FileDrop
                  accept="image/*"
                  file={coverFile}
                  onFile={setCoverFile}
                  icon={<ImageSquare size={15} />}
                  label={currentCover ? t('podcasts.dashboard.episodes.replace_cover') : t('podcasts.dashboard.episodes.upload_cover')}
                  hint={t('podcasts.dashboard.episodes.cover_drop_hint')}
                />
              </div>
            </div>
          </div>

          <label className="flex items-start justify-between gap-4 rounded-xl ring-1 ring-inset ring-neutral-200 px-4 py-3 cursor-pointer">
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-neutral-900">
                {isEdit ? t('podcasts.published') : t('podcasts.dashboard.episodes.publish_now')}
              </span>
              <span className="block text-xs text-neutral-500 mt-0.5">{t('podcasts.dashboard.episodes.publish_hint')}</span>
            </span>
            <Switch checked={published} onCheckedChange={setPublished} aria-label={t('podcasts.published')} className="mt-0.5 shrink-0" />
          </label>
        </form>
      }
    />
  )
}

export default EditPodcastEpisodes
