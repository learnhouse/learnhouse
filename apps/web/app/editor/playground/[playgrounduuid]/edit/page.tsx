import { Metadata } from 'next'
import { getServerSession } from '@/lib/auth/server'
import { getPlayground } from '@ee/services/plays/playgrounds'
import { getAllOrgCourses } from '@services/courses/courses'
import { notFound, redirect } from 'next/navigation'
// Plays are EE: without EE getPlayground throws (404) and the editor is a stub.
import PlayEditorPage from '@ee/components/Plays/Pages/PlayEditorPage'

type PageParams = Promise<{ playgrounduuid: string }>

export async function generateMetadata({ params }: { params: PageParams }): Promise<Metadata> {
  const { playgrounduuid } = await params
  try {
    const pg = await getPlayground(playgrounduuid)
    return { title: `Edit | ${pg.name}` }
  } catch {
    return { title: 'Edit Playground' }
  }
}

export default async function EditPlaygroundPage({ params }: { params: PageParams }) {
  const { playgrounduuid } = await params
  const session = await getServerSession()
  const access_token = session?.tokens?.access_token

  if (!access_token) {
    redirect('/auth/login')
  }

  let playground
  try {
    playground = await getPlayground(playgrounduuid, access_token)
  } catch {
    notFound()
  }

  let orgCourses: { course_uuid: string; name: string }[] = []
  if (playground.org_slug) {
    try {
      const coursesRes = await getAllOrgCourses(playground.org_slug, access_token, true)
      orgCourses = (Array.isArray(coursesRes) ? coursesRes : []).map((c: any) => ({
        course_uuid: c.course_uuid,
        name: c.name,
      }))
    } catch {
      // Non-fatal: proceed without course context
    }
  }

  return <PlayEditorPage playground={playground} accessToken={access_token} orgCourses={orgCourses} />
}
