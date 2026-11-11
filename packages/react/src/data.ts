import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLearnHouseInternal } from './context'
import type { ActivityDocument, LearnHouseActivityData, LearnHouseActivityProps } from './types'

type Status = 'loading' | 'ready' | 'error'

export interface ActivitySource {
  status: Status
  activity: LearnHouseActivityData | null
  course: any
  org: any
  error: Error | null
  activityUrl: string | null
  retry: () => void
}

const strip = (uuid: string, prefix: string) => uuid.replace(prefix, '')

function asDocument(content: ActivityDocument | string | undefined): any {
  if (typeof content !== 'string') return content
  try {
    return JSON.parse(content)
  } catch {
    return content
  }
}

/**
 * Turns the component's props into { activity, course, org }: from a raw
 * document, an activity object, or the API (by uuid, or by name in a course).
 */
export function useActivitySource(props: LearnHouseActivityProps): ActivitySource {
  const { client } = useLearnHouseInternal()
  const { activityId, activityName, courseId, activity: activityProp, content, orgId, transformContent, siteUrl } = props
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  const local = activityProp !== undefined || content !== undefined
  const [state, setState] = useState<{ status: Status; activity: any; course: any; error: Error | null }>({
    status: local ? 'ready' : 'loading',
    activity: null,
    course: null,
    error: null,
  })

  useEffect(() => {
    if (local && !courseId) return
    if (!client) {
      setState({ status: 'error', activity: null, course: null, error: new Error('Pass `baseUrl`, or render inside <LearnHouseProvider>') })
      return
    }
    if (!local && !activityId && !(activityName && courseId)) {
      setState({ status: 'error', activity: null, course: null, error: new Error('Pass `activityId`, `activityName` with `courseId`, `activity` or `content`') })
      return
    }

    const controller = new AbortController()
    const signal = controller.signal
    setState((s) => ({ ...s, status: local ? s.status : 'loading', error: null }))

    ;(async () => {
      // With a course uuid, the course and the activity load in parallel.
      const metaPromise = courseId ? client.courses.getMeta(courseId, { slim: true, signal }) : null
      // If the activity fails first, the course's own failure is irrelevant.
      metaPromise?.catch(() => {})
      // Same lookup as a server would do with the SDK; the meta request is shared.
      const activity = local
        ? null
        : await client.activities.resolve(
            activityId ? { activityId } : { activityName: activityName!, courseId: courseId! },
            { signal, courseMeta: metaPromise ?? undefined },
          )
      let course = metaPromise ? await metaPromise : null
      if (!course && activity?.course_id != null) {
        // Only the activity was given: find its course for media URLs.
        const base = await client.GET('/api/v1/courses/id/{course_id}', { params: { path: { course_id: activity.course_id } }, signal })
        course = await client.courses.getMeta((base as any).course_uuid, { slim: true, signal })
      }
      return { activity, course }
    })()
      .then(({ activity, course }) => {
        if (signal.aborted) return
        setState({ status: 'ready', activity, course, error: null })
      })
      .catch((error: Error) => {
        if (signal.aborted) return
        setState({ status: 'error', activity: null, course: null, error })
      })

    return () => controller.abort()
  }, [client, local, activityId, activityName, courseId, attempt])

  const activity = useMemo<LearnHouseActivityData | null>(() => {
    let base: any = state.activity
    if (activityProp) base = activityProp
    if (content !== undefined) {
      base = {
        activity_uuid: 'activity_local',
        name: '',
        activity_type: 'TYPE_DYNAMIC',
        activity_sub_type: 'SUBTYPE_DYNAMIC_PAGE',
        published: true,
        content: asDocument(content),
      }
    }
    if (!base) return null
    if (transformContent && base.activity_type === 'TYPE_DYNAMIC' && base.content && typeof base.content === 'object') {
      return { ...base, content: transformContent(base.content) }
    }
    return base
  }, [state.activity, activityProp, content, transformContent])

  const course = state.course ?? { course_uuid: courseId, org_uuid: orgId }
  const org = useMemo(
    () => ({ id: course?.org_id ?? activity?.org_id, org_uuid: course?.org_uuid ?? orgId }),
    [course?.org_id, course?.org_uuid, activity?.org_id, orgId],
  )

  const activityUrl =
    siteUrl && activity && course?.course_uuid
      ? `${siteUrl.replace(/\/+$/, '')}/course/${strip(course.course_uuid, 'course_')}/activity/${strip(activity.activity_uuid, 'activity_')}`
      : null

  return { ...state, activity, course, org, activityUrl, retry }
}
