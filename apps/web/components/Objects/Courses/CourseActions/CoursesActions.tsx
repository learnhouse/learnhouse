import React, { useState, useEffect } from 'react'
import UserAvatar from '../../UserAvatar'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import { removeCourse, startCourse } from '@services/courses/activity'
import { revalidateTags } from '@services/utils/ts/requests'
import { useRouter } from 'next/navigation'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useMediaQuery } from 'usehooks-ts'
import { getUriWithOrg, getUriWithoutOrg } from '@services/config/config'
import { getProductsByCourse } from '@services/payments/products'
import { LogIn, LogOut, ShoppingCart, AlertCircle } from 'lucide-react'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import CoursePaidOptions from './CoursePaidOptions'
import { checkPaidAccess } from '@services/payments/payments'

interface Author {
  user: {
    user_uuid: string
    avatar_image: string
    first_name: string
    last_name: string
    username: string
  }
  authorship: 'CREATOR' | 'CONTRIBUTOR' | 'MAINTAINER' | 'REPORTER'
}

interface CourseRun {
  status: string
  course_id: string
}

interface Course {
  id: string
  authors: Author[]
  trail?: {
    runs: CourseRun[]
  }
  chapters?: Array<{
    name: string
    activities: Array<{
      activity_uuid: string
      name: string
      activity_type: string
    }>
  }>
}

interface CourseActionsProps {
  courseuuid: string
  orgslug: string
  course: Course & {
    org_id: number
  }
}

// Separate component for author display
const AuthorInfo = ({ author, isMobile }: { author: Author, isMobile: boolean }) => (
  <div className="flex flex-row md:flex-col mx-auto space-y-0 md:space-y-3 space-x-4 md:space-x-0 px-2 py-2 items-center">
    <UserAvatar
      border="border-8"
      avatar_url={author.user.avatar_image ? getUserAvatarMediaDirectory(author.user.user_uuid, author.user.avatar_image) : ''}
      predefined_avatar={author.user.avatar_image ? undefined : 'empty'}
      width={isMobile ? 60 : 100}
    />
    <div className="md:-space-y-2">
      <div className="text-[12px] text-neutral-400 font-semibold">Author</div>
      <div className="text-lg md:text-xl font-bold text-neutral-800">
        {(author.user.first_name && author.user.last_name) ? (
          <div className="flex space-x-2 items-center">
            <p>{`${author.user.first_name} ${author.user.last_name}`}</p>
            <span className="text-xs bg-neutral-100 p-1 px-3 rounded-full text-neutral-400 font-semibold">
              @{author.user.username}
            </span>
          </div>
        ) : (
          <div className="flex space-x-2 items-center">
            <p>@{author.user.username}</p>
          </div>
        )}
      </div>
    </div>
  </div>
)

