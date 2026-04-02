import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyFormWithAuthHeader,
  RequestBodyWithAuthHeader,
  errorHandling,
  getResponseMetadata,
} from '@services/utils/ts/requests'

export interface PodcastEpisode {
  id: number
  podcast_id: number
  org_id: number
  episode_uuid: string
  title: string
  description: string
  audio_file: string
  duration_seconds: number
  episode_number: number
  thumbnail_image: string
  published: boolean
  order: number
  creation_date: string
  update_date: string
}

export async function getEpisodes(
  podcast_uuid: string,
  next: any,
  access_token?: string,
  include_unpublished: boolean = false
) {
  const url = `${getAPIUrl()}podcasts/${podcast_uuid}/episodes${include_unpublished ? '?include_unpublished=true' : ''}`
  const result: any = await fetch(
    url,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function getEpisode(
  episode_uuid: string,
  next: any,
  access_token?: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}podcasts/episodes/${episode_uuid}`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function createEpisode(
  podcast_uuid: string,
  episode_body: {
    title: string
    description?: string
    duration_seconds?: number
    published?: boolean
  },
  audio: any,
  thumbnail: any,
  access_token: string
) {
  const formData = new FormData()
  formData.append('title', episode_body.title || '')
  formData.append('description', episode_body.description || '')
  formData.append('duration_seconds', String(episode_body.duration_seconds || 0))
  formData.append('published', String(episode_body.published || false))

  if (audio) {
    formData.append('audio', audio)
  }

  if (thumbnail) {
    formData.append('thumbnail', thumbnail)
  }

  const url = `${getAPIUrl()}podcasts/${podcast_uuid}/episodes`

  const result = await fetch(
    url,
    RequestBodyFormWithAuthHeader('POST', formData, null, access_token)
  )

  const res = await getResponseMetadata(result)
  return res
}

export async function updateEpisode(
  episode_uuid: string,
  data: any,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}podcasts/episodes/${episode_uuid}`,
    RequestBodyWithAuthHeader('PUT', data, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function deleteEpisode(
  episode_uuid: string,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}podcasts/episodes/${episode_uuid}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function uploadEpisodeAudio(
  episode_uuid: string,
  formData: FormData,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}podcasts/episodes/${episode_uuid}/audio`,
    RequestBodyFormWithAuthHeader('PUT', formData, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function uploadEpisodeThumbnail(
  episode_uuid: string,
  formData: FormData,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}podcasts/episodes/${episode_uuid}/thumbnail`,
    RequestBodyFormWithAuthHeader('PUT', formData, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function reorderEpisodes(
  podcast_uuid: string,
  episode_orders: Array<{ episode_uuid: string; order: number }>,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}podcasts/${podcast_uuid}/episodes/reorder`,
    RequestBodyWithAuthHeader('PUT', episode_orders, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export const removeEpisodePrefix = (episode_uuid: string) =>
  episode_uuid.replace('episode_', '')

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = seconds % 60

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`
  }
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}
