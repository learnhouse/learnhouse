import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyWithAuthHeader,
  errorHandling,
  getResponseMetadata,
} from '@services/utils/ts/requests'

// Discussion labels - must match backend
export const DISCUSSION_LABELS = [
  { id: 'general', name: 'General', color: '#6B7280', icon: 'MessageSquare' },
  { id: 'question', name: 'Q&A', color: '#EAB308', icon: 'HelpCircle' },
  { id: 'idea', name: 'Ideas', color: '#8B5CF6', icon: 'Lightbulb' },
  { id: 'announcement', name: 'Announcements', color: '#3B82F6', icon: 'Megaphone' },
  { id: 'showcase', name: 'Show and Tell', color: '#10B981', icon: 'Star' },
] as const

export type DiscussionLabelId = typeof DISCUSSION_LABELS[number]['id']

export interface DiscussionLabel {
  id: string
  name: string
  color: string
  icon: string
}

export interface Discussion {
  id: number
  community_id: number
  org_id: number
  author_id: number
  discussion_uuid: string
  title: string
  content: string | null
  label: string
  emoji: string | null
  upvote_count: number
  edit_count: number
  is_pinned: boolean
  is_locked: boolean
  creation_date: string
  update_date: string
}

export interface DiscussionAuthor {
  id: number
  user_uuid: string
  username: string
  first_name: string
  last_name: string
  email: string
  avatar_image: string | null
  bio: string | null
}

export interface DiscussionWithAuthor extends Discussion {
  author: DiscussionAuthor | null
  has_voted: boolean
}

export interface DiscussionCreate {
  title: string
  content?: string | null
  label?: string
  emoji?: string | null
}

export interface DiscussionUpdate {
  title?: string
  content?: string | null
  label?: string
  emoji?: string | null
}

export type DiscussionSortBy = 'recent' | 'upvotes' | 'hot'

export interface DiscussionVote {
  id: number
  discussion_id: number
  user_id: number
  vote_uuid: string
  creation_date: string
}

export function getLabelInfo(labelId: string): DiscussionLabel {
  return DISCUSSION_LABELS.find(l => l.id === labelId) || DISCUSSION_LABELS[0]
}

export async function getDiscussionLabels(): Promise<DiscussionLabel[]> {
  const result: any = await fetch(
    `${getAPIUrl()}discussions/labels`,
    RequestBodyWithAuthHeader('GET', null, null)
  )
  const res = await errorHandling(result)
  return res
}

