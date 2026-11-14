'use client'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useCourse } from '@components/Contexts/CourseContext'
import { updateChapter } from '@services/courses/chapters'
import { updateActivity } from '@services/courses/activities'
import { useSectionDraft } from '../courseEditorSave'

type Renames = {
  chapters: Record<string, string>
  activities: Record<string, string>
  // Chapter emoji by chapter id; '' removes it.
  emojis?: Record<string, string>
}

const EMPTY: Renames = { chapters: {}, activities: {}, emojis: {} }

// Chapter and activity names (and chapter emojis) edited inline on the
// Content tab. They are staged here and sent by the header Save, like every
// other field. Creating, deleting, publishing and locking stay immediate actions.
export function useRenameDraft() {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const queryClient = useQueryClient()
  const course = useCourse() as any
  const cleanUuid = String(course?.courseStructure?.course_uuid ?? '').replace(/^course_/, '')

  const draft = useSectionDraft<Renames>('content-names', {
    label: t('dashboard.courses.editor.content.outline_section'),
    tab: 'content',
    validate: (value: Renames) =>
      [...Object.values(value.chapters), ...Object.values(value.activities)].some((name) => !name.trim())
        ? t('dashboard.courses.editor.content.name_required')
        : null,
    save: async (value: Renames) => {
      const failed: string[] = []
      const emojis = value.emojis ?? {}
      // One request per chapter, carrying its new name and/or emoji. The API
      // merges extra_metadata, so other keys on the chapter are kept.
      const chapterIds = new Set([...Object.keys(value.chapters), ...Object.keys(emojis)])
      for (const id of chapterIds) {
        const payload: Record<string, unknown> = {}
        if (id in value.chapters) payload.name = value.chapters[id].trim()
        if (id in emojis) payload.extra_metadata = { emoji: emojis[id] || null }
        try {
          await updateChapter(id, payload, accessToken)
        } catch {
          failed.push(value.chapters[id] ?? emojis[id] ?? id)
        }
      }
      for (const [uuid, name] of Object.entries(value.activities)) {
        const res = await updateActivity({ name: name.trim() }, uuid, accessToken).catch(() => ({ success: false }))
        if (res?.success === false) failed.push(name)
      }
      await queryClient.invalidateQueries({ queryKey: ['course', cleanUuid, 'meta'] })
      if (failed.length > 0) {
        throw new Error(t('dashboard.courses.editor.content.rename_failed', { names: failed.join(', ') }))
      }
    },
  })

  const value = draft.value ?? EMPTY

  const write = (next: Renames) => {
    const empty =
      Object.keys(next.chapters).length === 0 &&
      Object.keys(next.activities).length === 0 &&
      Object.keys(next.emojis ?? {}).length === 0
    if (empty) draft.clear()
    else draft.set(next)
  }

  return {
    chapterName: (id: string | number, fallback: string) => value.chapters[String(id)] ?? fallback,
    activityName: (uuid: string, fallback: string) => value.activities[uuid] ?? fallback,
    isChapterRenamed: (id: string | number) => String(id) in value.chapters || String(id) in (value.emojis ?? {}),
    chapterEmoji: (id: string | number, saved: string) => (value.emojis ?? {})[String(id)] ?? saved,
    // Passing the saved emoji drops the edit; '' means "remove".
    setChapterEmoji: (id: string | number, emoji: string, saved: string) => {
      const emojis = { ...(value.emojis ?? {}) }
      if (emoji === saved) delete emojis[String(id)]
      else emojis[String(id)] = emoji
      write({ ...value, emojis })
    },
    isActivityRenamed: (uuid: string) => uuid in value.activities,
    // Passing the saved name drops the edit instead of staging a no-op.
    renameChapter: (id: string | number, name: string, saved: string) => {
      const chapters = { ...value.chapters }
      if (name === saved) delete chapters[String(id)]
      else chapters[String(id)] = name
      write({ ...value, chapters })
    },
    renameActivity: (uuid: string, name: string, saved: string) => {
      const activities = { ...value.activities }
      if (name === saved) delete activities[uuid]
      else activities[uuid] = name
      write({ ...value, activities })
    },
  }
}
