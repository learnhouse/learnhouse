'use client'
import React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useOrg } from '@components/Contexts/OrgContext'
import { usePodcast } from '@components/Contexts/PodcastContext'
import { useCommunity } from '@components/Contexts/CommunityContext'
import { EditorPage } from '@components/Dashboard/Pages/Course/courseEditorUi'
import {
  getCommunityThumbnailMediaDirectory,
  getPathThumbnailMediaDirectory,
  getPodcastThumbnailMediaDirectory,
} from '@services/media/media'
import type { Path } from '@services/paths/paths'
import { queryKeys } from '@/lib/query/keys'
import { ResourceSeoEditor } from './ResourceSeoEditor'

/** Path editor → SEO tab. */
export function PathSeoTab({ path, orgslug }: { path: Path; orgslug: string }) {
  const org = useOrg() as any
  const queryClient = useQueryClient()
  return (
    <EditorPage width="wide">
      <ResourceSeoEditor
        type="path"
        uuid={path.path_uuid}
        orgslug={orgslug}
        body={path.about}
        isPublic={path.public && path.published}
        thumbnailUrl={path.thumbnail_image ? getPathThumbnailMediaDirectory(org?.org_uuid, path.path_uuid, path.thumbnail_image) : null}
        onSaved={() => queryClient.invalidateQueries({ queryKey: queryKeys.paths.detail(path.path_uuid) })}
      />
    </EditorPage>
  )
}

/** Podcast editor → SEO tab (inside PodcastProvider). */
export function PodcastSeoTab({ orgslug }: { orgslug: string }) {
  const org = useOrg() as any
  const { podcast } = usePodcast() as any
  if (!podcast) return null
  return (
    <EditorPage width="wide">
      <ResourceSeoEditor
        type="podcast"
        uuid={podcast.podcast_uuid}
        orgslug={orgslug}
        body={podcast.about}
        isPublic={podcast.public && podcast.published}
        thumbnailUrl={podcast.thumbnail_image ? getPodcastThumbnailMediaDirectory(org?.org_uuid, podcast.podcast_uuid, podcast.thumbnail_image) : null}
      />
    </EditorPage>
  )
}

/** Community editor → SEO tab (inside CommunityProvider). */
export function CommunitySeoTab({ orgslug }: { orgslug: string }) {
  const org = useOrg() as any
  const state = useCommunity() as any
  const community = state?.community
  if (!community) return null
  return (
    <ResourceSeoEditor
      type="community"
      uuid={community.community_uuid}
      orgslug={orgslug}
      isPublic={community.public}
      thumbnailUrl={
        community.thumbnail_image ? getCommunityThumbnailMediaDirectory(org?.org_uuid, community.community_uuid, community.thumbnail_image) : null
      }
    />
  )
}
