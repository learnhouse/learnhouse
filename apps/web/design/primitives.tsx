'use client'
import React from 'react'
import { Chip, type ChipTone } from '@components/Dashboard/Shared/DashKit/DashKit'
import { recipes } from './recipes'

// Small pieces the redesigned pages were writing out by hand (each pattern
// appears in three or more of them). They render the same classes those pages
// use, so adopting one is a no-op visually. Everything bigger lives in DashKit.

// ─── DashPage ────────────────────────────────────────────────────────────────

const PAGE_BOTTOM = { md: 'pb-10', lg: 'pb-16', xl: 'pb-24' } as const

/**
 * The page body under the main tab bar: gutters (px-4 → sm:px-10), a gap-5
 * rhythm between blocks and min-w-0 so wide children never push the page
 * sideways. Put <DashPageHeader> as its first child.
 * `bottom="xl"` leaves room for a BulkActionBar or StickySaveBar.
 */
export function DashPage({
  bottom = 'md',
  className = '',
  children,
}: {
  bottom?: keyof typeof PAGE_BOTTOM
  className?: string
  children: React.ReactNode
}) {
  return <div className={`${recipes.pageShell.replace('pb-10', PAGE_BOTTOM[bottom])} ${className}`}>{children}</div>
}

// ─── Panel ───────────────────────────────────────────────────────────────────

/**
 * The white card (bg-white rounded-2xl nice-shadow). `divided` turns it into a
 * list container (rows split by hairlines, corners clipped); `padded` adds the
 * standard p-5. For a card with a title row use DashKit's SectionCard.
 */
export function Panel({
  as: Tag = 'div',
  divided = false,
  padded = false,
  className = '',
  children,
  ...rest
}: {
  as?: 'div' | 'section' | 'ul' | 'ol' | 'article'
  divided?: boolean
  padded?: boolean
  className?: string
  children?: React.ReactNode
} & Omit<React.HTMLAttributes<HTMLElement>, 'className' | 'children'>) {
  const base = divided ? recipes.listCard : recipes.card
  return (
    <Tag className={`${base} ${padded ? 'p-5' : ''} ${className}`} {...rest}>
      {children}
    </Tag>
  )
}

// ─── Toolbar ─────────────────────────────────────────────────────────────────

/**
 * The row above a list: search first (it grows), filters and view toggles at
 * the end. Stacks on phones, one line from xl.
 *
 *   <Toolbar end={<><ToolbarSelect … /><ViewToggle … /></>}>
 *     <SearchInput className="xl:max-w-md" … />
 *   </Toolbar>
 */
export function Toolbar({
  end,
  className = '',
  children,
}: {
  end?: React.ReactNode
  className?: string
  children?: React.ReactNode
}) {
  return (
    <div className={`${recipes.toolbar} ${className}`}>
      {children}
      {end && <div className={recipes.toolbarEnd}>{end}</div>}
    </div>
  )
}

// ─── Eyebrow ─────────────────────────────────────────────────────────────────

/** Small uppercase label above a group of rows or a stat. */
export function Eyebrow({
  as: Tag = 'p',
  className = '',
  children,
}: {
  as?: 'p' | 'span' | 'h2' | 'h3' | 'div'
  className?: string
  children: React.ReactNode
}) {
  return <Tag className={`${recipes.eyebrow} ${className}`}>{children}</Tag>
}

// ─── Status ──────────────────────────────────────────────────────────────────

export type Status = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'ai'

/** Semantic status → DashKit chip hue. Violet is reserved for AI. */
export const STATUS_TONE: Record<Status, ChipTone> = {
  neutral: 'neutral',
  success: 'emerald',
  warning: 'amber',
  danger: 'rose',
  info: 'sky',
  ai: 'violet',
}

const STATUS_DOT: Record<Status, string> = {
  neutral: 'bg-neutral-400',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-rose-500',
  info: 'bg-sky-500',
  ai: 'bg-violet-500',
}

/**
 * A status dot. Decorative by default (pair it with text); pass `label` when
 * the dot stands alone so screen readers hear the status.
 */
export function StatusDot({ status = 'neutral', label, className = '' }: { status?: Status; label?: string; className?: string }) {
  return (
    <span
      className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[status]} ${className}`}
      {...(label ? { role: 'img', 'aria-label': label, title: label } : { 'aria-hidden': true })}
    />
  )
}

/**
 * A status label: a DashKit Chip picked by meaning instead of hue, with an
 * optional leading dot ("Published", "Draft", "Failed").
 */
export function StatusPill({
  status = 'neutral',
  dot = false,
  icon,
  title,
  className = '',
  children,
}: {
  status?: Status
  dot?: boolean
  icon?: React.ReactNode
  title?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <Chip tone={STATUS_TONE[status]} icon={dot ? <StatusDot status={status} /> : icon} title={title} className={className}>
      {children}
    </Chip>
  )
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

/** Grey pulsing block for loading states. Size it: <Skeleton className="h-4 w-32" />. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`${recipes.skeleton} ${className}`} />
}
