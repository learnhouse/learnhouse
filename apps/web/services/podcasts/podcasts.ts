import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyFormWithAuthHeader,
  RequestBodyWithAuthHeader,
  errorHandling,
  getResponseMetadata,
} from '@services/utils/ts/requests'

export interface PodcastAuthor {
  user: {
    id: string
    user_uuid: string
    avatar_image: string
    first_name: string
    last_name: string
    username: string
  }
  authorship: 'CREATOR' | 'CONTRIBUTOR' | 'MAINTAINER' | 'REPORTER'
  authorship_status: 'ACTIVE' | 'INACTIVE' | 'PENDING'
  creation_date: string
  update_date: string
}

export interface Podcast {
  id: number
  org_id: number
  podcast_uuid: string
  name: string
  description: string
  about: string
  tags: string
  thumbnail_image: string
  public: boolean
  published: boolean
  creation_date: string
  update_date: string
  authors: PodcastAuthor[]
  seo?: Record<string, unknown>
}

export interface PodcastWithEpisodeCount extends Podcast {
  episode_count: number
}

export interface PodcastMeta {
  podcast: Podcast
  episodes: PodcastEpisode[]
}

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

export async function getOrgPodcasts(
  org_slug: string,
  next: any,
  access_token?: string,
  include_unpublished: boolean = false
) {
  const url = `${getAPIUrl()}podcasts/org_slug/${org_slug}/page/1/limit/100${include_unpublished ? '?include_unpublished=true' : ''}`
  const result: any = await fetch(
    url,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function getOrgPodcastsPaginated(
  org_slug: string,
  page: number,
  limit: number,
  next: any,
  access_token?: string,
  include_unpublished: boolean = false
) {
  const url = `${getAPIUrl()}podcasts/org_slug/${org_slug}/page/${page}/limit/${limit}${include_unpublished ? '?include_unpublished=true' : ''}`
  const result: any = await fetch(
    url,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function getOrgPodcastsCount(
  org_slug: string,
  next: any,
  access_token?: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}podcasts/org_slug/${org_slug}/count`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function getPodcast(
  podcast_uuid: string,
  next: any,
  access_token?: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}podcasts/${podcast_uuid}`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function getPodcastMeta(
  podcast_uuid: string,
  next: any,
  access_token?: string
): Promise<PodcastMeta> {
  const result: any = await fetch(
    `${getAPIUrl()}podcasts/${podcast_uuid}/meta`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function createPodcast(
  org_id: string,
  podcast_body: {
    name: string
    description?: string
    about?: string
    tags?: string
    public: boolean
  },
  thumbnail: any,
  access_token: string
) {
  const formData = new FormData()
  formData.append('name', podcast_body.name || '')
  formData.append('description', podcast_body.description || '')
  formData.append('about', podcast_body.about || '')
  formData.append('tags', podcast_body.tags || '')
  formData.append('public', String(podcast_body.public))

  if (thumbnail) {
    formData.append('thumbnail', thumbnail)
  }

  const result = await fetch(
    `${getAPIUrl()}podcasts/?org_id=${org_id}`,
    RequestBodyFormWithAuthHeader('POST', formData, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function updatePodcast(
  podcast_uuid: string,
  data: any,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}podcasts/${podcast_uuid}`,
    RequestBodyWithAuthHeader('PUT', data, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function updatePodcastThumbnail(
  podcast_uuid: string,
  formData: FormData,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}podcasts/${podcast_uuid}/thumbnail`,
    RequestBodyFormWithAuthHeader('PUT', formData, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function deletePodcast(
  podcast_uuid: string,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}podcasts/${podcast_uuid}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function getPodcastRights(
  podcast_uuid: string,
  access_token?: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}podcasts/${podcast_uuid}/rights`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export const removePodcastPrefix = (podcast_uuid: string) =>
  podcast_uuid.replace('podcast_', '')
