'use client'

import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { Popover, PopoverAnchor, PopoverContent } from '@components/ui/popover'
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'
import { AvatarStack, Chip, type ChipTone } from '@/design'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useDirection } from '@components/Hooks/useDirection'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import { getUriWithOrg } from '@services/config/config'
import { formatDate, formatDateTime, formatRelative, intlLocale } from '@/lib/format'
import {
  activeAuthors,
  authorInitials,
  authorName,
  authorsLineSegments,
  avatarTint,
  type CourseAuthorEntry,
  type CourseAuthorUser,
} from './authorsLineText'

const NAMES_SLOT = '\u0000names\u0000'
const HOVER_OPEN_MS = 120
const HOVER_CLOSE_MS = 180

const ROLE_TONE: Record<string, ChipTone> = { CREATOR: 'amber', MAINTAINER: 'sky' }
const ROLE_KEY: Record<string, string> = {
  CREATOR: 'creator',
  MAINTAINER: 'maintainer',
  CONTRIBUTOR: 'contributor',
  REPORTER: 'reporter',
}

function avatarSrc(user: CourseAuthorUser): string {
  if (!user.avatar_image) return ''
  if (/^https?:\/\//.test(user.avatar_image)) return user.avatar_image
  return getUserAvatarMediaDirectory(user.user_uuid, user.avatar_image)
}

function toPerson(user: CourseAuthorUser) {
  return {
    key: user.user_uuid,
    src: avatarSrc(user),
    label: authorName(user),
    initials: authorInitials(user),
    tint: avatarTint(user.user_uuid),
  }
}

function validDate(value: string | null | undefined): string | null {
  if (!value) return null
  return Number.isNaN(new Date(value).getTime()) ? null : value
}

interface CourseAuthorsLineProps {
  authors: readonly CourseAuthorEntry[] | null | undefined
  /** Course creation date; with `updatedAt`, shown as "Created … · Updated …". */
  createdAt?: string | null
  updatedAt?: string | null
  /** Hide the dates where the page already shows them. */
  showDates?: boolean
  /** `inline` puts the dates beside the authors from lg; `stacked` always below. */
  layout?: 'inline' | 'stacked'
  className?: string
}

/**
 * "By A, B and 3 others" with an avatar stack, then "Created 3 Oct 2025 ·
 * Updated 2 months ago". The avatar stack and the "{n} others" button open
 * one popover listing every active author (hover, focus or tap).
 */
export default function CourseAuthorsLine({
  authors,
  createdAt,
  updatedAt,
  showDates = true,
  layout = 'inline',
  className = '',
}: CourseAuthorsLineProps) {
  const { t, i18n } = useTranslation()
  const { isRTL } = useDirection()
  const lng = i18n.language || 'en'
  const list = useMemo(() => activeAuthors(authors ?? []), [authors])
  const people = useMemo(() => list.map((a) => toPerson(a.user as CourseAuthorUser)), [list])
  const { open, onOpenChange, anchorRef, contentRef, triggerProps, contentProps } = useHoverPopover()

  const segments = useMemo(
    () =>
      authorsLineSegments(
        people.map((p) => p.label),
        { template: t('courses.by_authors', { names: NAMES_SLOT }), slot: NAMES_SLOT, locale: intlLocale(lng) }
      ),
    [people, t, lng]
  )

  const created = validDate(createdAt)
  const updated = validDate(updatedAt) ?? created
  const hasDates = showDates && Boolean(created || updated)

  if (!people.length && !hasDates) return null

  const stacked = layout === 'stacked'
  return (
    <div
      className={`flex flex-col gap-1 min-w-0 text-xs ${stacked ? '' : 'lg:flex-row lg:items-center lg:gap-2'} ${className}`}
    >
      {people.length > 0 && (
        <Popover open={open} onOpenChange={onOpenChange}>
          <PopoverAnchor asChild>
            <div ref={anchorRef} className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                {...triggerProps}
                aria-label={t('courses.show_all_authors')}
                className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20 focus-visible:ring-offset-2"
              >
                <AvatarStack people={people} size={26} max={3} showTitles={false} overlap="loose" />
              </button>
              <p className="min-w-0 line-clamp-2 leading-snug text-neutral-600">
                {segments.map((seg, i) => {
                  if (seg.type === 'name') {
                    return (
                      <bdi key={i} className="font-medium text-neutral-800">
                        {seg.value}
                      </bdi>
                    )
                  }
                  if (seg.type === 'others') {
                    return (
                      <button
                        key={i}
                        type="button"
                        {...triggerProps}
                        className="font-medium text-neutral-800 underline-offset-2 decoration-neutral-400 hover:underline focus-visible:underline focus-visible:outline-none"
                      >
                        {t('courses.others_count', { count: seg.count })}
                      </button>
                    )
                  }
                  return <React.Fragment key={i}>{seg.value}</React.Fragment>
                })}
              </p>
            </div>
          </PopoverAnchor>
          <PopoverContent
            ref={contentRef}
            {...contentProps}
            aria-label={t('courses.authors_count', { count: list.length })}
            side="bottom"
            align={isRTL ? 'end' : 'start'}
            sideOffset={8}
            collisionPadding={16}
            className="w-80 max-w-[calc(100vw-2rem)] p-0 bg-white rounded-2xl border-0 nice-shadow overflow-hidden"
          >
            <AuthorsList list={list} people={people} />
          </PopoverContent>
        </Popover>
      )}
      {people.length > 0 && hasDates && !stacked && (
        <span aria-hidden className="hidden lg:inline text-neutral-300">
          ·
        </span>
      )}
      {hasDates && <CourseDates created={created} updated={updated} lng={lng} />}
    </div>
  )
}

function CourseDates({ created, updated, lng }: { created: string | null; updated: string | null; lng: string }) {
  const { t } = useTranslation()
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-neutral-500 shrink-0">
      {created && (
        <span className="whitespace-nowrap">
          {t('courses.created_short', {
            date: formatDate(created, lng, { dateStyle: undefined, day: 'numeric', month: 'short', year: 'numeric' }),
          })}
        </span>
      )}
      {created && updated && (
        <span aria-hidden className="text-neutral-300">
          ·
        </span>
      )}
      {updated && (
        <ToolTip content={formatDateTime(updated, lng, { dateStyle: 'long', timeStyle: 'short' })}>
          <time
            dateTime={updated}
            tabIndex={0}
            className="whitespace-nowrap cursor-default rounded-sm underline decoration-dotted decoration-neutral-300 underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20"
          >
            {t('courses.updated_short', { when: formatRelative(updated, lng) })}
          </time>
        </ToolTip>
      )}
    </p>
  )
}

