// Pure helpers for the console's Branding and Configuration tabs (no React,
// no app config), so they can be unit tested on their own.

import type { OrgImageSlot, OrgMenuItem } from '@services/ee/platform/types'

/** Storage folder of each image slot (content/orgs/{uuid}/{folder}/{file}). */
export const IMAGE_FOLDERS: Record<OrgImageSlot, string> = {
  logo: 'logos',
  square_logo: 'square_logos',
  favicon: 'favicons',
  thumbnail: 'thumbnails',
  og_image: 'og_images',
  auth_background: 'auth_backgrounds',
  preview: 'previews',
}

export type ImageShape = 'wide' | 'square' | 'icon' | 'banner'

/** Slots in display order, with the box shape and recommended size. */
export const IMAGE_SLOTS: { slot: Exclude<OrgImageSlot, 'preview'>; shape: ImageShape; size: string }[] = [
  { slot: 'logo', shape: 'wide', size: '600 × 200' },
  { slot: 'square_logo', shape: 'square', size: '512 × 512' },
  { slot: 'favicon', shape: 'icon', size: '64 × 64' },
  { slot: 'thumbnail', shape: 'banner', size: '1200 × 630' },
  { slot: 'og_image', shape: 'banner', size: '1200 × 630' },
  { slot: 'auth_background', shape: 'banner', size: '1920 × 1080' },
]

export const MAX_PREVIEWS = 4
export const MAX_LINKS = 3
export const SOCIAL_KEYS = ['twitter', 'facebook', 'instagram', 'linkedin', 'youtube'] as const

/** Path under the media root, or the value itself when it is already a URL. */
export function orgImagePath(slot: OrgImageSlot, orgUuid: string | undefined, filename: string | null | undefined): string | null {
  if (!filename || !orgUuid) return null
  if (/^https?:\/\//i.test(filename)) return filename
  return `content/orgs/${orgUuid}/${IMAGE_FOLDERS[slot]}/${filename}`
}

export function isHttpUrl(value: string): boolean {
  const v = value.trim()
  return /^https?:\/\/[^\s]+$/i.test(v)
}

/** A menu link target the API accepts: an internal path or an http(s) URL. */
export function isMenuUrl(value: string): boolean {
  const v = value.trim()
  if (!v) return true
  return isHttpUrl(v) || (v.startsWith('/') && !v.startsWith('//'))
}

/** "#ABC" / "abc" / "#aabbcc" → "#aabbcc"; "" stays ""; null when invalid. */
export function normalizeHex(value: string): string | null {
  const v = value.trim()
  if (!v) return ''
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(v)
  if (!m) return null
  const digits = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1]
  return `#${digits.toLowerCase()}`
}

/** Menu items by their saved order, renumbered 0..n. */
export function sortedMenu(items: OrgMenuItem[]): OrgMenuItem[] {
  return [...items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((item, i) => ({ ...item, order: i }))
}

/** Move one item up (-1) or down (+1); out-of-range moves return the list unchanged. */
export function moveItem<T extends { order: number }>(items: T[], index: number, dir: -1 | 1): T[] {
  const target = index + dir
  if (index < 0 || target < 0 || target >= items.length) return items
  const next = [...items]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next.map((item, i) => ({ ...item, order: i }))
}

/** Structural equality for drafts (key order ignored). */
export function sameValue(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b)
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

export interface ChangeRow {
  path: string
  from: string
  to: string
}

/** Audit `changes` as rows, the path made readable ("customization.theme.radius" → "theme › radius"). */
export function changeRows(changes: unknown, max = 8): ChangeRow[] {
  if (!changes || typeof changes !== 'object') return []
  return Object.entries(changes as Record<string, { from?: unknown; to?: unknown }>)
    .slice(0, max)
    .map(([path, v]) => ({ path: readablePath(path), from: formatValue(v?.from), to: formatValue(v?.to) }))
}

export function readablePath(path: string): string {
  return path
    .replace(/^customization\./, '')
    .replace(/^org\./, '')
    .replace(/^admin_toggles\./, '')
    .replace(/_image$/, '')
    .split('.')
    .map((p) => p.replace(/_/g, ' '))
    .join(' › ')
}

/** A short display value: "—" for empty, JSON (clipped) for objects. */
export function formatValue(value: unknown, max = 60): string {
  if (value === null || value === undefined || value === '') return '—'
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** Number of changed fields in a write result (0 when nothing changed). */
export function changeCount(changes: unknown): number {
  return changes && typeof changes === 'object' ? Object.keys(changes).length : 0
}
