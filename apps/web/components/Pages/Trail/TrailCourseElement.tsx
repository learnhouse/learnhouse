'use client'
import { useOrg } from '@components/Contexts/OrgContext'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import { removeCourse } from '@services/courses/activity'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { revalidateTags } from '@services/utils/ts/requests'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { mutate } from 'swr'
import { useCookies } from '@components/Contexts/CookiesContext'

interface TrailCourseElementProps {
  course: any
  run: any
  orgslug: string
}

function TrailCourseElement(props: TrailCourseElementProps) {
  const org = useOrg() as any
  const session = useLHSession() as any;
  const cookies = useCookies() as any;
  const access_token = session?.data?.tokens?.access_token;
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
    let activity = await removeCourse(course_uuid, props.orgslug,access_token)
    // Mutate course
    await revalidateTags(['courses'], props.orgslug)
    router.refresh()

    // Mutate
    mutate(`${getAPIUrl()}trail/org/${orgID}/trail`)
  }

  useEffect(() => {}, [props.course, org])

  return (
    <div
      className="trailcoursebox flex p-3 bg-white rounded-xl"
      style={{ boxShadow: '0px 4px 7px 0px rgba(0, 0, 0, 0.03)' }}
    >
      <Link href={getUriWithOrg(props.orgslug, '/course/' + courseid,cookies)}>
        <div
          className="course_tumbnail inset-0 ring-1 ring-inset ring-black/10 rounded-lg relative h-[50px] w-[72px] bg-cover bg-center"
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
      <div className="course_meta pl-5 flex-grow space-y-1">
        <div className="course_top">
          <div className="course_info flex">
            <div className="course_basic flex flex-col flex-end -space-y-2">
              <p className="p-0 font-bold text-sm text-gray-700">Course</p>
              <div className="course_progress flex items-center space-x-2">
                <h2 className="font-bold text-xl">{course.name}</h2>
                <div className="bg-slate-300 rounded-full w-[10px] h-[5px]"></div>
                <h2>{course_progress}%</h2>
              </div>
            </div>
            <div className="course_actions flex-grow flex flex-row-reverse">
              <button
                onClick={() => quitCourse(course.course_uuid)}
                className="bg-red-200 text-red-700 hover:bg-red-300  rounded-full text-xs h-5 px-2 font-bold"
              >
                Quit Course
              </button>
            </div>
          </div>
        </div>
        <div className="course_progress indicator w-full">
          <div className="w-full bg-gray-200 rounded-full h-1.5 ">
            <div
              className={`bg-teal-600 h-1.5 rounded-full`}
              style={{ width: `${course_progress}%` }}
            ></div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default TrailCourseElement