/** Every active author: avatar, name, @username, role; a profile link when signed in. */
function AuthorsList({ list, people }: { list: CourseAuthorEntry[]; people: ReturnType<typeof toPerson>[] }) {
  const { t } = useTranslation()
  const params = useParams() as { orgslug?: string } | null
  const session = useLHSession() as any
  const signedIn = Boolean(session?.data?.tokens?.access_token)
  return (
    <>
      <p className="px-4 pt-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
        {t('courses.authors_count', { count: list.length })}
      </p>
      <ul className="max-h-72 overflow-y-auto pb-1.5">
        {list.map((author, i) => {
          const user = author.user as CourseAuthorUser
          const person = people[i]
          const role = ROLE_KEY[String(author.authorship ?? '')]
          const showUsername = Boolean(user.username) && person.label !== `@${user.username}`
          const row = (
            <>
              <AvatarStack people={[person]} size={32} max={1} showTitles={false} />
              <span className="min-w-0 flex-1">
                <bdi className="block text-sm font-medium leading-snug text-neutral-900 break-words line-clamp-2" title={person.label}>{person.label}</bdi>
                {showUsername && (
                  <span className="block truncate text-xs text-neutral-500">
                    <bdi>@{user.username}</bdi>
                  </span>
                )}
              </span>
              {role && (
                <Chip tone={ROLE_TONE[String(author.authorship)] ?? 'neutral'} className="shrink-0">
                  {t(`courses.author_role.${role}`)}
                </Chip>
              )}
            </>
          )
          const rowClass = 'flex items-center gap-3 px-4 py-2'
          return (
            <li key={person.key}>
              {signedIn && user.username ? (
                <Link
                  href={getUriWithOrg(params?.orgslug ?? '', `/user/${user.username}`)}
                  className={`${rowClass} hover:bg-neutral-50 focus-visible:bg-neutral-50 focus-visible:outline-none transition-colors`}
                >
                  {row}
                </Link>
              ) : (
                <div className={rowClass}>{row}</div>
              )}
            </li>
          )
        })}
      </ul>
    </>
  )
}

