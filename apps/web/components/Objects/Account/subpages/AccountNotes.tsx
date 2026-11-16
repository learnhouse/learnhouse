'use client'
import React, { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight, BookOpenText, DownloadSimple, Lock, Notepad, Play, Printer, Quotes } from '@phosphor-icons/react'
import { EmptyState, SearchInput, ToolbarSelect, buttonClass } from '@/design'
import { useOrg } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { formatDate } from '@/lib/format'
import { formatTimestamp, notesToMarkdown } from '@/lib/notes/noteMarkdown'
import type { LearnerNoteWithContext } from '@services/notes/notes'
import NoteView from '@components/Objects/Activities/Notes/NoteView'
import { useMyNotes } from '@components/Objects/Activities/Notes/useNotes'
import { AccountSectionHeader } from '@components/Objects/Account/AccountSection'

type CourseGroup = {
  course: LearnerNoteWithContext['course']
  lessons: { activity: LearnerNoteWithContext['activity']; notes: LearnerNoteWithContext[] }[]
  count: number
}

const clean = (uuid: string, prefix: string) => uuid.replace(prefix, '')

function lessonPath(note: LearnerNoteWithContext) {
  return `/course/${clean(note.course_uuid, 'course_')}/activity/${clean(note.activity_uuid, 'activity_')}`
}

/** Where a note points in its lesson: ?t= for a video moment, #heading for a section. */
function noteSpot(note: LearnerNoteWithContext): string {
  const a = note.anchor
  if (a?.kind === 'video' && a.seconds != null) return `${lessonPath(note)}?t=${a.seconds}`
  if (a?.kind === 'heading' && a.ref) return `${lessonPath(note)}#${encodeURIComponent(a.ref)}`
  return lessonPath(note)
}

function slugFile(name: string) {
  return (name || 'notes').normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 60) || 'notes'
}

/**
 * Account → My notes: every private note the learner took in this org,
 * grouped by course and lesson, searchable, with a jump back to the spot in
 * the lesson, a Markdown export per course and a print view.
 */
