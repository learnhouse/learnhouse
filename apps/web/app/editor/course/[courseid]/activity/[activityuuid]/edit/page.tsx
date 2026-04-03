
import { default as React } from 'react'
import { getCourseMetadata } from '@services/courses/courses'
import { Metadata } from 'next'
import { getActivityWithAuthHeader } from '@services/courses/activities'
import { getOrganizationContextInfoWithUUID } from '@services/organizations/orgs'
import EditorOptionsProvider from '@components/Contexts/Editor/EditorContext'
import AIEditorProvider from '@components/Contexts/AI/AIEditorContext'
import { getServerSession } from '@/lib/auth/server'
import EditorWrapper from '@components/Objects/Editor/EditorWrapper'


type MetadataProps = {
  params: Promise<{ orgslug: string; courseid: string; activityid: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export async function generateMetadata(props: MetadataProps): Promise<Metadata> {
  const params = await props.params;
  const session = await getServerSession()
  const access_token = session?.tokens?.access_token
  const course_meta = await getCourseMetadata(
    params.courseid,
    { revalidate: 0, tags: ['courses'] },
    access_token ?? undefined,
    { slim: true }
  )

  return {
    title: `Edit - ${course_meta.name} Activity`,
    description: course_meta.mini_description,
  }
}

const EditActivity = async (params: any) => {
  const session = await getServerSession()
  const access_token = session?.tokens?.access_token
  const activityuuid = (await params.params).activityuuid
  const courseid = (await params.params).courseid

  // Fetch course meta (slim — just need name/structure) and activity content in PARALLEL
  // Activity uses revalidate: 0 to always get the latest content for editing
  const [courseInfo, activity] = await Promise.all([
    getCourseMetadata(
      courseid,
      { revalidate: 0, tags: ['courses'] },
      access_token ?? undefined,
      { slim: true }
    ),
    getActivityWithAuthHeader(
      activityuuid,
      { revalidate: 0, tags: ['activities'] },
      access_token ?? undefined
    ),
  ])

  const org = await getOrganizationContextInfoWithUUID(courseInfo.org_uuid, {
    revalidate: 120,
    tags: ['organizations'],
  }, access_token)

  return (
    <EditorOptionsProvider options={{ isEditable: true }}>
      <AIEditorProvider>
        <EditorWrapper
          org={org}
          course={courseInfo}
          activity={activity}
          content={activity.content}
        ></EditorWrapper>
      </AIEditorProvider>
    </EditorOptionsProvider>
  )
}

export default EditActivity
