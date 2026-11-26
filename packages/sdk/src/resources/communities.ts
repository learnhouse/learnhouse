import type { HttpCore } from '../core/http'
import { paginate } from '../core/paginate'
import type { BaseRequestOptions } from '../core/types'
import type {
  Community,
  CommunityActivity,
  CommunitySummary,
  Discussion,
  DiscussionComment,
  DiscussionCommentVote,
  DiscussionLabel,
  DiscussionReaction,
  DiscussionSort,
  DiscussionVote,
  DiscussionWithVote,
} from '../models'

export interface PageOptions extends BaseRequestOptions {
  /** 1-based. Default 1. */
  page?: number
  /** Default 20 (communities) or 10 (discussions, comments). */
  limit?: number
}

export interface ListDiscussionsOptions extends PageOptions {
  /** `recent` (default), `upvotes` or `hot`. */
  sortBy?: DiscussionSort
  /** Only discussions with this label id (see `discussions.labels()`). */
  label?: string
}

export interface NewDiscussionInput {
  title: string
  content?: string
  /** A label id from `discussions.labels()`. */
  label?: string
  emoji?: string
}

/** Communities (forums), each optionally tied to a course. Standard plan or higher on Cloud. */
export function createCommunitiesResource(http: HttpCore) {
  // Named so methods still work when destructured off the resource.
  const resource = {
    /** `GET /api/v1/communities/org/{org_id}/page/{page}/limit/{limit}` */
    list(orgId: number, options: PageOptions = {}): Promise<Community[]> {
      const { page = 1, limit = 20, ...rest } = options
      return http.GET('/api/v1/communities/org/{org_id}/page/{page}/limit/{limit}', {
        ...rest,
        params: { path: { org_id: orgId, page, limit } },
      })
    },
    /** Every community of the org, page by page. */
    listAll(orgId: number, options: BaseRequestOptions & { pageSize?: number } = {}): AsyncGenerator<Community, void, undefined> {
      const { pageSize = 50, ...rest } = options
      return paginate(({ page }) => resource.list(orgId, { ...rest, page, limit: pageSize }), {
        pageSize,
        signal: rest.signal,
      })
    },
    /** `GET /api/v1/communities/{community_uuid}` */
    get(communityUuid: string, options?: BaseRequestOptions): Promise<Community> {
      return http.GET('/api/v1/communities/{community_uuid}', {
        ...options,
        params: { path: { community_uuid: communityUuid } },
      })
    },
    /** The community linked to a course, or `null`. `GET /api/v1/communities/course/{course_uuid}` */
    getForCourse(courseUuid: string, options?: BaseRequestOptions): Promise<Community | null> {
      return http.GET('/api/v1/communities/course/{course_uuid}', {
        ...options,
        params: { path: { course_uuid: courseUuid } },
      })
    },
    /** Discussion counts and last activity per community. `GET /api/v1/communities/org/{org_id}/summary` */
    summary(orgId: number, options?: BaseRequestOptions): Promise<CommunitySummary[]> {
      return http.GET('/api/v1/communities/org/{org_id}/summary', { ...options, params: { path: { org_id: orgId } } })
    },
    /** `GET /api/v1/communities/org/{org_id}/activity` */
    activity(orgId: number, options?: BaseRequestOptions): Promise<CommunityActivity[]> {
      return http.GET('/api/v1/communities/org/{org_id}/activity', { ...options, params: { path: { org_id: orgId } } })
    },
    /** `GET /api/v1/communities/{community_uuid}/discussions` */
    listDiscussions(communityUuid: string, options: ListDiscussionsOptions = {}): Promise<Discussion[]> {
      const { page, limit, sortBy, label, ...rest } = options
      return http.GET('/api/v1/communities/{community_uuid}/discussions', {
        ...rest,
        params: { path: { community_uuid: communityUuid }, query: { page, limit, sort_by: sortBy, label } },
      })
    },
    /** Start a discussion. `POST /api/v1/communities/{community_uuid}/discussions` */
    createDiscussion(communityUuid: string, input: NewDiscussionInput, options?: BaseRequestOptions): Promise<DiscussionWithVote> {
      return http.POST('/api/v1/communities/{community_uuid}/discussions', {
        ...options,
        params: { path: { community_uuid: communityUuid } },
        body: { title: input.title, content: input.content, label: input.label, emoji: input.emoji },
      })
    },
  }
  return resource
}