export default function AccountNotes() {
  const { t, i18n } = useTranslation()
  const router = useRouter()
  const org = useOrg() as any
  const orgslug: string = org?.slug ?? ''
  const { data, isLoading, isError } = useMyNotes(org?.id)
  const notes = useMemo(() => (Array.isArray(data?.notes) ? data!.notes : []), [data])
  const [query, setQuery] = useState('')
  const [courseFilter, setCourseFilter] = useState('all')
  const [printing, setPrinting] = useState<string | null>(null)

  const courseOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const n of notes) if (!seen.has(n.course_uuid)) seen.set(n.course_uuid, n.course.name)
    return [
      { value: 'all', label: t('notes.all_courses', { defaultValue: 'All courses' }) },
      ...Array.from(seen, ([value, label]) => ({ value, label })),
    ]
  }, [notes, t])

  const groups: CourseGroup[] = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matches = (n: LearnerNoteWithContext) =>
      !q ||
      n.plain_text.toLowerCase().includes(q) ||
      n.activity.name.toLowerCase().includes(q) ||
      n.course.name.toLowerCase().includes(q) ||
      (n.anchor?.label || '').toLowerCase().includes(q)
    const byCourse = new Map<string, CourseGroup>()
    for (const n of notes) {
      if (courseFilter !== 'all' && n.course_uuid !== courseFilter) continue
      if (!matches(n)) continue
      let group = byCourse.get(n.course_uuid)
      if (!group) {
        group = { course: n.course, lessons: [], count: 0 }
        byCourse.set(n.course_uuid, group)
      }
      let lesson = group.lessons.find((l) => l.activity.activity_uuid === n.activity_uuid)
      if (!lesson) {
        lesson = { activity: n.activity, notes: [] }
        group.lessons.push(lesson)
      }
      lesson.notes.push(n)
      group.count += 1
    }
    // Within a lesson, notes follow the lesson: video moments in order, then the rest oldest first.
    for (const g of byCourse.values()) {
      for (const l of g.lessons) {
        l.notes.sort((a, b) => {
          const sa = a.anchor?.kind === 'video' ? a.anchor.seconds ?? 0 : Infinity
          const sb = b.anchor?.kind === 'video' ? b.anchor.seconds ?? 0 : Infinity
          return sa !== sb ? sa - sb : a.created_at.localeCompare(b.created_at)
        })
      }
    }
    return Array.from(byCourse.values())
  }, [notes, query, courseFilter])

  const exportCourse = (group: CourseGroup) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const toUrl = (path: string) => {
      const uri = getUriWithOrg(orgslug, path)
      return uri.startsWith('http') ? uri : `${origin}${uri}`
    }
    const md = notesToMarkdown(
      group.course.name,
      group.lessons.flatMap((l) =>
        l.notes.map((n) => ({
          content: rewriteHashLinks(n.content, (hash) => toUrl(`${lessonPath(n)}${hash}`)),
          anchor: n.anchor,
          updated_at: n.updated_at,
          activity: { name: l.activity.name, chapter_name: l.activity.chapter_name, url: toUrl(lessonPath(n)) },
        }))
      ),
      {
        exported: t('notes.exported_on', { defaultValue: 'Exported on' }),
        at: (time) => t('notes.at_time', { defaultValue: 'At {{time}}', time }),
      },
      formatDate(new Date().toISOString(), i18n.language)
    )
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${slugFile(group.course.slug || group.course.name)}-notes.md`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  // Print one course: the page marks it, prints, and puts things back.
  useEffect(() => {
    if (!printing) return
    document.documentElement.classList.add('lh-printing-notes')
    const done = () => {
      document.documentElement.classList.remove('lh-printing-notes')
      setPrinting(null)
    }
    window.addEventListener('afterprint', done, { once: true })
    const id = requestAnimationFrame(() => window.print())
    return () => {
      cancelAnimationFrame(id)
      window.removeEventListener('afterprint', done)
      document.documentElement.classList.remove('lh-printing-notes')
    }
  }, [printing])

  const openHash = (note: LearnerNoteWithContext, href: string) => {
    if (href.startsWith('#')) router.push(getUriWithOrg(orgslug, `${lessonPath(note)}${href}`))
    else router.push(getUriWithOrg(orgslug, href))
  }

  return (
    <>
      <AccountSectionHeader
        title={t('notes.title', { defaultValue: 'My notes' })}
        description={t('notes.page_subtitle', {
          defaultValue: 'The notes you took on lessons, by course. Only you can see them.',
        })}
      />

      {notes.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-2 print:hidden">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder={t('notes.search_placeholder', { defaultValue: 'Search your notes' })}
            className="flex-1 min-w-[200px]"
          />
          <ToolbarSelect
            value={courseFilter}
            onChange={setCourseFilter}
            options={courseOptions}
            ariaLabel={t('notes.filter_course', { defaultValue: 'Course' })}
            icon={<BookOpenText size={14} />}
          />
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3" aria-busy>
          {[0, 1].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-2xl bg-white nice-shadow" />
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-2xl bg-white nice-shadow">
          <EmptyState icon={<Notepad size={22} />} title={t('notes.load_failed', { defaultValue: 'Your notes could not be loaded.' })} />
        </div>
      ) : notes.length === 0 ? (
        <div className="rounded-2xl bg-white nice-shadow">
          <EmptyState
            icon={<Notepad size={22} weight="duotone" className="text-amber-600" />}
            title={t('notes.none_title', { defaultValue: 'No notes yet' })}
            description={t('notes.none_hint', {
              defaultValue: 'Open a lesson and press Notes (or N) to write one. Select lesson text to save a quote.',
            })}
          />
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-2xl bg-white nice-shadow">
          <EmptyState icon={<Notepad size={22} />} title={t('notes.no_match', { defaultValue: 'No notes match your search' })} />
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map((group) => (
            <section
              key={group.course.course_uuid}
              className="lh-notes-course rounded-2xl bg-white nice-shadow overflow-hidden"
              data-print-root={printing === group.course.course_uuid ? '' : undefined}
              aria-label={group.course.name}
            >
              <header className="flex flex-wrap items-center gap-3 border-b border-neutral-100 px-4 py-3 sm:px-5">
                <img
                  src={
                    group.course.thumbnail_image
                      ? getCourseThumbnailMediaDirectory(org?.org_uuid, group.course.course_uuid, group.course.thumbnail_image)
                      : '/empty_thumbnail.png'
                  }
                  onError={(e) => {
                    if (!e.currentTarget.src.endsWith('/empty_thumbnail.png')) e.currentTarget.src = '/empty_thumbnail.png'
                  }}
                  alt=""
                  className="h-9 w-16 shrink-0 rounded-md object-cover ring-1 ring-black/5"
                />
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-[15px] font-semibold text-neutral-900" dir="auto">{group.course.name}</h2>
                  <p className="text-xs text-neutral-500">{t('notes.count', { count: group.count, defaultValue: '{{count}} notes' })}</p>
                </div>
                <div className="flex items-center gap-2 print:hidden">
                  <button type="button" onClick={() => exportCourse(group)} className={buttonClass('secondary', 'sm')}>
                    <DownloadSimple size={13} weight="bold" />
                    {t('notes.export_md', { defaultValue: 'Export Markdown' })}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPrinting(group.course.course_uuid)}
                    className={buttonClass('secondary', 'icon')}
                    aria-label={t('notes.print', { defaultValue: 'Print' })}
                    title={t('notes.print', { defaultValue: 'Print' })}
                  >
                    <Printer size={14} />
                  </button>
                </div>
              </header>
              <div className="divide-y divide-neutral-100">
                {group.lessons.map((lesson) => (
                  <div key={lesson.activity.activity_uuid} className="px-4 py-4 sm:px-5">
                    <div className="mb-3 flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        {lesson.activity.chapter_name && (
                          <p className="truncate text-[11px] font-medium text-neutral-400" dir="auto">{lesson.activity.chapter_name}</p>
                        )}
                        <Link
                          href={getUriWithOrg(orgslug, lessonPath(lesson.notes[0]))}
                          className="text-sm font-semibold text-neutral-800 hover:text-neutral-950 hover:underline underline-offset-2"
                          dir="auto"
                        >
                          {lesson.activity.name}
                        </Link>
                      </div>
                    </div>
                    <ul className="grid gap-2.5 md:grid-cols-2">
                      {lesson.notes.map((note) => (
                        <li key={note.note_uuid} className="lh-note-print group flex flex-col rounded-xl bg-neutral-50/70 p-3 ring-1 ring-neutral-200/70">
                          <div className="mb-1.5 flex items-center gap-2 min-h-6">
                            {note.anchor?.kind === 'video' && note.anchor.seconds != null ? (
                              <span className="inline-flex h-6 items-center gap-1 rounded-md bg-sky-50 px-1.5 text-xs font-semibold tabular-nums text-sky-700 ring-1 ring-inset ring-sky-600/15">
                                <Play size={11} weight="fill" className="rtl:-scale-x-100" />
                                {formatTimestamp(note.anchor.seconds)}
                              </span>
                            ) : note.anchor?.label ? (
                              <span className="inline-flex h-6 min-w-0 items-center gap-1 rounded-md bg-amber-50 px-1.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-600/15">
                                <Quotes size={11} weight="fill" className="shrink-0" />
                                <span className="truncate" dir="auto">{note.anchor.label}</span>
                              </span>
                            ) : null}
                            <span className="ms-auto shrink-0 text-[11px] text-neutral-400">
                              {formatDate(note.updated_at, i18n.language)}
                            </span>
                          </div>
                          <NoteView doc={note.content} onLink={(href) => openHash(note, href)} className="flex-1" />
                          <Link
                            href={getUriWithOrg(orgslug, noteSpot(note))}
                            className="mt-2 inline-flex items-center gap-1 self-start text-xs font-medium text-neutral-500 hover:text-neutral-900 print:hidden"
                          >
                            {note.anchor?.kind === 'video'
                              ? t('notes.open_at_moment', { defaultValue: 'Open at this moment' })
                              : t('notes.open_in_lesson', { defaultValue: 'Open in lesson' })}
                            <ArrowUpRight size={12} weight="bold" className="rtl:-scale-x-100" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          ))}
          <p className="flex items-center gap-1.5 text-xs text-neutral-400 print:hidden">
            <Lock size={11} weight="bold" />
            {t('notes.privacy_footer', {
              defaultValue: 'Your notes are private. They are deleted if you leave this organization or the lesson is removed.',
            })}
          </p>
        </div>
      )}
    </>
  )
}

/** Quote links point at a heading of the lesson (#heading-…): make them absolute for the export. */
function rewriteHashLinks(doc: any, toUrl: (_hash: string) => string): any {
  if (!doc || typeof doc !== 'object') return doc
  const out: any = { ...doc }
  if (Array.isArray(doc.marks)) {
    out.marks = doc.marks.map((m: any) =>
      m?.type === 'link' && typeof m.attrs?.href === 'string' && m.attrs.href.startsWith('#')
        ? { ...m, attrs: { ...m.attrs, href: toUrl(m.attrs.href) } }
        : m
    )
  }
  if (Array.isArray(doc.content)) out.content = doc.content.map((c: any) => rewriteHashLinks(c, toUrl))
  return out
}
