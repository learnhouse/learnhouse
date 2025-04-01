'use client'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import { removeCourse } from '@services/courses/activity'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { revalidateTags } from '@services/utils/ts/requests'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { mutate } from 'swr'

interface TrailCourseElementProps {
  course: any
  run: any
  orgslug: string
}

function TrailCourseElement(props: TrailCourseElementProps) {
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const courseid = props.course.course_uuid.replace('course_', '')
  const course = props.course
  const router = useRouter()
  const course_total_steps = props.run.course_total_steps
  const course_completed_steps = props.run.steps.length
  const orgID = org?.id
  const course_progress = Math.round(
    (course_completed_steps / course_total_steps) * 100
  )

  async function quitCourse(course_uuid: string) {
    // Close activity
    const activity = await removeCourse(
      course_uuid,
      props.orgslug,
      access_token
    )
    // Mutate course
    await revalidateTags(['courses'], props.orgslug)
    router.refresh()

    // Mutate
    mutate(`${getAPIUrl()}trail/org/${orgID}/trail`)
  }

  useEffect(() => {}, [props.course, org])

  return (
    <div
      className="trailcoursebox flex rounded-xl bg-white p-3"
      style={{ boxShadow: '0px 4px 7px 0px rgba(0, 0, 0, 0.03)' }}
    >
      <Link href={getUriWithOrg(props.orgslug, '/course/' + courseid)}>
        <div
          className="course_tumbnail relative inset-0 h-[50px] w-[72px] rounded-lg bg-cover bg-center ring-1 ring-black/10 ring-inset"
          style={{
            backgroundImage: `url(${getCourseThumbnailMediaDirectory(
              org.org_uuid,
              props.course.course_uuid,
              props.course.thumbnail_image
            )})`,
            boxShadow: '0px 4px 7px 0px rgba(0, 0, 0, 0.03)',
          }}
        ></div>
      </Link>
      <div className="course_meta grow space-y-1 pl-5">
        <div className="course_top">
          <div className="course_info flex">
            <div className="course_basic flex-end flex flex-col -space-y-2">
              <p className="p-0 text-sm font-bold text-gray-700">Course</p>
              <div className="course_progress flex items-center space-x-2">
                <h2 className="text-xl font-bold">{course.name}</h2>
                <div className="h-[5px] w-[10px] rounded-full bg-slate-300"></div>
                <h2>{course_progress}%</h2>
              </div>
            </div>
            <div className="course_actions flex grow flex-row-reverse">
              <button
                onClick={() => quitCourse(course.course_uuid)}
                className="h-5 rounded-full bg-red-200 px-2 text-xs font-bold text-red-700 hover:bg-red-300"
              >
                Quit Course
              </button>
            </div>
          </div>
        </div>
        <div className="course_progress indicator w-full">
          <div className="h-1.5 w-full rounded-full bg-gray-200">
            <div
              className={`h-1.5 rounded-full bg-teal-600`}
              style={{ width: `${course_progress}%` }}
            ></div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default TrailCourseElement