export async function getDiscussions(
  community_uuid: string,
  sort_by: DiscussionSortBy = 'recent',
  page: number = 1,
  limit: number = 10,
  next: any,
  access_token?: string,
  label?: string
): Promise<DiscussionWithAuthor[]> {
  let url = `${getAPIUrl()}communities/${community_uuid}/discussions?sort_by=${sort_by}&page=${page}&limit=${limit}`
  if (label) {
    url += `&label=${label}`
  }
  const result: any = await fetch(
    url,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function getDiscussion(
  discussion_uuid: string,
  next: any,
  access_token?: string
): Promise<DiscussionWithAuthor> {
  const result: any = await fetch(
    `${getAPIUrl()}discussions/${discussion_uuid}`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function createDiscussion(
  community_uuid: string,
  data: DiscussionCreate,
  access_token: string
): Promise<DiscussionWithAuthor> {
  const result: any = await fetch(
    `${getAPIUrl()}communities/${community_uuid}/discussions`,
    RequestBodyWithAuthHeader('POST', data, null, access_token)
  )
  const res = await getResponseMetadata(result)
  if (!res.success) {
    const detail = res.data?.detail || res.data?.message || res.data
    let message: string
    if (typeof detail === 'string') {
      message = detail
    } else if (detail && typeof detail === 'object' && typeof detail.message === 'string') {
      message = detail.message
    } else {
      message = JSON.stringify(detail)
    }
    const error: any = new Error(message)
    error.status = res.status
    error.detail = detail
    throw error
  }
  return res.data
}

export async function updateDiscussion(
  discussion_uuid: string,
  data: DiscussionUpdate,
  access_token: string
): Promise<DiscussionWithAuthor> {
  const result: any = await fetch(
    `${getAPIUrl()}discussions/${discussion_uuid}`,
    RequestBodyWithAuthHeader('PUT', data, null, access_token)
  )
  const res = await getResponseMetadata(result)
  if (!res.success) {
    const detail = res.data?.detail || res.data?.message || res.data
    let message: string
    if (typeof detail === 'string') {
      message = detail
    } else if (detail && typeof detail === 'object' && typeof detail.message === 'string') {
      message = detail.message
    } else {
      message = JSON.stringify(detail)
    }
    const error: any = new Error(message)
    error.status = res.status
    error.detail = detail
    throw error
  }
  return res.data
}

export async function pinDiscussion(
  discussion_uuid: string,
  is_pinned: boolean,
  access_token: string
): Promise<DiscussionWithAuthor> {
  const result: any = await fetch(
    `${getAPIUrl()}discussions/${discussion_uuid}/pin`,
    RequestBodyWithAuthHeader('PUT', { is_pinned }, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function lockDiscussion(
  discussion_uuid: string,
  is_locked: boolean,
  access_token: string
): Promise<DiscussionWithAuthor> {
  const result: any = await fetch(
    `${getAPIUrl()}discussions/${discussion_uuid}/lock`,
    RequestBodyWithAuthHeader('PUT', { is_locked }, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function deleteDiscussion(
  discussion_uuid: string,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}discussions/${discussion_uuid}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function upvoteDiscussion(
  discussion_uuid: string,
  access_token: string
): Promise<DiscussionVote> {
  const result: any = await fetch(
    `${getAPIUrl()}discussions/${discussion_uuid}/vote`,
    RequestBodyWithAuthHeader('POST', null, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res.data
}

export async function removeUpvote(
  discussion_uuid: string,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}discussions/${discussion_uuid}/vote`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function getUserVotesBatch(
  discussion_uuids: string[],
  access_token?: string
): Promise<Record<string, boolean>> {
  const result: any = await fetch(
    `${getAPIUrl()}discussions/votes/batch`,
    RequestBodyWithAuthHeader('POST', discussion_uuids, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

// ============================================================================
// Comments
// ============================================================================

export interface DiscussionComment {
  id: number
  discussion_id: number
  author_id: number
  comment_uuid: string
  content: string
  upvote_count: number
  creation_date: string
  update_date: string
}

export interface DiscussionCommentWithAuthor extends DiscussionComment {
  author: DiscussionAuthor | null
  has_voted: boolean
}

export interface CommentCreate {
  content: string
}

export async function getComments(
  discussion_uuid: string,
  page: number = 1,
  limit: number = 50,
  next: any,
  access_token?: string
): Promise<DiscussionCommentWithAuthor[]> {
  const result: any = await fetch(
    `${getAPIUrl()}discussions/${discussion_uuid}/comments?page=${page}&limit=${limit}`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function createComment(
  discussion_uuid: string,
  data: CommentCreate,
  access_token: string
): Promise<DiscussionCommentWithAuthor> {
  const result: any = await fetch(
    `${getAPIUrl()}discussions/${discussion_uuid}/comments`,
    RequestBodyWithAuthHeader('POST', data, null, access_token)
  )
  const res = await getResponseMetadata(result)
  if (!res.success) {
    const detail = res.data?.detail || res.data?.message || res.data
    let message: string
    if (typeof detail === 'string') {
      message = detail
    } else if (detail && typeof detail === 'object' && typeof detail.message === 'string') {
      message = detail.message
    } else {
      message = JSON.stringify(detail)
    }
    const error: any = new Error(message)
    error.status = res.status
    error.detail = detail
    throw error
  }
  return res.data
}

export async function updateComment(
  comment_uuid: string,
  data: CommentCreate,
  access_token: string
): Promise<DiscussionCommentWithAuthor> {
  const result: any = await fetch(
    `${getAPIUrl()}comments/${comment_uuid}`,
    RequestBodyWithAuthHeader('PUT', data, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function deleteComment(
  comment_uuid: string,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}comments/${comment_uuid}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function getCommentCount(
  discussion_uuid: string,
  next: any,
  access_token?: string
): Promise<number> {
  const result: any = await fetch(
    `${getAPIUrl()}discussions/${discussion_uuid}/comments/count`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res.count
}

export interface CommentVote {
  id: number
  comment_id: number
  user_id: number
  vote_uuid: string
  creation_date: string
}

export async function upvoteComment(
  comment_uuid: string,
  access_token: string
): Promise<CommentVote> {
  const result: any = await fetch(
    `${getAPIUrl()}comments/${comment_uuid}/vote`,
    RequestBodyWithAuthHeader('POST', null, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res.data
}

export async function removeCommentUpvote(
  comment_uuid: string,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}comments/${comment_uuid}/vote`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

// ============================================================================
// Reactions
// ============================================================================

export interface ReactionUser {
  id: number
  user_uuid: string
  username: string
  first_name: string | null
  last_name: string | null
  avatar_image: string | null
}

export interface ReactionSummary {
  emoji: string
  count: number
  users: ReactionUser[]
  has_reacted: boolean
}

export async function getReactions(
  discussion_uuid: string,
  access_token?: string
): Promise<ReactionSummary[]> {
  const result: any = await fetch(
    `${getAPIUrl()}discussions/${discussion_uuid}/reactions`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function toggleReaction(
  discussion_uuid: string,
  emoji: string,
  access_token: string
): Promise<{ action: 'added' | 'removed'; emoji: string }> {
  const result: any = await fetch(
    `${getAPIUrl()}discussions/${discussion_uuid}/reactions`,
    RequestBodyWithAuthHeader('POST', { emoji }, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}
