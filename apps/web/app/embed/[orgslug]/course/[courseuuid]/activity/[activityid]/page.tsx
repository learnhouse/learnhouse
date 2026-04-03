import { getActivityWithAuthHeader } from '@services/courses/activities'
import { getCourseMetadata } from '@services/courses/courses'
import { notFound } from 'next/navigation'
import EmbedActivityClient from './EmbedActivityClient'

type PageProps = {
  params: Promise<{ orgslug: string; courseuuid: string; activityid: string }>
}

export default async function EmbedActivityPage({ params }: PageProps) {
  const { orgslug, courseuuid, activityid } = await params

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

  return (
    <EmbedActivityClient
      activity={activity}
      course={course}
      activityId={activityid}
      orgslug={orgslug}
    />
  )
}
