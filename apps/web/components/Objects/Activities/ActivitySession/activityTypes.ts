// What every surface needs to show an activity outside the lesson page: its
// kind (icon, colored tile, label), the learner's progress on it, and the
// course URLs. Pure helpers, shared by ActivitySession and its hosts (the
// board activity block).

import type { Icon } from '@phosphor-icons/react'
import {
  Article,
  Broadcast,
  ClipboardText,
  FilePdf,
  Globe,
  Lightning,
  MarkdownLogo,
  Package,
  Paperclip,
  PlayCircle,
  PuzzlePiece,
} from '@phosphor-icons/react'

export interface ActivityKind {
  icon: Icon
  /** Tile classes, the dashboard KPI recipe (soft fill + colored glyph). */
  tile: string
  /** i18n key of the kind's name (existing course-structure labels). */
  labelKey: string
}

const TYPES = 'dashboard.courses.structure.activity.types'

export function activityKind(type?: string | null, subType?: string | null): ActivityKind {
  switch (type) {
    case 'TYPE_DYNAMIC':
      if (subType === 'SUBTYPE_DYNAMIC_MARKDOWN') return { icon: MarkdownLogo, tile: 'bg-slate-100 text-slate-600', labelKey: `${TYPES}.markdown` }
      if (subType === 'SUBTYPE_DYNAMIC_EMBED') return { icon: Globe, tile: 'bg-cyan-50 text-cyan-600', labelKey: `${TYPES}.embed` }
      if (subType === 'SUBTYPE_DYNAMIC_RESOURCE') return { icon: Paperclip, tile: 'bg-lime-50 text-lime-700', labelKey: `${TYPES}.resource` }
      return { icon: Article, tile: 'bg-sky-50 text-sky-600', labelKey: `${TYPES}.dynamic_page` }
    case 'TYPE_VIDEO':
      return { icon: PlayCircle, tile: 'bg-rose-50 text-rose-600', labelKey: `${TYPES}.video` }
    case 'TYPE_DOCUMENT':
      return { icon: FilePdf, tile: 'bg-orange-50 text-orange-600', labelKey: `${TYPES}.document` }
    case 'TYPE_ASSIGNMENT':
      return { icon: ClipboardText, tile: 'bg-amber-50 text-amber-600', labelKey: `${TYPES}.assignment` }
    case 'TYPE_SCORM':
      return { icon: Package, tile: 'bg-teal-50 text-teal-600', labelKey: `${TYPES}.scorm` }
    case 'TYPE_LIVE_SESSION':
      return { icon: Broadcast, tile: 'bg-red-50 text-red-600', labelKey: `${TYPES}.livesession` }
    case 'TYPE_PLAY':
      return { icon: Lightning, tile: 'bg-emerald-50 text-emerald-600', labelKey: `${TYPES}.play` }
    default:
      return { icon: PuzzlePiece, tile: 'bg-neutral-100 text-neutral-500', labelKey: `${TYPES}.dynamic_page` }
  }
}

export const cleanActivityUuid = (uuid: string) => uuid.replace(/^activity_/, '')
export const cleanCourseUuid = (uuid: string) => uuid.replace(/^course_/, '')
export const fullActivityUuid = (uuid: string) => (uuid.startsWith('activity_') ? uuid : `activity_${uuid}`)

/** The activity's entry in the course tree (name, type, numeric id, lock flags). */
export function findCourseActivity(course: any, activityUuid: string): any | null {
  const want = cleanActivityUuid(activityUuid)
  for (const ch of Array.isArray(course?.chapters) ? course.chapters : []) {
    for (const a of Array.isArray(ch?.activities) ? ch.activities : []) {
      if (typeof a?.activity_uuid === 'string' && cleanActivityUuid(a.activity_uuid) === want) return { ...a, chapterName: ch.name }
    }
  }
  return null
}

export type ActivityProgress = 'not_started' | 'in_progress' | 'completed'

/** The viewer's run for a course in their trail. */
export function courseRun(trail: any, courseUuid: string): any | null {
  const want = cleanCourseUuid(courseUuid || '')
  const runs = Array.isArray(trail?.runs) ? trail.runs : []
  return runs.find((r: any) => cleanCourseUuid(String(r?.course?.course_uuid ?? '')) === want) ?? null
}

/**
 * Completed: a complete trail step for the activity. In progress: the viewer
 * started the course (has a run) or opened this activity here before.
 */
export function activityProgress(trail: any, courseUuid: string, activityId: number | undefined, openedHere = false): ActivityProgress {
  const run = courseRun(trail, courseUuid)
  const steps = Array.isArray(run?.steps) ? run.steps : []
  if (activityId != null && steps.some((s: any) => s?.activity_id === activityId && s?.complete === true)) return 'completed'
  if (openedHere) return 'in_progress'
  return run ? 'in_progress' : 'not_started'
}

/** Every activity of the course done (drives the certificate link). */
export function courseCompleted(trail: any, course: any): boolean {
  const run = courseRun(trail, course?.course_uuid ?? '')
  if (!run) return false
  const done = new Set((Array.isArray(run.steps) ? run.steps : []).filter((s: any) => s?.complete).map((s: any) => s.activity_id))
  const all = (Array.isArray(course?.chapters) ? course.chapters : []).flatMap((ch: any) => (Array.isArray(ch?.activities) ? ch.activities : []))
  return all.length > 0 && all.every((a: any) => done.has(a.id))
}

const OPENED_KEY = 'lh-activity-opened:'

/** Per-browser memory that the viewer opened an activity (a convenience only). */
export function rememberOpened(activityUuid: string) {
  try {
    window.localStorage.setItem(OPENED_KEY + cleanActivityUuid(activityUuid), '1')
  } catch {
    /* storage blocked: the status just stays "not started" */
  }
}

export function wasOpened(activityUuid: string): boolean {
  try {
    return window.localStorage.getItem(OPENED_KEY + cleanActivityUuid(activityUuid)) === '1'
  } catch {
    return false
  }
}