type TriggerProps = Pick<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-haspopup' | 'aria-expanded' | 'aria-controls' | 'onClick' | 'onPointerEnter' | 'onPointerLeave' | 'onFocus' | 'onBlur'
>

type ContentProps = Pick<
  React.ComponentPropsWithoutRef<typeof PopoverContent>,
  'id' | 'role' | 'onOpenAutoFocus' | 'onCloseAutoFocus' | 'onInteractOutside' | 'onPointerEnter' | 'onPointerLeave' | 'onBlur'
>

/**
 * One popover, several triggers. A mouse opens it on hover, a keyboard on
 * focus, a tap or click pins it open; Escape and an outside click close it
 * (Radix handles those). Spread `triggerProps` on each trigger and
 * `contentProps` on the PopoverContent; put `anchorRef` on the anchor that
 * wraps the triggers.
 */
function useHoverPopover() {
  const contentId = useId()
  const [open, setOpen] = useState(false)
  const pinned = useRef(false)
  const openTimer = useRef<number | undefined>(undefined)
  const closeTimer = useRef<number | undefined>(undefined)
  const anchorRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const lastTrigger = useRef<HTMLElement | null>(null)
  const restoreFocus = useRef(false)

  useEffect(
    () => () => {
      window.clearTimeout(openTimer.current)
      window.clearTimeout(closeTimer.current)
    },
    []
  )

  const clearTimers = () => {
    window.clearTimeout(openTimer.current)
    window.clearTimeout(closeTimer.current)
  }
  const show = () => {
    clearTimers()
    setOpen(true)
  }
  const hide = () => {
    clearTimers()
    restoreFocus.current = Boolean(contentRef.current?.contains(document.activeElement))
    pinned.current = false
    setOpen(false)
  }
  const scheduleClose = () => {
    window.clearTimeout(openTimer.current)
    if (pinned.current) return
    window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(hide, HOVER_CLOSE_MS)
  }
  const isInside = (node: EventTarget | null) =>
    node instanceof Node && Boolean(contentRef.current?.contains(node) || anchorRef.current?.contains(node))
  const onBlur = (e: React.FocusEvent) => {
    if (!isInside(e.relatedTarget)) scheduleClose()
  }

  const triggerProps: TriggerProps = {
    'aria-haspopup': 'dialog',
    'aria-expanded': open,
    'aria-controls': contentId,
    onClick: (e) => {
      lastTrigger.current = e.currentTarget
      if (open && pinned.current) {
        hide()
        return
      }
      // Enter or Space on a trigger whose focus already opened the popover:
      // move focus to the first row so the list can be tabbed through.
      const fromKeyboardWhileOpen = e.detail === 0 && open
      pinned.current = true
      show()
      if (fromKeyboardWhileOpen) {
        window.requestAnimationFrame(() => contentRef.current?.querySelector<HTMLElement>('a[href]')?.focus())
      }
    },
    onPointerEnter: (e) => {
      if (e.pointerType !== 'mouse') return
      clearTimers()
      openTimer.current = window.setTimeout(() => setOpen(true), HOVER_OPEN_MS)
    },
    onPointerLeave: (e) => {
      if (e.pointerType === 'mouse') scheduleClose()
    },
    onFocus: (e) => {
      lastTrigger.current = e.currentTarget
      if (e.currentTarget.matches(':focus-visible')) show()
    },
    onBlur,
  }

  const contentProps: ContentProps = {
    id: contentId,
    role: 'dialog',
    // Hover and focus opens leave focus on the trigger; a tap or Enter moves
    // it in so the rows can be tabbed through.
    onOpenAutoFocus: (e) => {
      if (!pinned.current) e.preventDefault()
    },
    onCloseAutoFocus: (e) => {
      e.preventDefault()
      if (restoreFocus.current) lastTrigger.current?.focus()
      restoreFocus.current = false
    },
    // The triggers toggle on their own click; don't let the pointerdown close
    // it first and the click reopen it. Focus moving between triggers stays open.
    onInteractOutside: (e) => {
      if (anchorRef.current?.contains(e.target as Node)) e.preventDefault()
    },
    onPointerEnter: (e) => {
      if (e.pointerType === 'mouse') window.clearTimeout(closeTimer.current)
    },
    onPointerLeave: (e) => {
      if (e.pointerType === 'mouse') scheduleClose()
    },
    onBlur,
  }

  return {
    open,
    onOpenChange: (next: boolean) => (next ? show() : hide()),
    anchorRef,
    contentRef,
    triggerProps,
    contentProps,
  }
}