/** Discussions inside a community: read, post, reply, vote and react. */
export function createDiscussionsResource(http: HttpCore) {
  return {
    /** The labels discussions can carry. `GET /api/v1/discussions/labels` */
    labels(options?: BaseRequestOptions): Promise<DiscussionLabel[]> {
      return http.GET('/api/v1/discussions/labels', options)
    },
    /** `GET /api/v1/discussions/{discussion_uuid}` */
    get(discussionUuid: string, options?: BaseRequestOptions): Promise<Discussion> {
      return http.GET('/api/v1/discussions/{discussion_uuid}', {
        ...options,
        params: { path: { discussion_uuid: discussionUuid } },
      })
    },
    /** Edit your own discussion. `PUT /api/v1/discussions/{discussion_uuid}` */
    update(
      discussionUuid: string,
      input: { title?: string; content?: string; label?: string | null; emoji?: string | null },
      options?: BaseRequestOptions,
    ): Promise<DiscussionWithVote> {
      return http.PUT('/api/v1/discussions/{discussion_uuid}', {
        ...options,
        params: { path: { discussion_uuid: discussionUuid } },
        body: input,
      })
    },
    /** `DELETE /api/v1/discussions/{discussion_uuid}` */
    delete(discussionUuid: string, options?: BaseRequestOptions): Promise<Record<string, unknown>> {
      return http.DELETE('/api/v1/discussions/{discussion_uuid}', {
        ...options,
        params: { path: { discussion_uuid: discussionUuid } },
      })
    },
    /** Replies, oldest first. `GET /api/v1/discussions/{discussion_uuid}/comments` */
    listComments(discussionUuid: string, options: PageOptions = {}): Promise<DiscussionComment[]> {
      const { page, limit, ...rest } = options
      return http.GET('/api/v1/discussions/{discussion_uuid}/comments', {
        ...rest,
        params: { path: { discussion_uuid: discussionUuid }, query: { page, limit } },
      })
    },
    /** `GET /api/v1/discussions/{discussion_uuid}/comments/count` */
    countComments(discussionUuid: string, options?: BaseRequestOptions): Promise<{ count: number }> {
      return http.GET('/api/v1/discussions/{discussion_uuid}/comments/count', {
        ...options,
        params: { path: { discussion_uuid: discussionUuid } },
      }) as Promise<{ count: number }>
    },
    /** Reply. `POST /api/v1/discussions/{discussion_uuid}/comments` */
    reply(discussionUuid: string, content: string, options?: BaseRequestOptions): Promise<DiscussionComment> {
      return http.POST('/api/v1/discussions/{discussion_uuid}/comments', {
        ...options,
        params: { path: { discussion_uuid: discussionUuid } },
        body: { content },
      })
    },
    /** Edit your own reply. `PUT /api/v1/comments/{comment_uuid}` */
    updateComment(commentUuid: string, content: string, options?: BaseRequestOptions): Promise<DiscussionComment> {
      return http.PUT('/api/v1/comments/{comment_uuid}', {
        ...options,
        params: { path: { comment_uuid: commentUuid } },
        body: { content },
      })
    },
    /** `DELETE /api/v1/comments/{comment_uuid}` */
    deleteComment(commentUuid: string, options?: BaseRequestOptions): Promise<Record<string, unknown>> {
      return http.DELETE('/api/v1/comments/{comment_uuid}', { ...options, params: { path: { comment_uuid: commentUuid } } })
    },
    /** Upvote a discussion. `POST /api/v1/discussions/{discussion_uuid}/vote` */
    vote(discussionUuid: string, options?: BaseRequestOptions): Promise<DiscussionVote> {
      return http.POST('/api/v1/discussions/{discussion_uuid}/vote', {
        ...options,
        params: { path: { discussion_uuid: discussionUuid } },
      })
    },
    /** `DELETE /api/v1/discussions/{discussion_uuid}/vote` */
    unvote(discussionUuid: string, options?: BaseRequestOptions): Promise<Record<string, unknown>> {
      return http.DELETE('/api/v1/discussions/{discussion_uuid}/vote', {
        ...options,
        params: { path: { discussion_uuid: discussionUuid } },
      })
    },
    /** Upvote a reply. `POST /api/v1/comments/{comment_uuid}/vote` */
    voteComment(commentUuid: string, options?: BaseRequestOptions): Promise<DiscussionCommentVote> {
      return http.POST('/api/v1/comments/{comment_uuid}/vote', { ...options, params: { path: { comment_uuid: commentUuid } } })
    },
    /** `DELETE /api/v1/comments/{comment_uuid}/vote` */
    unvoteComment(commentUuid: string, options?: BaseRequestOptions): Promise<Record<string, unknown>> {
      return http.DELETE('/api/v1/comments/{comment_uuid}/vote', { ...options, params: { path: { comment_uuid: commentUuid } } })
    },
    /** Emoji reactions with counts. `GET /api/v1/discussions/{discussion_uuid}/reactions` */
    listReactions(discussionUuid: string, options?: BaseRequestOptions): Promise<DiscussionReaction[]> {
      return http.GET('/api/v1/discussions/{discussion_uuid}/reactions', {
        ...options,
        params: { path: { discussion_uuid: discussionUuid } },
      })
    },
    /**
     * Toggle an emoji reaction, or set it with `active`.
     * `POST /api/v1/discussions/{discussion_uuid}/reactions`
     */
    react(
      discussionUuid: string,
      emoji: string,
      options: BaseRequestOptions & { active?: boolean } = {},
    ): Promise<{ action: 'added' | 'removed'; [key: string]: unknown }> {
      const { active, ...rest } = options
      return http.POST('/api/v1/discussions/{discussion_uuid}/reactions', {
        ...rest,
        params: { path: { discussion_uuid: discussionUuid } },
        body: { emoji, active: active ?? null },
      }) as Promise<{ action: 'added' | 'removed'; [key: string]: unknown }>
    },
  }
}

export type CommunitiesResource = ReturnType<typeof createCommunitiesResource>
export type DiscussionsResource = ReturnType<typeof createDiscussionsResource>
