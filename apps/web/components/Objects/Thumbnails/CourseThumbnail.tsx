'use client'
import { useOrg } from '@components/Contexts/OrgContext'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import ConfirmationModal from '@components/StyledElements/ConfirmationModal/ConfirmationModal'
import { getUriWithOrg } from '@services/config/config'
import { deleteCourseFromBackend } from '@services/courses/courses'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { revalidateTags } from '@services/utils/ts/requests'
import { BookMinus, FilePenLine, Settings2, EllipsisVertical } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import React, { useEffect } from 'react'
import toast from 'react-hot-toast'
import { useCookies } from '@components/Contexts/CookiesContext'

type PropsType = {
  course: any
  orgslug: string
}

// function to remove "course_" from the course_uuid
function removeCoursePrefix(course_uuid: string) {
  return course_uuid.replace('course_', '')
}

function CourseThumbnail(props: PropsType) {
  const router = useRouter()
  const cookies = useCookies() as any;
  const org = useOrg() as any
  const session = useLHSession() as any;

  async function deleteCourses(course_uuid: any) {
    const toast_loading = toast.loading('Deleting course...')
    await deleteCourseFromBackend(course_uuid, session.data?.tokens?.access_token)
    toast.dismiss(toast_loading)
    toast.success('Course deleted successfully')
    await revalidateTags(['courses'], props.orgslug)

    router.refresh()
  }

  useEffect(() => { }, [org])

  return (
    <div className="relative">
      <AdminEditsArea
        course={props.course}
        orgSlug={props.orgslug}
        courseId={props.course.course_uuid}
        deleteCourses={deleteCourses}
      />
      <Link
        href={getUriWithOrg(
          props.orgslug,
          '/course/' + removeCoursePrefix(props.course.course_uuid), cookies
        )}
      >
        {props.course.thumbnail_image ? (
          <div
            className="inset-0 ring-1 ring-inset ring-black/10 rounded-xl shadow-xl w-[249px] h-[131px] bg-cover"
            style={{
              backgroundImage: `url(${getCourseThumbnailMediaDirectory(
                org?.org_uuid,
                props.course.course_uuid,
                props.course.thumbnail_image
              )})`,
            }}
          />
        ) : (
          <div
            className="inset-0 ring-1 ring-inset ring-black/10 rounded-xl shadow-xl w-[249px] h-[131px] bg-cover"
            style={{
              backgroundImage: `url('../empty_thumbnail.png')`,
              backgroundSize: 'contain',
            }}
          />
        )}
      </Link>
      <div className='flex flex-col w-[250px] pt-3 space-y-2'>
        <h2 className="font-bold text-gray-800 max-h-[80px] h-fit line-clamp-2 leading-tight text-lg capitalize">{props.course.name}</h2>
        <h3 className='text-sm text-gray-700 leading-normal line-clamp-3'>{props.course.description}</h3>
      </div>
    </div>
  )
}

const AdminEditsArea = (props: {
  orgSlug: string
  courseId: string
  course: any
  deleteCourses: any
}) => {
  const cookies = useCookies() as any;
  return (
    <AuthenticatedClientElement
      action="update"
      ressourceType="courses"
      checkMethod="roles"
      orgId={props.course.org_id}
    >
      <div
        className="flex items-center space-x-2 absolute z-20 overflow-hidden rounded-xl pt-0 mx-auto justify-center transform w-full h-[60px] bg-gradient-to-t from-transparent from-10% to-gray-900/60">
        <Link
          href={getUriWithOrg(
            props.orgSlug,
            '/dash/courses/course/' +
            removeCoursePrefix(props.courseId) +
            '/content', cookies
          )}
          prefetch
        >
          <div
            className="hover:cursor-pointer p-1 px-4 bg-blue-600 rounded-xl items-center flex shadow-2xl"
            rel="noopener noreferrer"
          >
            <FilePenLine size={14} className="text-blue-200 font-bold" />
          </div>
        </Link>
        <Link
          href={getUriWithOrg(
            props.orgSlug,
            '/dash/courses/course/' +
            removeCoursePrefix(props.courseId) +
            '/general',cookies
          )}
          prefetch
        >
          <div
            className=" hover:cursor-pointer p-1 px-4 bg-gray-800 rounded-xl items-center  flex shadow-2xl"
            rel="noopener noreferrer"
          >
            <Settings2 size={14} className="text-gray-200 font-bold" />
          </div>
        </Link>
        <EllipsisVertical size={14} className='text-gray-200 font-bold' />
        <ConfirmationModal
          confirmationButtonText="Delete Course"
          confirmationMessage="Are you sure you want to delete this course?"
          dialogTitle={'Delete ' + props.course.name + ' ?'}
          dialogTrigger={
            <div
              className="hover:cursor-pointer p-1 px-4 bg-rose-600 h-fit rounded-xl items-center flex shadow-2xl"
              rel="noopener noreferrer"
            >
              <BookMinus size={14} className="text-rose-200 font-bold" />
            </div>
          }
          functionToExecute={() => props.deleteCourses(props.courseId)}
          status="warning"
        ></ConfirmationModal>
      </div>
    </AuthenticatedClientElement>
  )
}

export default CourseThumbnail
