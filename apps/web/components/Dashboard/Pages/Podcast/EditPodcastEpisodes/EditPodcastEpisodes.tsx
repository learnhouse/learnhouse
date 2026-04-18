'use client'
import React, { useState } from 'react'
import { mutate } from 'swr'
import { usePodcast } from '@components/Contexts/PodcastContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import {
  createEpisode,
  deleteEpisode,
  updateEpisode,
  uploadEpisodeAudio,
  PodcastEpisode,
  formatDuration,
} from '@services/podcasts/episodes'
import { getEpisodeAudioMediaDirectory, getEpisodeThumbnailMediaDirectory } from '@services/media/media'
import { revalidateTags } from '@services/utils/ts/requests'
import { useTranslation } from 'react-i18next'
import {
  Loader2,
  Plus,
  Trash2,
  Play,
  Pause,
  Upload,
  GripVertical,
  MoreVertical,
  Pencil,
  Music,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'

interface EditPodcastEpisodesProps {
  orgslug: string
  podcastuuid: string
}

function EditPodcastEpisodes({ orgslug, podcastuuid }: EditPodcastEpisodesProps) {
  const { t } = useTranslation()
  const { podcast, episodes, refreshPodcast, isLoading } = usePodcast()
  const session = useLHSession() as any
  const org = useOrg() as any
  const accessToken = session?.data?.tokens?.access_token

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [editingEpisode, setEditingEpisode] = useState<PodcastEpisode | null>(null)
  const [playingEpisodeId, setPlayingEpisodeId] = useState<string | null>(null)
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null)

  const handlePlayPause = (episode: PodcastEpisode) => {
    if (!episode.audio_file) return

    const audioUrl = getEpisodeAudioMediaDirectory(
      org?.org_uuid,
      podcastuuid,
      episode.episode_uuid,
      episode.audio_file
    )

    if (playingEpisodeId === episode.episode_uuid) {
      audioElement?.pause()
      setPlayingEpisodeId(null)
      setAudioElement(null)
    } else {
      audioElement?.pause()
      const audio = new Audio(audioUrl)
      audio.play()
      audio.onended = () => {
        setPlayingEpisodeId(null)
        setAudioElement(null)
      }
      setAudioElement(audio)
      setPlayingEpisodeId(episode.episode_uuid)
    }
  }

  const handleDeleteEpisode = async (episode: PodcastEpisode) => {
    const toastId = toast.loading(t('podcasts.dashboard.episodes.deleting'))
    try {
      await deleteEpisode(episode.episode_uuid, accessToken)
      await revalidateTags(['podcasts'], orgslug)
      await refreshPodcast()
      // Revalidate all podcast-related SWR caches
      mutate((key) => typeof key === 'string' && key.includes('/podcasts/'), undefined, { revalidate: true })
      toast.success(t('podcasts.dashboard.episodes.deleted'), { id: toastId })
    } catch (error) {
      console.error('Failed to delete episode:', error)
      toast.error(t('podcasts.dashboard.episodes.delete_error'), { id: toastId })
    }
  }

  const handleTogglePublished = async (episode: PodcastEpisode) => {
    const toastId = toast.loading(t('podcasts.dashboard.episodes.updating'))
    try {
      await updateEpisode(episode.episode_uuid, { published: !episode.published }, accessToken)
      await revalidateTags(['podcasts'], orgslug)
      await refreshPodcast()
      // Revalidate all podcast-related SWR caches
      mutate((key) => typeof key === 'string' && key.includes('/podcasts/'), undefined, { revalidate: true })
      toast.success(t('podcasts.dashboard.episodes.updated'), { id: toastId })
    } catch (error) {
      console.error('Failed to update episode:', error)
      toast.error(t('podcasts.dashboard.episodes.update_error'), { id: toastId })
    }
  }

  if (isLoading || !podcast) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    )
  }

  const sortedEpisodes = [...episodes].sort((a, b) => a.order - b.order)

  return (
    <div className="h-full">
      <div className="h-6" />
      <div className="px-10 pb-10">
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                {t('podcasts.episodes')}
              </h2>
              <p className="text-sm text-gray-500">
                {episodes.length} {episodes.length === 1 ? 'episode' : 'episodes'}
              </p>
            </div>
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-black hover:bg-black/90 rounded-lg transition-colors"
            >
              <Plus size={16} className="me-2" />
              {t('podcasts.dashboard.episodes.new_episode')}
            </button>
          </div>

          {sortedEpisodes.length === 0 ? (
            <div className="text-center py-12 bg-gray-50 rounded-lg">
              <Music size={48} className="mx-auto text-gray-300 mb-4" />
              <h3 className="text-lg font-medium text-gray-600 mb-2">
                {t('podcasts.no_episodes')}
              </h3>
              <p className="text-sm text-gray-400 mb-4">
                {t('podcasts.dashboard.episodes.no_episodes_description')}
              </p>
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-black hover:bg-black/90 rounded-lg transition-colors"
              >
                <Plus size={16} className="me-2" />
                {t('podcasts.dashboard.episodes.create_first')}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {sortedEpisodes.map((episode, index) => (
                <EpisodeRow
                  key={episode.episode_uuid}
                  episode={episode}
                  index={index}
                  isPlaying={playingEpisodeId === episode.episode_uuid}
                  onPlayPause={() => handlePlayPause(episode)}
                  onEdit={() => setEditingEpisode(episode)}
                  onDelete={() => handleDeleteEpisode(episode)}
                  onTogglePublished={() => handleTogglePublished(episode)}
                  orgUuid={org?.org_uuid}
                  podcastUuid={podcastuuid}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <CreateEpisodeModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        podcastuuid={podcastuuid}
        orgslug={orgslug}
        accessToken={accessToken}
        onSuccess={refreshPodcast}
      />

      {editingEpisode && (
        <EditEpisodeModal
          isOpen={!!editingEpisode}
          onClose={() => setEditingEpisode(null)}
          episode={editingEpisode}
          orgslug={orgslug}
          accessToken={accessToken}
          onSuccess={refreshPodcast}
          orgUuid={org?.org_uuid}
          podcastUuid={podcastuuid}
        />
      )}
    </div>
  )
}

function EpisodeRow({
  episode,
  index,
  isPlaying,
  onPlayPause,
  onEdit,
  onDelete,
  onTogglePublished,
  orgUuid,
  podcastUuid,
}: {
  episode: PodcastEpisode
  index: number
  isPlaying: boolean
  onPlayPause: () => void
  onEdit: () => void
  onDelete: () => void
  onTogglePublished: () => void
  orgUuid: string
  podcastUuid: string
}) {
  const { t } = useTranslation()

  const thumbnailUrl = episode.thumbnail_image
    ? getEpisodeThumbnailMediaDirectory(orgUuid, podcastUuid, episode.episode_uuid, episode.thumbnail_image)
    : null

  return (
    <div className="flex items-center p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors group">
      <div className="flex items-center space-x-4 flex-1 min-w-0">
        <div className="text-gray-400 cursor-grab">
          <GripVertical size={20} />
        </div>

        <div className="flex-shrink-0 w-12 h-12 bg-gray-200 rounded-lg overflow-hidden relative">
          {thumbnailUrl ? (
            <img src={thumbnailUrl} alt={episode.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400">
              <Music size={20} />
            </div>
          )}
          {episode.audio_file && (
            <button
              onClick={onPlayPause}
              className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              {isPlaying ? (
                <Pause size={20} className="text-white" />
              ) : (
                <Play size={20} className="text-white" />
              )}
            </button>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-2">
            <span className="text-xs font-medium text-gray-400">#{index + 1}</span>
            <h3 className="text-sm font-medium text-gray-900 truncate">{episode.title}</h3>
            {episode.published ? (
              <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide bg-green-100 text-green-700 rounded">
                {t('podcasts.published')}
              </span>
            ) : (
              <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide bg-yellow-100 text-yellow-700 rounded">
                {t('podcasts.unpublished')}
              </span>
            )}
          </div>
          {episode.description && (
            <p className="text-xs text-gray-500 truncate mt-0.5">{episode.description}</p>
          )}
          <div className="flex items-center space-x-3 mt-1 text-xs text-gray-400">
            {episode.duration_seconds > 0 && (
              <span>{formatDuration(episode.duration_seconds)}</span>
            )}
            {!episode.audio_file && (
              <span className="text-orange-500">{t('podcasts.dashboard.episodes.no_audio')}</span>
            )}
          </div>
        </div>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-white transition-colors">
            <MoreVertical size={18} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onEdit} className="cursor-pointer">
            <Pencil size={14} className="me-2" />
            {t('podcasts.dashboard.episodes.edit')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onTogglePublished} className="cursor-pointer">
            {episode.published ? t('podcasts.dashboard.episodes.unpublish') : t('podcasts.dashboard.episodes.publish')}
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <ConfirmationModal
              confirmationButtonText={t('podcasts.dashboard.episodes.delete')}
              confirmationMessage={t('podcasts.dashboard.episodes.delete_confirm')}
              dialogTitle={t('podcasts.dashboard.episodes.delete_title')}
              dialogTrigger={
                <button className="w-full text-start flex items-center px-2 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-sm">
                  <Trash2 size={14} className="me-2" />
                  {t('podcasts.dashboard.episodes.delete')}
                </button>
              }
              functionToExecute={onDelete}
              status="warning"
            />
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function CreateEpisodeModal({
  isOpen,
  onClose,
  podcastuuid,
  orgslug,
  accessToken,
  onSuccess,
}: {
  isOpen: boolean
  onClose: () => void
  podcastuuid: string
  orgslug: string
  accessToken: string
  onSuccess: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [audioFile, setAudioFile] = useState<File | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return

    console.log('Creating episode:', { podcastuuid, title, description, accessToken: !!accessToken })

    setIsSubmitting(true)
    const toastId = toast.loading(t('podcasts.dashboard.episodes.creating'))
    try {
      const res = await createEpisode(
        podcastuuid,
        { title, description, published: false },
        audioFile,
        null,
        accessToken
      )

      console.log('Create episode response:', res)

      if (!res.success) {
        const errorMessage = typeof res.data?.detail === 'string'
          ? res.data.detail
          : Array.isArray(res.data?.detail)
            ? res.data.detail.map((e: any) => e.msg).join(', ')
            : t('podcasts.dashboard.episodes.create_error')
        console.error('Create episode failed:', res.data)
        throw new Error(errorMessage)
      }

      await revalidateTags(['podcasts'], orgslug)
      await onSuccess()
      // Revalidate all podcast-related SWR caches
      mutate((key) => typeof key === 'string' && key.includes('/podcasts/'), undefined, { revalidate: true })
      toast.success(t('podcasts.dashboard.episodes.created'), { id: toastId })
      handleClose()
    } catch (error: any) {
      console.error('Failed to create episode:', error)
      toast.error(error.message || t('podcasts.dashboard.episodes.create_error'), { id: toastId })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleClose = () => {
    setTitle('')
    setDescription('')
    setAudioFile(null)
    onClose()
  }

  return (
    <Modal
      isDialogOpen={isOpen}
      onOpenChange={(open) => !open && handleClose()}
      dialogTitle={t('podcasts.dashboard.episodes.new_episode')}
      dialogDescription={t('podcasts.dashboard.episodes.new_episode_description')}
      minWidth="md"
      dialogContent={
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('podcasts.dashboard.episodes.title_label')} *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('podcasts.dashboard.episodes.title_placeholder')}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-black/20 focus:border-transparent outline-none transition-all"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('podcasts.dashboard.episodes.description_label')}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('podcasts.dashboard.episodes.description_placeholder')}
              rows={3}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-black/20 focus:border-transparent outline-none transition-all resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('podcasts.dashboard.episodes.audio_label')}
            </label>
            <input
              type="file"
              accept="audio/*"
              onChange={(e) => setAudioFile(e.target.files?.[0] || null)}
              className="hidden"
              id="audio-upload"
            />
            <label
              htmlFor="audio-upload"
              className="flex items-center justify-center px-4 py-3 border-2 border-dashed border-gray-200 rounded-lg hover:border-gray-300 cursor-pointer transition-colors"
            >
              {audioFile ? (
                <span className="text-sm text-gray-700">{audioFile.name}</span>
              ) : (
                <span className="text-sm text-gray-500 flex items-center">
                  <Upload size={16} className="me-2" />
                  {t('podcasts.dashboard.episodes.upload_audio')}
                </span>
              )}
            </label>
            <p className="mt-1 text-xs text-gray-500">
              {t('podcasts.dashboard.episodes.audio_hint')}
            </p>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              {t('podcasts.modals.create.cancel')}
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !title.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-black hover:bg-black/90 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isSubmitting && <Loader2 size={16} className="animate-spin" />}
              {t('podcasts.dashboard.episodes.create')}
            </button>
          </div>
        </form>
      }
    />
  )
}

function EditEpisodeModal({
  isOpen,
  onClose,
  episode,
  orgslug,
  accessToken,
  onSuccess,
  orgUuid,
  podcastUuid,
}: {
  isOpen: boolean
  onClose: () => void
  episode: PodcastEpisode
  orgslug: string
  accessToken: string
  onSuccess: () => Promise<void>
  orgUuid: string
  podcastUuid: string
}) {
  const { t } = useTranslation()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [title, setTitle] = useState(episode.title)
  const [description, setDescription] = useState(episode.description || '')
  const [audioFile, setAudioFile] = useState<File | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return

    setIsSubmitting(true)
    const toastId = toast.loading(t('podcasts.dashboard.episodes.updating'))
    try {
      await updateEpisode(episode.episode_uuid, { title, description }, accessToken)

      if (audioFile) {
        const formData = new FormData()
        formData.append('audio', audioFile)
        await uploadEpisodeAudio(episode.episode_uuid, formData, accessToken)
      }

      await revalidateTags(['podcasts'], orgslug)
      await onSuccess()
      toast.success(t('podcasts.dashboard.episodes.updated'), { id: toastId })
      onClose()
    } catch (error) {
      console.error('Failed to update episode:', error)
      toast.error(t('podcasts.dashboard.episodes.update_error'), { id: toastId })
    } finally {
      setIsSubmitting(false)
    }
  }

  const currentAudioUrl = episode.audio_file
    ? getEpisodeAudioMediaDirectory(orgUuid, podcastUuid, episode.episode_uuid, episode.audio_file)
    : null

  return (
    <Modal
      isDialogOpen={isOpen}
      onOpenChange={(open) => !open && onClose()}
      dialogTitle={t('podcasts.dashboard.episodes.edit_episode')}
      dialogDescription={t('podcasts.dashboard.episodes.edit_episode_description')}
      minWidth="md"
      dialogContent={
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('podcasts.dashboard.episodes.title_label')} *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('podcasts.dashboard.episodes.title_placeholder')}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-black/20 focus:border-transparent outline-none transition-all"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('podcasts.dashboard.episodes.description_label')}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('podcasts.dashboard.episodes.description_placeholder')}
              rows={3}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-black/20 focus:border-transparent outline-none transition-all resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('podcasts.dashboard.episodes.audio_label')}
            </label>
            {currentAudioUrl && !audioFile && (
              <div className="mb-2 p-3 bg-gray-50 rounded-lg flex items-center justify-between">
                <span className="text-sm text-gray-600 flex items-center">
                  <Music size={16} className="me-2" />
                  {episode.audio_file}
                </span>
                <span className="text-xs text-gray-400">
                  {formatDuration(episode.duration_seconds)}
                </span>
              </div>
            )}
            <input
              type="file"
              accept="audio/*"
              onChange={(e) => setAudioFile(e.target.files?.[0] || null)}
              className="hidden"
              id="audio-upload-edit"
            />
            <label
              htmlFor="audio-upload-edit"
              className="flex items-center justify-center px-4 py-3 border-2 border-dashed border-gray-200 rounded-lg hover:border-gray-300 cursor-pointer transition-colors"
            >
              {audioFile ? (
                <span className="text-sm text-gray-700">{audioFile.name}</span>
              ) : (
                <span className="text-sm text-gray-500 flex items-center">
                  <Upload size={16} className="me-2" />
                  {currentAudioUrl
                    ? t('podcasts.dashboard.episodes.replace_audio')
                    : t('podcasts.dashboard.episodes.upload_audio')}
                </span>
              )}
            </label>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              {t('podcasts.modals.create.cancel')}
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !title.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-black hover:bg-black/90 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isSubmitting && <Loader2 size={16} className="animate-spin" />}
              {t('podcasts.dashboard.episodes.save')}
            </button>
          </div>
        </form>
      }
    />
  )
}

export default EditPodcastEpisodes
