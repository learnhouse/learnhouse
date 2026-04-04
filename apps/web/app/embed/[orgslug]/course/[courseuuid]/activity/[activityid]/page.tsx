import { getActivityWithAuthHeader } from '@services/courses/activities'
import { getCourseMetadata } from '@services/courses/courses'
import { notFound } from 'next/navigation'
import EmbedActivityClient from './EmbedActivityClient'

type PageProps = {
  params: Promise<{ orgslug: string; courseuuid: string; activityid: string }>
  searchParams: Promise<{ bgcolor?: string }>
}

const HEX_COLOR_RE = /^[0-9a-fA-F]{3,8}$/

function getDefaultBgColor(activityType: string): string {
  return activityType === 'TYPE_DYNAMIC' ? '#ffffff' : '#09090b'
}

function sanitizeBgColor(raw: string | undefined): string | null {
  if (!raw) return null
  return HEX_COLOR_RE.test(raw) ? `#${raw}` : null
}

export default async function EmbedActivityPage({ params, searchParams }: PageProps) {
  const { orgslug, courseuuid, activityid } = await params
  const sp = await searchParams

  let activity
  let course

  try {
    [activity, course] = await Promise.all([
      getActivityWithAuthHeader(
        activityid,
        { revalidate: 0, tags: ['activities'] },
        null
      ),
      getCourseMetadata(
        courseuuid,
        { revalidate: 60, tags: ['courses'] },
        null,
        { slim: true }
      ),
    ])
  } catch (error) {
    console.error('Error fetching activity for embed:', error)
    notFound()
  }

  if (!activity || activity.detail === 'Not Found') {
    notFound()
  }

  if (!course || course.detail === 'Not Found') {
    notFound()
  }

  if (!activity.published) {
    notFound()
  }

  // Resolve bg color: sanitized query param or activity-type default.
  // Set on html+body via server-rendered inline style so the correct
  // background is painted before any JS or external CSS loads.
  const bgColor = sanitizeBgColor(sp.bgcolor) ?? getDefaultBgColor(activity.activity_type)

  return (
    <>
      <style>{`html,body{background-color:${bgColor}!important}`}</style>
      <EmbedActivityClient
        activity={activity}
        course={course}
        activityId={activityid}
        orgslug={orgslug}
      />
    </>
  )
}
