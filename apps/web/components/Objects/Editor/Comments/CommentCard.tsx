'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowCounterClockwise, Check, PencilSimple, Trash } from '@phosphor-icons/react'
import { Button, ConfirmDialog, formatRelative } from '@components/Dashboard/Shared/DashKit/DashKit'
import type { ActivityComment, CommentAuthor, CommentThread } from '@services/courses/activityComments'
import { CommentAvatar, CommentBody, authorName } from './CommentBody'
import { MentionTextarea } from './MentionTextarea'
import { mentionedIds, type MentionUser } from './commentFormat'

export type ThreadActions = {
  reply: (_thread: CommentThread, _body: string, _mentions: number[]) => Promise<boolean>
  edit: (_thread: CommentThread, _comment: ActivityComment, _body: string, _mentions: number[]) => Promise<boolean>
  remove: (_thread: CommentThread, _comment: ActivityComment) => Promise<boolean>
  setStatus: (_thread: CommentThread, _status: 'open' | 'resolved') => Promise<boolean>
}

type Ctx = {
  me: number
  canModerate: boolean
  activityUuid: string
  token?: string
}

/** One comment inside a thread card. */
function CommentItem({
  thread,
  comment,
  ctx,
  actions,
  compact,
}: {
  thread: CommentThread
  comment: ActivityComment
  ctx: Ctx
  actions: ThreadActions
  compact: boolean
}) {
  const { t, i18n } = useTranslation()
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(comment.body)
  const [picked, setPicked] = React.useState<MentionUser[]>([])
  const [busy, setBusy] = React.useState(false)
  const [confirm, setConfirm] = React.useState(false)
  const mine = comment.author?.id === ctx.me
  const canDelete = !comment.deleted && (mine || ctx.canModerate)

  const save = async () => {
    const body = draft.trim()
    if (!body || busy) return
    setBusy(true)
    // The API also resolves @handles typed by hand, so earlier mentions stay.
    const ok = await actions.edit(thread, comment, body, mentionedIds(body, picked))
    setBusy(false)
    if (ok) setEditing(false)
  }

  if (comment.deleted) {
    return (
      <div className="flex items-center gap-2 py-1 text-[12px] italic text-neutral-400">
        {t('editor.comments.deleted')}
      </div>
    )
  }

  return (
    <div className="group/comment" data-comment={comment.comment_uuid}>
      <div className="flex items-start gap-2">
        <CommentAvatar author={comment.author} size={24} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="max-w-[65%] shrink-0 truncate text-[13px] font-semibold text-neutral-900">
              {authorName(comment.author, t('editor.comments.former_member'))}
            </span>
            <span className="min-w-0 truncate text-[11px] text-neutral-400" title={new Date(comment.created_at).toLocaleString()}>
              {formatRelative(comment.created_at, i18n.language)}
              {comment.edited_at ? ` · ${t('editor.comments.edited')}` : ''}
            </span>
            {(mine || canDelete) && !editing && (
              <span className="ms-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/comment:opacity-100 focus-within:opacity-100">
                {mine && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDraft(comment.body)
                      setEditing(true)
                    }}
                    className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                    aria-label={t('editor.comments.edit')}
                    title={t('editor.comments.edit')}
                  >
                    <PencilSimple size={13} />
                  </button>
                )}
                {canDelete && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setConfirm(true)
                    }}
                    className="rounded-md p-1 text-neutral-400 hover:bg-rose-50 hover:text-rose-600"
                    aria-label={t('editor.comments.delete')}
                    title={t('editor.comments.delete')}
                  >
                    <Trash size={13} />
                  </button>
                )}
              </span>
            )}
          </div>
          {editing ? (
            <div className="mt-1.5 space-y-1.5" onClick={(e) => e.stopPropagation()}>
              <MentionTextarea
                value={draft}
                onChange={setDraft}
                onSubmit={save}
                onCancel={() => setEditing(false)}
                onPick={(u) => setPicked((p) => [...p, { id: u.id, username: u.username }])}
                autoFocus
                activityUuid={ctx.activityUuid}
                token={ctx.token}
                ariaLabel={t('editor.comments.edit')}
              />
              <div className="flex justify-end gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  {t('editor.comments.cancel')}
                </Button>
                <Button size="sm" variant="primary" onClick={save} loading={busy} disabled={!draft.trim()}>
                  {t('editor.comments.save')}
                </Button>
              </div>
            </div>
          ) : (
            <div className={`mt-0.5 ${compact ? 'line-clamp-3' : ''}`}>
              <CommentBody body={comment.body} />
            </div>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('editor.comments.delete_title')}
        message={t('editor.comments.delete_message')}
        confirmLabel={t('editor.comments.delete')}
        onConfirm={() => actions.remove(thread, comment)}
      />
    </div>
  )
}

