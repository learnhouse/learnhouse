'use client'
import React, { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUpRight, ChevronDown, Loader2, MessageSquare, Plus, Send, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getUriWithOrg } from '@services/config/config'
import { Z_INDEX } from '@/lib/z-index'
import { getCommunity } from '@services/communities/communities'
import {
  DiscussionWithAuthor,
  createComment,
  createDiscussion,
  getComments,
  getDiscussions,
} from '@services/communities/discussions'

interface CommunityHoverCardProps {
  communityUuid: string
  anchor: HTMLElement
  onMouseEnter: () => void
  onMouseLeave: () => void
}

const CARD_WIDTH = 380

function authorName(d: { author: { first_name: string; last_name: string; username: string } | null }): string {
  if (!d.author) return ''
  return [d.author.first_name, d.author.last_name].filter(Boolean).join(' ') || d.author.username
}

// A community, in place: its latest discussions, a reply box under each, and
// a way to start a new one, without leaving the page.
export default function CommunityHoverCard({ communityUuid, anchor, onMouseEnter, onMouseLeave }: CommunityHoverCardProps) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined
  const signedIn = session?.status === 'authenticated' && !!accessToken
  const queryClient = useQueryClient()
  const cardRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number; maxHeight: number }>({ top: 0, left: 0, maxHeight: 480 })
  const [open, setOpen] = useState<string | null>(null)
  const [composing, setComposing] = useState(false)

  const community = useQuery({
    queryKey: ['community', communityUuid],
    queryFn: () => getCommunity(communityUuid, {}, accessToken),
    staleTime: 60_000,
    retry: false,
  })
  const discussions = useQuery({
    queryKey: ['community', communityUuid, 'discussions', 'recent', 1, 'card'],
    queryFn: () => getDiscussions(communityUuid, 'recent', 1, 4, {}, accessToken),
    staleTime: 30_000,
    retry: false,
    enabled: community.isSuccess,
  })

  // Below the tag when it fits, else above; never taller than the room there.
  useLayoutEffect(() => {
    const rect = anchor.getBoundingClientRect()
    const height = Math.min(cardRef.current?.scrollHeight ?? 320, 520)
    const spaceBelow = window.innerHeight - rect.bottom - 16
    const spaceAbove = rect.top - 16
    const below = spaceBelow >= height || spaceBelow >= spaceAbove
    const maxHeight = Math.max(200, Math.min(520, below ? spaceBelow : spaceAbove))
    const top = below ? rect.bottom + 8 : Math.max(8, rect.top - 8 - Math.min(height, maxHeight))
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - CARD_WIDTH - 8)
    setPosition({ top, left, maxHeight })
  }, [anchor, open, composing, community.data, discussions.data])

  const communityPath = `/community/${communityUuid.replace('community_', '')}`
  const unavailable = community.isError

  const card = (
    <div
      ref={cardRef}
      data-community-card
      role="dialog"
      aria-label={community.data?.name ?? t('communities.tag.loading', 'Community')}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      style={{ position: 'fixed', top: position.top, left: position.left, width: CARD_WIDTH, maxHeight: position.maxHeight, zIndex: Z_INDEX.EDITOR_BUBBLE }}
      className="flex flex-col rounded-2xl bg-white text-sm text-gray-700 shadow-2xl ring-1 ring-black/10"
    >
      {community.isLoading && (
        <div className="flex items-center gap-2 px-4 py-6 text-gray-400">
          <Loader2 size={14} className="animate-spin" /> {t('communities.tag.loading', 'Loading community…')}
        </div>
      )}
      {unavailable && (
        <div className="px-4 py-5 text-gray-500">
          {t('communities.tag.unavailable', 'This community is not available to you.')}
        </div>
      )}
      {community.data && (
        <>
          <div className="flex items-start gap-3 border-b border-gray-100 px-4 py-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
              <Users size={17} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold text-gray-900">{community.data.name}</div>
              {community.data.description && (
                <div className="line-clamp-2 text-xs text-gray-500">{community.data.description}</div>
              )}
            </div>
            <Link
              href={getUriWithOrg(org?.slug, communityPath)}
              className="inline-flex shrink-0 items-center gap-0.5 rounded-lg px-2 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-50"
            >
              {t('communities.tag.open', 'Open')} <ArrowUpRight size={12} />
            </Link>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            {discussions.isLoading && <Loader2 size={14} className="mx-auto my-3 animate-spin text-gray-400" />}
            {discussions.data?.length === 0 && (
              <p className="px-2 py-3 text-center text-xs text-gray-400">
                {t('communities.tag.empty', 'No discussions yet. Start the first one.')}
              </p>
            )}
            {discussions.data?.map((d) => (
              <DiscussionRow
                key={d.discussion_uuid}
                discussion={d}
                expanded={open === d.discussion_uuid}
                onToggle={() => setOpen((v) => (v === d.discussion_uuid ? null : d.discussion_uuid))}
                discussionHref={getUriWithOrg(org?.slug, `${communityPath}/discussion/${d.discussion_uuid.replace('discussion_', '')}`)}
                signedIn={signedIn}
                accessToken={accessToken}
              />
            ))}
          </div>

          <div className="border-t border-gray-100 px-3 py-2">
            {!signedIn ? (
              <p className="px-1 py-1 text-xs text-gray-500">{t('communities.tag.sign_in', 'Sign in to join the discussion.')}</p>
            ) : composing ? (
              <NewDiscussionForm
                communityUuid={communityUuid}
                accessToken={accessToken as string}
                onDone={(created) => {
                  setComposing(false)
                  queryClient.invalidateQueries({ queryKey: ['community', communityUuid, 'discussions'] })
                  if (created) setOpen(created)
                }}
              />
            ) : (
              <button
                type="button"
                onClick={() => setComposing(true)}
                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-50"
              >
                <Plus size={13} /> {t('communities.tag.new_discussion', 'Start a discussion')}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )

  return createPortal(card, document.body)
}

function DiscussionRow(props: {
  discussion: DiscussionWithAuthor
  expanded: boolean
  onToggle: () => void
  discussionHref: string
  signedIn: boolean
  accessToken?: string
}) {
  const { t } = useTranslation()
  const { discussion: d, expanded, signedIn, accessToken } = props
  const queryClient = useQueryClient()
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const comments = useQuery({
    queryKey: ['discussion', d.discussion_uuid, 'comments', 1, 'card'],
    queryFn: () => getComments(d.discussion_uuid, 1, 20, {}, accessToken),
    enabled: expanded,
    staleTime: 15_000,
  })

  const send = async () => {
    const content = reply.trim()
    if (!content || !accessToken) return
    setSending(true)
    try {
      await createComment(d.discussion_uuid, { content }, accessToken)
      setReply('')
      await queryClient.invalidateQueries({ queryKey: ['discussion', d.discussion_uuid] })
    } catch (e: any) {
      toast.error(e?.message || t('communities.tag.reply_error', 'Could not post your reply'))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className={`rounded-xl ${expanded ? 'bg-gray-50' : ''}`}>
      <button
        type="button"
        onClick={props.onToggle}
        className="flex w-full items-start gap-2 rounded-xl px-2 py-2 text-start hover:bg-gray-50"
      >
        <span className="mt-0.5 shrink-0 text-base leading-none">{d.emoji || <MessageSquare size={14} className="text-gray-400" />}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-gray-900">{d.title}</span>
          <span className="block truncate text-xs text-gray-400">{authorName(d)}</span>
        </span>
        <ChevronDown size={14} className={`mt-1 shrink-0 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="space-y-2 px-3 pb-3">
          {comments.isLoading && <Loader2 size={13} className="animate-spin text-gray-400" />}
          {comments.data?.length === 0 && (
            <p className="text-xs text-gray-400">{t('communities.tag.no_replies', 'No replies yet.')}</p>
          )}
          {comments.data?.slice(-5).map((c) => (
            <div key={c.comment_uuid} className="rounded-lg bg-white px-2.5 py-1.5 text-xs ring-1 ring-gray-100">
              <div className="font-semibold text-gray-700">{authorName(c)}</div>
              <div className="whitespace-pre-wrap text-gray-600">{c.content}</div>
            </div>
          ))}
          {signedIn && !d.is_locked && (
            <div className="flex items-end gap-1.5">
              <textarea
                value={reply}
                rows={2}
                maxLength={5000}
                placeholder={t('communities.tag.reply_placeholder', 'Write a reply…')}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send()
                }}
                className="min-h-[2.25rem] flex-1 resize-none rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-sky-300"
              />
              <button
                type="button"
                disabled={!reply.trim() || sending}
                onClick={send}
                aria-label={t('communities.tag.reply', 'Reply')}
                className="rounded-lg bg-sky-600 p-2 text-white hover:bg-sky-700 disabled:opacity-40"
              >
                {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              </button>
            </div>
          )}
          <Link href={props.discussionHref} className="inline-block text-xs font-semibold text-sky-700 hover:underline">
            {t('communities.tag.open_discussion', 'Open the full discussion')}
          </Link>
        </div>
      )}
    </div>
  )
}

function NewDiscussionForm(props: { communityUuid: string; accessToken: string; onDone: (created?: string) => void }) {
  const { t } = useTranslation()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)

  const submit = async () => {
    if (!title.trim()) return
    setSending(true)
    try {
      const content = body.trim()
        ? JSON.stringify({ type: 'doc', content: body.trim().split(/\n+/).map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] })) })
        : null
      const created = await createDiscussion(props.communityUuid, { title: title.trim(), content }, props.accessToken)
      toast.success(t('communities.tag.posted', 'Discussion posted'))
      props.onDone(created?.discussion_uuid)
    } catch (e: any) {
      toast.error(e?.message || t('communities.tag.post_error', 'Could not post the discussion'))
      setSending(false)
    }
  }

  return (
    <div className="space-y-1.5 py-1">
      <input
        autoFocus
        value={title}
        maxLength={200}
        placeholder={t('communities.tag.title_placeholder', 'Title')}
        onChange={(e) => setTitle(e.target.value)}
        className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm outline-none focus:border-sky-300"
      />
      <textarea
        value={body}
        rows={3}
        maxLength={5000}
        placeholder={t('communities.tag.body_placeholder', 'What would you like to ask or share?')}
        onChange={(e) => setBody(e.target.value)}
        className="w-full resize-none rounded-lg border border-gray-200 px-2 py-1.5 text-xs outline-none focus:border-sky-300"
      />
      <div className="flex justify-end gap-1.5">
        <button type="button" onClick={() => props.onDone()} className="rounded-lg px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-100">
          {t('common.cancel', 'Cancel')}
        </button>
        <button
          type="button"
          disabled={!title.trim() || sending}
          onClick={submit}
          className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-40"
        >
          {sending ? <Loader2 size={13} className="animate-spin" /> : t('communities.tag.post', 'Post')}
        </button>
      </div>
    </div>
  )
}