const Actions = ({ courseuuid, orgslug, course }: CourseActionsProps) => {
  const router = useRouter()
  const session = useLHSession() as any
  const [linkedProducts, setLinkedProducts] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [hasAccess, setHasAccess] = useState<boolean | null>(null)

  const isStarted = course.trail?.runs?.some(
    (run) => run.status === 'STATUS_IN_PROGRESS' && run.course_id === course.id
  ) ?? false

  useEffect(() => {
    const fetchLinkedProducts = async () => {
      try {
        const response = await getProductsByCourse(
          course.org_id,
          course.id,
          session.data?.tokens?.access_token
        )
        setLinkedProducts(response.data || [])
      } catch (error) {
        console.error('Failed to fetch linked products')
      } finally {
        setIsLoading(false)
      }
    }

    fetchLinkedProducts()
  }, [course.id, course.org_id, session.data?.tokens?.access_token])

  useEffect(() => {
    const checkAccess = async () => {
      if (!session.data?.user) return
      try {
        const response = await checkPaidAccess(
          parseInt(course.id),
          course.org_id,
          session.data?.tokens?.access_token
        )
        setHasAccess(response.has_access)
        
      } catch (error) {
        console.error('Failed to check course access')
        setHasAccess(false)
      }
    }

    if (linkedProducts.length > 0) {
      checkAccess()
    }
  }, [course.id, course.org_id, session.data?.tokens?.access_token, linkedProducts])

  const handleCourseAction = async () => {
    if (!session.data?.user) {
      router.push(getUriWithoutOrg(`/signup?orgslug=${orgslug}`))
      return
    }

    if (isStarted) {
      await removeCourse('course_' + courseuuid, orgslug, session.data?.tokens?.access_token)
      await revalidateTags(['courses'], orgslug)
      router.refresh()
    } else {
      await startCourse('course_' + courseuuid, orgslug, session.data?.tokens?.access_token)
      await revalidateTags(['courses'], orgslug)
      
      // Get the first activity from the first chapter
      const firstChapter = course.chapters?.[0]
      const firstActivity = firstChapter?.activities?.[0]
      
      if (firstActivity) {
        // Redirect to the first activity
        router.push(
          getUriWithOrg(orgslug, '') +
          `/course/${courseuuid}/activity/${firstActivity.activity_uuid.replace('activity_', '')}`
        )
      } else {
        router.refresh()
      }
    }
  }

  if (isLoading) {
    return <div className="animate-pulse h-20 bg-gray-100 rounded-lg nice-shadow" />
  }

  if (linkedProducts.length > 0) {
    return (
      <div className="space-y-4">
        {hasAccess ? (
          <>
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg nice-shadow">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                <h3 className="text-green-800 font-semibold">You Own This Course</h3>
              </div>
              <p className="text-green-700 text-sm mt-1">
                You have purchased this course and have full access to all content.
              </p>
            </div>
            <button
              onClick={handleCourseAction}
              className={`w-full py-3 rounded-lg nice-shadow font-semibold transition-colors flex items-center justify-center gap-2 ${
                isStarted
                  ? 'bg-red-500 text-white hover:bg-red-600'
                  : 'bg-neutral-900 text-white hover:bg-neutral-800'
              }`}
            >
              {isStarted ? (
                <>
                  <LogOut className="w-5 h-5" />
                  Leave Course
                </>
              ) : (
                <>
                  <LogIn className="w-5 h-5" />
                  Start Course
                </>
              )}
            </button>
          </>
        ) : (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg nice-shadow">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-amber-800" />
              <h3 className="text-amber-800 font-semibold">Paid Course</h3>
            </div>
            <p className="text-amber-700 text-sm mt-1">
              This course requires purchase to access its content.
            </p>
          </div>
        )}
        
        {!hasAccess && (
          <>
            <Modal
              isDialogOpen={isModalOpen}
              onOpenChange={setIsModalOpen}
              dialogContent={<CoursePaidOptions course={course} />}
              dialogTitle="Purchase Course"
              dialogDescription="Select a payment option to access this course"
              minWidth="sm"
            />
            <button
              className="w-full bg-neutral-900 text-white py-3 rounded-lg nice-shadow font-semibold hover:bg-neutral-800 transition-colors flex items-center justify-center gap-2"
              onClick={() => setIsModalOpen(true)}
            >
              <ShoppingCart className="w-5 h-5" />
              Purchase Course
            </button>
          </>
        )}
      </div>
    )
  }

  return (
    <button
      onClick={handleCourseAction}
      className={`w-full py-3 rounded-lg nice-shadow font-semibold transition-colors flex items-center justify-center gap-2 ${
        isStarted
          ? 'bg-red-500 text-white hover:bg-red-600'
          : 'bg-neutral-900 text-white hover:bg-neutral-800'
      }`}
    >
      {!session.data?.user ? (
        <>
          <LogIn className="w-5 h-5" />
          Authenticate to start course
        </>
      ) : isStarted ? (
        <>
          <LogOut className="w-5 h-5" />
          Leave Course
        </>
      ) : (
        <>
          <LogIn className="w-5 h-5" />
          Start Course
        </>
      )}
    </button>
  )
}

function CoursesActions({ courseuuid, orgslug, course }: CourseActionsProps) {
  const router = useRouter()
  const session = useLHSession() as any
  const isMobile = useMediaQuery('(max-width: 768px)')

  // Sort authors by role priority
  const sortedAuthors = [...course.authors].sort((a, b) => {
    const rolePriority: Record<string, number> = {
      'CREATOR': 0,
      'MAINTAINER': 1,
      'CONTRIBUTOR': 2,
      'REPORTER': 3
    };
    return rolePriority[a.authorship] - rolePriority[b.authorship];
  });

  return (
    <div className=" space-y-3  antialiased flex flex-col   p-3 py-5 bg-white shadow-md shadow-gray-300/25 outline outline-1 outline-neutral-200/40 rounded-lg overflow-hidden">
     <AuthorInfo author={sortedAuthors[0]} isMobile={isMobile} />
      <div className='px-3 py-2'>
        <Actions courseuuid={courseuuid} orgslug={orgslug} course={course} />
      </div>
    </div>
  )
}

export default CoursesActions