/** A thread: its comments, reply box when focused, resolve / reopen. */
export function CommentCard({
  thread,
  active,
  onActivate,
  ctx,
  actions,
  showQuote,
  detached,
}: {
  thread: CommentThread
  active: boolean
  onActivate: () => void
  ctx: Ctx
  actions: ThreadActions
  showQuote?: boolean
  detached?: boolean
}) {
  const { t } = useTranslation()
  const [reply, setReply] = React.useState('')
  const [picked, setPicked] = React.useState<MentionUser[]>([])
  const [busy, setBusy] = React.useState(false)
  const resolved = thread.status === 'resolved'
  const comments = Array.isArray(thread.comments) ? thread.comments : []
  const hiddenReplies = !active && comments.length > 3 ? comments.length - 2 : 0
  const shown = hiddenReplies ? [comments[0], comments[comments.length - 1]] : comments

  const send = async () => {
    const body = reply.trim()
    if (!body || busy) return
    setBusy(true)
    const ok = await actions.reply(thread, body, mentionedIds(body, picked))
    setBusy(false)
    if (ok) {
      setReply('')
      setPicked([])
    }
  }

  const toggleStatus = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setBusy(true)
    await actions.setStatus(thread, resolved ? 'open' : 'resolved')
    setBusy(false)
  }

  return (
    <div
      role="group"
      aria-label={t('editor.comments.thread_label', { name: authorName(thread.created_by, '') })}
      data-thread-card={thread.thread_uuid}
      data-active={active || undefined}
      onClick={onActivate}
      className={`relative rounded-xl bg-white p-3 text-start transition-shadow ${
        active ? 'shadow-lh-floating ring-1 ring-neutral-300' : 'nice-shadow hover:ring-1 hover:ring-neutral-200 cursor-pointer'
      } ${resolved ? 'opacity-80' : ''}`}
    >
      <div className="absolute end-2 top-2 flex items-center">
        <button
          type="button"
          onClick={toggleStatus}
          disabled={busy}
          className={`rounded-md p-1 transition-colors ${
            resolved
              ? 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800'
              : 'text-neutral-400 hover:bg-emerald-50 hover:text-emerald-600'
          }`}
          aria-label={resolved ? t('editor.comments.reopen') : t('editor.comments.resolve')}
          title={resolved ? t('editor.comments.reopen') : t('editor.comments.resolve')}
        >
          {resolved ? <ArrowCounterClockwise size={15} /> : <Check size={15} weight="bold" />}
        </button>
      </div>

      {(showQuote || detached) && thread.quote && (
        <p className="mb-2 me-7 line-clamp-2 border-s-2 border-amber-300 ps-2 text-[12px] italic text-neutral-500">
          {thread.quote}
        </p>
      )}
      {resolved && (
        <p className="mb-2 me-7 text-[11px] font-medium text-emerald-700">
          {t('editor.comments.resolved_by', { name: authorName(thread.resolved_by, t('editor.comments.former_member')) })}
        </p>
      )}

      <div className="space-y-3 pe-6">
        {shown.map((comment, i) => (
          <React.Fragment key={comment.comment_uuid}>
            {hiddenReplies > 0 && i === 1 && (
              <p className="ps-8 text-[12px] font-medium text-sky-700">
                {t('editor.comments.more_replies', { count: hiddenReplies })}
              </p>
            )}
            <CommentItem
              thread={thread}
              comment={comment}
              ctx={ctx}
              actions={actions}
              compact={!active}
            />
          </React.Fragment>
        ))}
      </div>

      {active && !resolved && (
        <div className="mt-3 space-y-1.5" onClick={(e) => e.stopPropagation()}>
          <MentionTextarea
            value={reply}
            onChange={setReply}
            onSubmit={send}
            onPick={(u) => setPicked((p) => [...p, { id: u.id, username: u.username }])}
            placeholder={t('editor.comments.reply_placeholder')}
            activityUuid={ctx.activityUuid}
            token={ctx.token}
            disabled={busy}
          />
          {reply.trim() && (
            <div className="flex justify-end gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => setReply('')}>
                {t('editor.comments.cancel')}
              </Button>
              <Button size="sm" variant="primary" onClick={send} loading={busy}>
                {t('editor.comments.reply')}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** The card a new comment is written in, next to the selected text. */
export function NewThreadCard({
  quote,
  onSubmit,
  onCancel,
  ctx,
  me,
}: {
  quote: string
  onSubmit: (_body: string, _mentions: number[]) => Promise<boolean>
  onCancel: () => void
  ctx: Ctx
  me: CommentAuthor | null
}) {
  const { t } = useTranslation()
  const [body, setBody] = React.useState('')
  const [picked, setPicked] = React.useState<MentionUser[]>([])
  const [busy, setBusy] = React.useState(false)
  const submit = async () => {
    const text = body.trim()
    if (!text || busy) return
    setBusy(true)
    const ok = await onSubmit(text, mentionedIds(text, picked))
    setBusy(false)
    if (ok) setBody('')
  }
  return (
    <div data-thread-card="new" className="rounded-xl bg-white p-3 shadow-lh-floating ring-1 ring-neutral-300">
      <div className="mb-2 flex items-center gap-2">
        <CommentAvatar author={me} size={24} />
        <span className="truncate text-[13px] font-semibold text-neutral-900">
          {authorName(me, t('editor.comments.you'))}
        </span>
      </div>
      {quote && (
        <p className="mb-2 line-clamp-2 border-s-2 border-amber-300 ps-2 text-[12px] italic text-neutral-500">{quote}</p>
      )}
      <MentionTextarea
        value={body}
        onChange={setBody}
        onSubmit={submit}
        onCancel={onCancel}
        onPick={(u) => setPicked((p) => [...p, { id: u.id, username: u.username }])}
        placeholder={t('editor.comments.new_placeholder')}
        autoFocus
        activityUuid={ctx.activityUuid}
        token={ctx.token}
        disabled={busy}
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="hidden text-[11px] text-neutral-400 sm:inline">{t('editor.comments.submit_hint')}</span>
        <div className="ms-auto flex gap-1.5">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {t('editor.comments.cancel')}
          </Button>
          <Button size="sm" variant="primary" onClick={submit} loading={busy} disabled={!body.trim()}>
            {t('editor.comments.comment')}
          </Button>
        </div>
      </div>
    </div>
  )
}
