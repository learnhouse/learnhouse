// Splits a message body into markdown and the interactive blocks agents can
// write (```quiz, ```flashcards, ```steps, ```course, plus the ones in
// MoreBlocks.tsx: ```chart, ```mindmap, ```timeline, ```exercise, ```reminder). See RICH_BLOCKS_PROMPT
// in apps/api/src/services/messaging/agents.py for the shapes.

import {
  validateMore,
  type ChartData,
  type ExerciseData,
  type MindmapData,
  type MoreBlockKind,
  type ReminderData,
  type TimelineData,
} from './MoreBlocks'

export type RichBlockKind = 'quiz' | 'flashcards' | 'steps' | 'course' | MoreBlockKind

export type QuizData = {
  questions: { question: string; options: string[]; answer: number; explanation?: string }[]
}
export type FlashcardsData = { cards: { front: string; back: string }[] }
export type StepsData = { title?: string; steps: { title: string; detail?: string }[] }
export type CourseBlockData = { course_uuid: string; reason?: string }

export type Segment =
  | { type: 'markdown'; text: string }
  | { type: 'quiz'; data: QuizData }
  | { type: 'flashcards'; data: FlashcardsData }
  | { type: 'steps'; data: StepsData }
  | { type: 'course'; data: CourseBlockData }
  | { type: 'chart'; data: ChartData }
  | { type: 'mindmap'; data: MindmapData }
  | { type: 'timeline'; data: TimelineData }
  | { type: 'exercise'; data: ExerciseData }
  /** ``index`` is its position among the reply's reminders (matches attachment.reminders). */
  | { type: 'reminder'; data: ReminderData; index: number }
  /** A rich block still streaming in. */
  | { type: 'pending'; kind: RichBlockKind }

const RICH_KINDS = 'quiz|flashcards|steps|course|chart|mindmap|timeline|exercise|reminder'
const COMPLETE_BLOCK = new RegExp('```(' + RICH_KINDS + ')[^\\S\\n]*\\n([\\s\\S]*?)\\n?```', 'g')
const OPEN_BLOCK = new RegExp('```(' + RICH_KINDS + ')\\b[\\s\\S]*$')

function validate(kind: RichBlockKind, data: any): boolean {
  if (!data || typeof data !== 'object') return false
  switch (kind) {
    case 'quiz':
      return (
        Array.isArray(data.questions) &&
        data.questions.length > 0 &&
        data.questions.every(
          (q: any) =>
            typeof q?.question === 'string' &&
            Array.isArray(q.options) &&
            q.options.length >= 2 &&
            Number.isInteger(q.answer) &&
            q.answer >= 0 &&
            q.answer < q.options.length
        )
      )
    case 'flashcards':
      return (
        Array.isArray(data.cards) &&
        data.cards.length > 0 &&
        data.cards.every((c: any) => typeof c?.front === 'string' && typeof c?.back === 'string')
      )
    case 'steps':
      return Array.isArray(data.steps) && data.steps.length > 0 && data.steps.every((s: any) => typeof s?.title === 'string')
    case 'course':
      return typeof data.course_uuid === 'string'
    default:
      return validateMore(kind, data)
  }
}

export function parseSegments(content: string, streaming: boolean): Segment[] {
  const segments: Segment[] = []
  let last = 0
  const push = (text: string) => {
    if (text.trim()) segments.push({ type: 'markdown', text })
  }
  COMPLETE_BLOCK.lastIndex = 0
  let reminders = 0
  let match: RegExpExecArray | null
  while ((match = COMPLETE_BLOCK.exec(content)) !== null) {
    push(content.slice(last, match.index))
    const kind = match[1] as RichBlockKind
    let parsed: any = null
    try {
      parsed = JSON.parse(match[2])
    } catch {
      parsed = null
    }
    if (validate(kind, parsed)) {
      if (kind === 'reminder') {
        segments.push({ type: 'reminder', data: parsed, index: reminders++ })
      } else {
        segments.push({ type: kind, data: parsed } as Segment)
      }
    } else {
      // Not usable as UI: show what the model wrote as a code block.
      push('```json\n' + match[2] + '\n```')
    }
    last = match.index + match[0].length
  }
  const rest = content.slice(last)
  const open = streaming ? OPEN_BLOCK.exec(rest) : null
  if (open) {
    push(rest.slice(0, open.index))
    segments.push({ type: 'pending', kind: open[1] as RichBlockKind })
  } else {
    push(rest)
  }
  return segments
}

/** 1 to 3 emoji and nothing else: rendered large, like every chat app. */
export function isEmojiOnly(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > 32) return false
  if (!/^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|‍|️|⃣|\s)+$/u.test(trimmed)) {
    return false
  }
  const Seg = (Intl as any).Segmenter
  const count = Seg
    ? [...new Seg(undefined, { granularity: 'grapheme' }).segment(trimmed.replace(/\s+/g, ''))].length
    : Array.from(trimmed.replace(/\s+/g, '')).length
  return count >= 1 && count <= 3
}

export type InlinePart =
  | { kind: 'text'; value: string }
  | { kind: 'citation'; nums: number[] }
  | { kind: 'url'; value: string }

const INLINE = /\[(\d+(?:\s*,\s*\d+)*)\]|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"\]])/g

/** Split text into plain runs, [n] citations and bare URLs. */
export function splitInline(text: string, withCitations: boolean): InlinePart[] {
  const parts: InlinePart[] = []
  let last = 0
  INLINE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = INLINE.exec(text)) !== null) {
    if (m[1] && !withCitations) continue
    if (m.index > last) parts.push({ kind: 'text', value: text.slice(last, m.index) })
    if (m[1]) {
      parts.push({ kind: 'citation', nums: m[1].split(',').map((n) => parseInt(n.trim(), 10)).filter((n) => !isNaN(n)) })
    } else {
      parts.push({ kind: 'url', value: m[2] })
    }
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ kind: 'text', value: text.slice(last) })
  return parts
}

export type CalloutKind = 'tip' | 'note' | 'warning' | 'important' | 'caution'

export const CALLOUT_MARKER = /^\s*\[!(TIP|NOTE|WARNING|IMPORTANT|CAUTION)\]\s*/i

/** The callout kind a blockquote's hast node opens with, if any. */
export function calloutKind(node: any): CalloutKind | null {
  let first: any = node
  // Walk to the first text node.
  while (first && first.type !== 'text') {
    const children = (first.children || []).filter((c: any) => !(c.type === 'text' && !c.value.trim()))
    first = children[0]
  }
  const m = first?.value ? CALLOUT_MARKER.exec(first.value) : null
  return m ? (m[1].toLowerCase() as CalloutKind) : null
}
