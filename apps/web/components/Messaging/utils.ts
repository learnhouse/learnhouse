import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import type { ChatMessage, Presence, UserSummary } from '@services/messaging/messaging'
import { getUserAvatarMediaDirectory } from '@services/media/media'

dayjs.extend(relativeTime)

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '😮', '🙏']

export function avatarUrl(user: Pick<UserSummary, 'avatar_image' | 'user_uuid'> | null | undefined): string {
  if (!user?.avatar_image) return ''
  if (/^https?:\/\//.test(user.avatar_image)) return user.avatar_image
  return getUserAvatarMediaDirectory(user.user_uuid, user.avatar_image)
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

/** Stable pastel per seed, for avatar fallbacks. */
export function seedColor(seed: string | number): string {
  const s = String(seed)
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360
  return `hsl(${h} 55% 88%)`
}

export function seedInk(seed: string | number): string {
  const s = String(seed)
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360
  return `hsl(${h} 45% 30%)`
}

export function shortTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = dayjs(iso)
  if (!d.isValid()) return ''
  const now = dayjs()
  if (d.isSame(now, 'day')) return d.format('HH:mm')
  if (now.diff(d, 'day') < 7) return d.format('ddd')
  if (d.isSame(now, 'year')) return d.format('MMM D')
  return d.format('MMM D, YYYY')
}

export function clockTime(iso: string): string {
  const d = dayjs(iso)
  return d.isValid() ? d.format('HH:mm') : ''
}

export function dayLabel(iso: string): string {
  const d = dayjs(iso)
  const now = dayjs()
  if (d.isSame(now, 'day')) return 'Today'
  if (d.isSame(now.subtract(1, 'day'), 'day')) return 'Yesterday'
  if (now.diff(d, 'day') < 7) return d.format('dddd')
  return d.format(d.isSame(now, 'year') ? 'dddd, MMMM D' : 'MMMM D, YYYY')
}

export function sameDay(a: string, b: string): boolean {
  return dayjs(a).isSame(dayjs(b), 'day')
}

export function presenceLine(p: Presence | undefined): string {
  if (!p) return ''
  const status = p.status_text ? `${p.status_emoji ? p.status_emoji + ' ' : ''}${p.status_text}` : ''
  let state = ''
  if (p.state === 'online') state = 'Online'
  else if (p.state === 'away') state = 'Away'
  else if (p.state === 'dnd') state = 'Do not disturb'
  else if (p.last_seen_at) state = `Last seen ${dayjs(p.last_seen_at).fromNow()}`
  else state = 'Offline'
  return status ? `${state} · ${status}` : state
}

export const PRESENCE_DOT: Record<string, string> = {
  online: 'bg-green-500',
  away: 'bg-amber-400',
  dnd: 'bg-red-500',
}

/** Collapse a sender's consecutive messages within five minutes. */
export function isGrouped(prev: ChatMessage | undefined, cur: ChatMessage): boolean {
  if (!prev || prev.kind === 'system' || cur.kind === 'system') return false
  if (prev.kind === 'announcement' || cur.kind === 'announcement') return false
  if (!prev.sender || !cur.sender) return false
  if (prev.sender.type !== cur.sender.type) return false
  const a = prev.sender.type === 'agent' ? prev.sender.agent_uuid : prev.sender.id
  const b = cur.sender.type === 'agent' ? cur.sender.agent_uuid : cur.sender.id
  if (a !== b) return false
  if (cur.reply_to) return false
  return Math.abs(dayjs(cur.creation_date).diff(dayjs(prev.creation_date), 'minute')) < 5
}

export function senderName(m: ChatMessage): string {
  const s = m.sender
  if (!s) return 'Someone'
  if (s.type === 'agent') return s.name
  return `${s.first_name || ''} ${s.last_name || ''}`.trim() || s.username
}

const BLOCK_LABELS: Record<string, string> = {
  quiz: 'Quiz',
  flashcards: 'Flashcards',
  steps: 'Steps',
  course: 'Course',
  chart: 'Chart',
  mindmap: 'Mind map',
  timeline: 'Timeline',
  exercise: 'Exercise',
  reminder: 'Reminder set',
}

export function previewText(m: ChatMessage | null | undefined): string {
  if (!m) return ''
  if (m.deleted) return 'Message deleted'
  if (m.kind === 'course_share') return `${m.attachment?.course?.name ?? 'Shared a course'}${m.content ? ' · ' + m.content : ''}`
  if (m.kind === 'announcement') return m.content
  if (m.kind === 'reminder') return `Reminder · ${m.content}`
  // Strip the fenced rich blocks agents write so previews stay readable.
  return m.content
    .replace(/```(quiz|flashcards|steps|course|chart|mindmap|timeline|exercise|reminder)[\s\S]*?(```|$)/g, (_, kind: string) => `${BLOCK_LABELS[kind] ?? ''} · `)
    .replace(/[#*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^(\s*·\s*)+|(\s*·\s*)+$/g, '')
    .trim()
}
