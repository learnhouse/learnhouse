import { useLHSession } from '@components/Contexts/LHSessionContext'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { getUriWithOrg, getUriWithoutOrg } from '@services/config/config'
import { removeCourse, startCourse } from '@services/courses/activity'
import { applyForContributor } from '@services/courses/courses'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import { checkPaidAccess } from '@services/payments/payments'
import { getProductsByCourse } from '@services/payments/products'
import { revalidateTags } from '@services/utils/ts/requests'
import {
  AlertCircle,
  ClockIcon,
  LogIn,
  LogOut,
  ShoppingCart,
  UserPen,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import React, { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import { useMediaQuery } from 'usehooks-ts'
import { useContributorStatus } from '../../../../hooks/useContributorStatus'
import UserAvatar from '../../UserAvatar'
import CoursePaidOptions from './CoursePaidOptions'

interface Author {
  user: {
    user_uuid: string
    avatar_image: string
    first_name: string
    last_name: string
    username: string
  }
  authorship: 'CREATOR' | 'CONTRIBUTOR' | 'MAINTAINER' | 'REPORTER'
  authorship_status: 'ACTIVE' | 'INACTIVE' | 'PENDING'
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
  open_to_contributors?: boolean
}

interface CourseActionsProps {
  courseuuid: string
  orgslug: string
  course: Course & {
    org_id: number
  }
}

// Separate component for author display
const AuthorInfo = ({
  author,
  isMobile,
}: {
  author: Author
  isMobile: boolean
}) => (
  <div className="mx-auto flex flex-row items-center space-y-0 space-x-4 px-2 py-2 md:flex-col md:space-y-3 md:space-x-0">
    <UserAvatar
      border="border-8"
      avatar_url={
        author.user.avatar_image
          ? getUserAvatarMediaDirectory(
              author.user.user_uuid,
              author.user.avatar_image
            )
          : ''
      }
      predefined_avatar={author.user.avatar_image ? undefined : 'empty'}
      width={isMobile ? 60 : 100}
    />
    <div className="md:-space-y-2">
      <div className="text-[12px] font-semibold text-neutral-400">Author</div>
      <div className="text-lg font-bold text-neutral-800 md:text-xl">
        {author.user.first_name && author.user.last_name ? (
          <div className="flex items-center space-x-2">
            <p>{`${author.user.first_name} ${author.user.last_name}`}</p>
            <span className="rounded-full bg-neutral-100 p-1 px-3 text-xs font-semibold text-neutral-400">
              @{author.user.username}
            </span>
          </div>
        ) : (
          <div className="flex items-center space-x-2">
            <p>@{author.user.username}</p>
          </div>
        )}
      </div>
    </div>
  </div>
)

const MultipleAuthors = ({
  authors,
  isMobile,
}: {
  authors: Author[]
  isMobile: boolean
}) => {
  const displayedAvatars = authors.slice(0, 3)
  const displayedNames = authors.slice(0, 2)
  const remainingCount = Math.max(0, authors.length - 3)

  // Consistent sizes for both avatars and badge
  const avatarSize = isMobile ? 72 : 86
  const borderSize = 'border-4'

  return (
    <div className="flex flex-col items-center space-y-4 px-2 py-2">
      <div className="self-start text-[12px] font-semibold text-neutral-400">
        Authors
      </div>

      {/* Avatars row */}
      <div className="relative flex justify-center -space-x-6">
        {displayedAvatars.map((author, index) => (
          <div
            key={author.user.user_uuid}
            className="relative"
            style={{ zIndex: displayedAvatars.length - index }}
          >
            <div className="ring-white">
              <UserAvatar
                border={borderSize}
                rounded="rounded-full"
                avatar_url={
                  author.user.avatar_image
                    ? getUserAvatarMediaDirectory(
                        author.user.user_uuid,
                        author.user.avatar_image
                      )
                    : ''
                }
                predefined_avatar={
                  author.user.avatar_image ? undefined : 'empty'
                }
                width={avatarSize}
              />
            </div>
          </div>
        ))}
        {remainingCount > 0 && (
          <div className="relative" style={{ zIndex: 0 }}>
            <div
              className="flex items-center justify-center rounded-full border-4 border-white bg-neutral-100 font-medium text-neutral-600 shadow-sm"
              style={{
                width: `${avatarSize}px`,
                height: `${avatarSize}px`,
                fontSize: isMobile ? '14px' : '16px',
              }}
            >
              +{remainingCount}
            </div>
          </div>
        )}
      </div>

      {/* Names row - improved display logic */}
      <div className="mt-2 text-center">
        <div className="text-sm font-medium text-neutral-800">
          {authors.length === 1 ? (
            <span>
              {authors[0].user.first_name && authors[0].user.last_name
                ? `${authors[0].user.first_name} ${authors[0].user.last_name}`
                : `@${authors[0].user.username}`}
            </span>
          ) : (
            <>
              {displayedNames.map((author, index) => (
                <span key={author.user.user_uuid}>
                  {author.user.first_name && author.user.last_name
                    ? `${author.user.first_name} ${author.user.last_name}`
                    : `@${author.user.username}`}
                  {index === 0 &&
                    authors.length > 1 &&
                    index < displayedNames.length - 1 &&
                    ' & '}
                </span>
              ))}
              {authors.length > 2 && (
                <span className="ml-1 text-neutral-500">
                  & {authors.length - 2} more
                </span>
              )}
            </>
          )}
        </div>
        <div className="mt-0.5 text-xs text-neutral-500">
          {authors.length === 1 ? (
            <span>@{authors[0].user.username}</span>
          ) : (
            <>
              {displayedNames.map((author, index) => (
                <span key={author.user.user_uuid}>
                  @{author.user.username}
                  {index === 0 &&
                    authors.length > 1 &&
                    index < displayedNames.length - 1 &&
                    ' & '}
                </span>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const Actions = ({ courseuuid, orgslug, course }: CourseActionsProps) => {
  const router = useRouter()
  const session = useLHSession() as any
  const [linkedProducts, setLinkedProducts] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isActionLoading, setIsActionLoading] = useState(false)
  const [isContributeLoading, setIsContributeLoading] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [hasAccess, setHasAccess] = useState<boolean | null>(null)
  const { contributorStatus, refetch } = useContributorStatus(courseuuid)

  const isStarted =
    course.trail?.runs?.some(
      (run) =>
        run.status === 'STATUS_IN_PROGRESS' && run.course_id === course.id
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
          Number.parseInt(course.id),
          course.org_id,
          session.data?.tokens?.access_token
        )
        setHasAccess(response.has_access)
      } catch (error) {
        console.error('Failed to check course access')
        toast.error('Failed to check course access. Please try again later.')
        setHasAccess(false)
      }
    }

    if (linkedProducts.length > 0) {
      checkAccess()
    }
  }, [
    course.id,
    course.org_id,
    session.data?.tokens?.access_token,
    linkedProducts,
  ])

  const handleCourseAction = async () => {
    if (!session.data?.user) {
      router.push(getUriWithoutOrg(`/signup?orgslug=${orgslug}`))
      return
    }

    setIsActionLoading(true)
    const loadingToast = toast.loading(
      isStarted ? 'Leaving course...' : 'Starting course...'
    )

    try {
      if (isStarted) {
        await removeCourse(
          'course_' + courseuuid,
          orgslug,
          session.data?.tokens?.access_token
        )
        await revalidateTags(['courses'], orgslug)
        toast.success('Successfully left the course', { id: loadingToast })
        router.refresh()
      } else {
        await startCourse(
          'course_' + courseuuid,
          orgslug,
          session.data?.tokens?.access_token
        )
        await revalidateTags(['courses'], orgslug)
        toast.success('Successfully started the course', { id: loadingToast })

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
    } catch (error) {
      console.error('Failed to perform course action:', error)
      toast.error(
        isStarted
          ? 'Failed to leave the course. Please try again later.'
          : 'Failed to start the course. Please try again later.',
        { id: loadingToast }
      )
    } finally {
      setIsActionLoading(false)
    }
  }

  const handleApplyToContribute = async () => {
    if (!session.data?.user) {
      router.push(getUriWithoutOrg(`/signup?orgslug=${orgslug}`))
      return
    }

    setIsContributeLoading(true)
    const loadingToast = toast.loading('Submitting contributor application...')

    try {
      const data = {
        message: 'I would like to contribute to this course.',
      }

      await applyForContributor(
        'course_' + courseuuid,
        data,
        session.data?.tokens?.access_token
      )
      await revalidateTags(['courses'], orgslug)
      await refetch()
      toast.success(
        'Your application to contribute has been submitted successfully',
        { id: loadingToast }
      )
    } catch (error) {
      console.error('Failed to apply as contributor:', error)
      toast.error(
        'Failed to submit your application. Please try again later.',
        { id: loadingToast }
      )
    } finally {
      setIsContributeLoading(false)
    }
  }

  if (isLoading) {
    return (
      <div className="nice-shadow h-20 animate-pulse rounded-lg bg-gray-100" />
    )
  }

  const renderContributorButton = () => {
    // Don't render anything if the course is not open to contributors or if the user status is INACTIVE
    if (
      contributorStatus === 'INACTIVE' ||
      course.open_to_contributors !== true
    ) {
      return null
    }

    if (!session.data?.user) {
      return (
        <button
          onClick={() =>
            router.push(getUriWithoutOrg(`/signup?orgslug=${orgslug}`))
          }
          className="nice-shadow mt-3 flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-neutral-200 bg-white py-3 font-semibold text-neutral-700 transition-colors hover:bg-neutral-50"
        >
          <UserPen className="h-5 w-5" />
          Authenticate to contribute
        </button>
      )
    }

    if (contributorStatus === 'ACTIVE') {
      return (
        <div className="nice-shadow mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-green-200 bg-green-50 py-3 font-semibold text-green-700">
          <UserPen className="h-5 w-5" />
          You are a contributor
        </div>
      )
    }

    if (contributorStatus === 'PENDING') {
      return (
        <div className="nice-shadow mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-amber-200 bg-amber-50 py-3 font-semibold text-amber-700">
          <ClockIcon className="h-5 w-5" />
          Contributor application pending
        </div>
      )
    }

    return (
      <button
        onClick={handleApplyToContribute}
        disabled={isContributeLoading}
        className="nice-shadow mt-3 flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-white py-3 font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed"
      >
        {isContributeLoading ? (
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-700 border-t-transparent" />
        ) : (
          <>
            <UserPen className="h-5 w-5" />
            Apply to contribute
          </>
        )}
      </button>
    )
  }

  if (linkedProducts.length > 0) {
    return (
      <div className="space-y-4">
        {hasAccess ? (
          <>
            <div className="nice-shadow rounded-lg border border-green-200 bg-green-50 p-4">
              <div className="flex items-center gap-3">
                <div className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
                <h3 className="font-semibold text-green-800">
                  You Own This Course
                </h3>
              </div>
              <p className="mt-1 text-sm text-green-700">
                You have purchased this course and have full access to all
                content.
              </p>
            </div>
            <button
              onClick={handleCourseAction}
              disabled={isActionLoading}
              className={`nice-shadow flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg py-3 font-semibold transition-colors ${
                isStarted
                  ? 'bg-red-500 text-white hover:bg-red-600 disabled:bg-red-400'
                  : 'bg-neutral-900 text-white hover:bg-neutral-800 disabled:bg-neutral-700'
              }`}
            >
              {isActionLoading ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : isStarted ? (
                <>
                  <LogOut className="h-5 w-5" />
                  Leave Course
                </>
              ) : (
                <>
                  <LogIn className="h-5 w-5" />
                  Start Course
                </>
              )}
            </button>
            {renderContributorButton()}
          </>
        ) : (
          <div className="nice-shadow rounded-lg border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-amber-800" />
              <h3 className="font-semibold text-amber-800">Paid Course</h3>
            </div>
            <p className="mt-1 text-sm text-amber-700">
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
              className="nice-shadow flex w-full items-center justify-center gap-2 rounded-lg bg-neutral-900 py-3 font-semibold text-white transition-colors hover:bg-neutral-800"
              onClick={() => setIsModalOpen(true)}
            >
              <ShoppingCart className="h-5 w-5" />
              Purchase Course
            </button>
            {renderContributorButton()}
          </>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <button
        onClick={handleCourseAction}
        disabled={isActionLoading}
        className={`nice-shadow flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg py-3 font-semibold transition-colors ${
          isStarted
            ? 'bg-red-500 text-white hover:bg-red-600 disabled:bg-red-400'
            : 'bg-neutral-900 text-white hover:bg-neutral-800 disabled:bg-neutral-700'
        }`}
      >
        {isActionLoading ? (
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent" />
        ) : !session.data?.user ? (
          <>
            <LogIn className="h-5 w-5" />
            Authenticate to start course
          </>
        ) : isStarted ? (
          <>
            <LogOut className="h-5 w-5" />
            Leave Course
          </>
        ) : (
          <>
            <LogIn className="h-5 w-5" />
            Start Course
          </>
        )}
      </button>
      {renderContributorButton()}
    </div>
  )
}

function CoursesActions({ courseuuid, orgslug, course }: CourseActionsProps) {
  const router = useRouter()
  const session = useLHSession() as any
  const isMobile = useMediaQuery('(max-width: 768px)')

  // Filter active authors and sort by role priority
  const sortedAuthors = [...course.authors]
    .filter((author) => author.authorship_status === 'ACTIVE')
    .sort((a, b) => {
      const rolePriority: Record<string, number> = {
        CREATOR: 0,
        MAINTAINER: 1,
        CONTRIBUTOR: 2,
        REPORTER: 3,
      }
      return rolePriority[a.authorship] - rolePriority[b.authorship]
    })

  return (
    <div className="flex flex-col space-y-3 overflow-hidden rounded-lg bg-white p-3 py-5 antialiased shadow-md shadow-gray-300/25 outline outline-1 outline-neutral-200/40">
      <MultipleAuthors authors={sortedAuthors} isMobile={isMobile} />
      <div className="px-3 py-2">
        <Actions courseuuid={courseuuid} orgslug={orgslug} course={course} />
      </div>
    </div>
  )
}

export default CoursesActions
