import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getUriWithoutOrg, getUriWithOrg } from '@services/config/config'
import { getProductsByCourse } from '@services/payments/products'
import { LogIn, LogOut, ShoppingCart } from 'lucide-react'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import CoursePaidOptions from './CoursePaidOptions'
import { checkPaidAccess } from '@services/payments/payments'
import { removeCourse, startCourse } from '@services/courses/activity'
import { revalidateTags } from '@services/utils/ts/requests'
import UserAvatar from '../../UserAvatar'
import { getUserAvatarMediaDirectory } from '@services/media/media'

interface Author {
  user_uuid: string
  avatar_image: string
  first_name: string
  last_name: string
  username: string
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

interface CourseActionsMobileProps {
  courseuuid: string
  orgslug: string
  course: Course & {
    org_id: number
  }
}

const CourseActionsMobile = ({ courseuuid, orgslug, course }: CourseActionsMobileProps) => {
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
    return <div className="animate-pulse h-16 bg-gray-100 rounded-lg" />
  }

  const author = course.authors[0]
  const authorName = author.first_name && author.last_name 
    ? `${author.first_name} ${author.last_name}`
    : `@${author.username}`

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center space-x-3">
        <UserAvatar
          border="border-4"
          avatar_url={author.avatar_image ? getUserAvatarMediaDirectory(author.user_uuid, author.avatar_image) : ''}
          predefined_avatar={author.avatar_image ? undefined : 'empty'}
          width={40}
        />
        <div className="flex flex-col">
          <span className="text-xs text-neutral-400 font-medium">Author</span>
          <span className="text-sm font-semibold text-neutral-800">{authorName}</span>
        </div>
      </div>

      <div className="shrink-0">
        {linkedProducts.length > 0 ? (
          hasAccess ? (
            <button
              onClick={handleCourseAction}
              className={`py-2 px-4 rounded-lg font-semibold text-sm transition-colors flex items-center gap-2 ${
                isStarted
                  ? 'bg-red-500 text-white hover:bg-red-600'
                  : 'bg-neutral-900 text-white hover:bg-neutral-800'
              }`}
            >
              {isStarted ? (
                <>
                  <LogOut className="w-4 h-4" />
                  Leave Course
                </>
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  Start Course
                </>
              )}
            </button>
          ) : (
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
                onClick={() => setIsModalOpen(true)}
                className="py-2 px-4 rounded-lg bg-neutral-900 text-white font-semibold text-sm hover:bg-neutral-800 transition-colors flex items-center gap-2"
              >
                <ShoppingCart className="w-4 h-4" />
                Purchase
              </button>
            </>
          )
        ) : (
          <button
            onClick={handleCourseAction}
            className={`py-2 px-4 rounded-lg font-semibold text-sm transition-colors flex items-center gap-2 ${
              isStarted
                ? 'bg-red-500 text-white hover:bg-red-600'
                : 'bg-neutral-900 text-white hover:bg-neutral-800'
            }`}
          >
            {!session.data?.user ? (
              <>
                <LogIn className="w-4 h-4" />
                Sign In
              </>
            ) : isStarted ? (
              <>
                <LogOut className="w-4 h-4" />
                Leave Course
              </>
            ) : (
              <>
                <LogIn className="w-4 h-4" />
                Start Course
              </>
            )}
          </button>
        )}
      </div>
    </div>
  )
}

export default CourseActionsMobile 