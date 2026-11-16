'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { type CommentAuthor, listMentionable } from '@services/courses/activityComments'
import { CommentAvatar, authorName } from './CommentBody'
import { insertMention, mentionQueryAt, type MentionUser } from './commentFormat'

// A comment textarea with @mention autocomplete. People offered are the ones
// who can edit the course (the API decides); picking one inserts @username
// and records them so the comment notifies them.

const cache = new Map<string, CommentAuthor[]>()

function matches(user: CommentAuthor, q: string): boolean {
  if (!q) return true
  const needle = q.toLowerCase()
  return [user.username, user.first_name, user.last_name].some((v) => (v || '').toLowerCase().includes(needle))
}

export function MentionTextarea({
  value,
  onChange,
  onSubmit,
  onCancel,
  onPick,
  placeholder,
  autoFocus,
  activityUuid,
  token,
  disabled,
  ariaLabel,
}: {
  value: string
  onChange: (_value: string) => void
  onSubmit: () => void
  onCancel?: () => void
  onPick: (_user: MentionUser & CommentAuthor) => void
  placeholder?: string
  autoFocus?: boolean
  activityUuid: string
  token?: string
  disabled?: boolean
  ariaLabel?: string
}) {
  const { t } = useTranslation()
  const ref = React.useRef<HTMLTextAreaElement>(null)
  const [query, setQuery] = React.useState<{ query: string; start: number } | null>(null)
  const [people, setPeople] = React.useState<CommentAuthor[]>(() => cache.get(activityUuid) ?? [])
  const [index, setIndex] = React.useState(0)
  const listId = React.useId()

  // Grow with the text, up to a cap, so short replies stay one line tall.
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
  }, [value])

  React.useEffect(() => {
    if (autoFocus) ref.current?.focus({ preventScroll: true })
  }, [autoFocus])

  React.useEffect(() => {
    if (!query || !token) return
    let cancelled = false
    const known = cache.get(activityUuid)
    const local = (known ?? []).filter((u) => matches(u, query.query))
    if (known && (local.length || query.query.length < 2)) {
      setPeople(known)
      return
    }
    const timer = window.setTimeout(async () => {
      try {
        const found = await listMentionable(activityUuid, query.query, token)
        if (cancelled) return
        const list = Array.isArray(found) ? found : []
        if (!query.query) cache.set(activityUuid, list)
        setPeople((prev) => {
          const byId = new Map(prev.map((u) => [u.id, u]))
          for (const u of list) byId.set(u.id, u)
          return [...byId.values()]
        })
      } catch {
        // The picker simply stays empty; typing a handle by hand still works.
      }
    }, query.query ? 150 : 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query, activityUuid, token])

  const options = query ? people.filter((u) => matches(u, query.query)).slice(0, 6) : []
  const open = !!query && options.length > 0

  const updateQuery = (el: HTMLTextAreaElement) => {
    const next = mentionQueryAt(el.value, el.selectionStart ?? el.value.length)
    setQuery(next)
    if (!next) setIndex(0)
  }

  const pick = (user: CommentAuthor) => {
    const el = ref.current
    if (!el || !query) return
    const caret = el.selectionStart ?? value.length
    const next = insertMention(value, query.start, caret, user.username)
    onChange(next.text)
    onPick(user)
    setQuery(null)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(next.caret, next.caret)
    })
  }

  return (
    <div className="relative">
      <textarea
        ref={ref}
        value={value}
        disabled={disabled}
        rows={1}
        aria-label={ariaLabel ?? placeholder}
        aria-autocomplete="list"
        aria-controls={open ? listId : undefined}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value)
          updateQuery(e.target)
        }}
        onClick={(e) => updateQuery(e.currentTarget)}
        onBlur={() => window.setTimeout(() => setQuery(null), 120)}
        onKeyDown={(e) => {
          if (open) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              const step = e.key === 'ArrowDown' ? 1 : -1
              setIndex((i) => (i + step + options.length) % options.length)
              return
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault()
              pick(options[Math.min(index, options.length - 1)])
              return
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              setQuery(null)
              return
            }
          }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            onSubmit()
          } else if (e.key === 'Escape' && onCancel) {
            e.preventDefault()
            e.stopPropagation()
            onCancel()
          }
        }}
        className="block w-full resize-none rounded-lg bg-white px-2.5 py-1.5 text-[13px] leading-[1.5] text-neutral-800 placeholder:text-neutral-400 ring-1 ring-inset ring-neutral-200 focus:outline-none focus:ring-2 focus:ring-neutral-900/70 disabled:opacity-60"
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={t('editor.comments.mention_people')}
          className="absolute start-0 end-0 top-full z-30 mt-1 max-h-56 overflow-auto rounded-lg bg-white p-1 shadow-lg ring-1 ring-black/10"
        >
          {options.map((user, i) => (
            <li key={user.id} role="option" aria-selected={i === index}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(user)
                }}
                onMouseEnter={() => setIndex(i)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-[13px] ${
                  i === index ? 'bg-neutral-100' : ''
                }`}
              >
                <CommentAvatar author={user} size={20} />
                <span className="truncate font-medium text-neutral-800">{authorName(user, user.username)}</span>
                <span className="truncate text-neutral-400">@{user.username}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
