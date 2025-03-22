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
import { LogIn, LogOut, ShoppingCart, AlertCircle, UserPen, ClockIcon } from 'lucide-react'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import CoursePaidOptions from './CoursePaidOptions'
import { checkPaidAccess } from '@services/payments/payments'
import { applyForContributor, getCourseContributors } from '@services/courses/courses'
import toast from 'react-hot-toast'

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

const MultipleAuthors = ({ authors, isMobile }: { authors: Author[], isMobile: boolean }) => {
  const displayedAvatars = authors.slice(0, 3)
  const displayedNames = authors.slice(0, 2)
  const remainingCount = Math.max(0, authors.length - 3)
  
  // Consistent sizes for both avatars and badge
  const avatarSize = isMobile ? 72 : 86
  const borderSize = "border-4"

  return (
    <div className="flex flex-col items-center space-y-4 px-2 py-2">
      <div className="text-[12px] text-neutral-400 font-semibold self-start">Authors</div>
      
      {/* Avatars row */}
      <div className="flex justify-center -space-x-6 relative">
        {displayedAvatars.map((author, index) => (
          <div
            key={author.user.user_uuid}
            className="relative"
            style={{ zIndex: displayedAvatars.length - index }}
          >
            <div className="ring-white">
              <UserAvatar
                border={borderSize}
                rounded='rounded-full'
                avatar_url={author.user.avatar_image ? getUserAvatarMediaDirectory(author.user.user_uuid, author.user.avatar_image) : ''}
                predefined_avatar={author.user.avatar_image ? undefined : 'empty'}
                width={avatarSize}
              />
            </div>
          </div>
        ))}
        {remainingCount > 0 && (
          <div 
            className="relative"
            style={{ zIndex: 0 }}
          >
            <div 
              className="flex items-center justify-center bg-neutral-100 text-neutral-600 font-medium rounded-full border-4 border-white shadow-sm"
              style={{ 
                width: `${avatarSize}px`, 
                height: `${avatarSize}px`,
                fontSize: isMobile ? '14px' : '16px'
              }}
            >
              +{remainingCount}
            </div>
          </div>
        )}
      </div>

      {/* Names row - improved display logic */}
      <div className="text-center mt-2">
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
                  {index === 0 && authors.length > 1 && index < displayedNames.length - 1 && " & "}
                </span>
              ))}
              {authors.length > 2 && (
                <span className="text-neutral-500 ml-1">
                  & {authors.length - 2} more
                </span>
              )}
            </>
          )}
        </div>
        <div className="text-xs text-neutral-500 mt-0.5">
          {authors.length === 1 ? (
            <span>@{authors[0].user.username}</span>
          ) : (
            <>
              {displayedNames.map((author, index) => (
                <span key={author.user.user_uuid}>
                  @{author.user.username}
                  {index === 0 && authors.length > 1 && index < displayedNames.length - 1 && " & "}
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
  const [contributorStatus, setContributorStatus] = useState<'NONE' | 'PENDING' | 'ACTIVE' | 'INACTIVE'>('NONE')

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

  // Check if the current user is already a contributor
  useEffect(() => {
    const checkContributorStatus = async () => {
      if (!session.data?.user) return

      try {
        const response = await getCourseContributors(
          'course_' + courseuuid,
          session.data?.tokens?.access_token
        )
        
        if (response && response.data) {
          const currentUser = response.data.find(
            (contributor: any) => contributor.user_id === session.data.user.id
          )
          
          if (currentUser) {
            setContributorStatus(currentUser.authorship_status as 'PENDING' | 'ACTIVE' | 'INACTIVE')
          } else {
            setContributorStatus('NONE')
          }
        }
      } catch (error) {
        console.error('Failed to check contributor status:', error)
        toast.error('Failed to check contributor status. Please try again later.')
      }
    }

    if (session.data?.user) {
      checkContributorStatus()
    }
  }, [courseuuid, session.data?.tokens?.access_token, session.data?.user])

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
        toast.error('Failed to check course access. Please try again later.')
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

    setIsActionLoading(true)
    const loadingToast = toast.loading(
      isStarted ? 'Leaving course...' : 'Starting course...'
    )
    
    try {
      if (isStarted) {
        await removeCourse('course_' + courseuuid, orgslug, session.data?.tokens?.access_token)
        await revalidateTags(['courses'], orgslug)
        toast.success('Successfully left the course', { id: loadingToast })
        router.refresh()
      } else {
        await startCourse('course_' + courseuuid, orgslug, session.data?.tokens?.access_token)
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
        message: "I would like to contribute to this course."
      }
      
      await applyForContributor('course_' + courseuuid, data, session.data?.tokens?.access_token)
      setContributorStatus('PENDING')
      await revalidateTags(['courses'], orgslug)
      toast.success('Your application to contribute has been submitted successfully', { id: loadingToast })
    } catch (error) {
      console.error('Failed to apply as contributor:', error)
      toast.error('Failed to submit your application. Please try again later.', { id: loadingToast })
    } finally {
      setIsContributeLoading(false)
    }
  }

  if (isLoading) {
    return <div className="animate-pulse h-20 bg-gray-100 rounded-lg nice-shadow" />
  }

  const renderContributorButton = () => {
    // Don't render anything if the course is not open to contributors or if the user status is INACTIVE
    if (contributorStatus === 'INACTIVE' || course.open_to_contributors !== true) {
      return null;
    }
    
    if (!session.data?.user) {
      return (
        <button
          onClick={() => router.push(getUriWithoutOrg(`/signup?orgslug=${orgslug}`))}
          className="w-full bg-white text-neutral-700 border border-neutral-200 py-3 rounded-lg nice-shadow font-semibold hover:bg-neutral-50 transition-colors flex items-center justify-center gap-2 mt-3 cursor-pointer"
        >
          <UserPen className="w-5 h-5" />
          Authenticate to contribute
        </button>
      );
    }

    if (contributorStatus === 'ACTIVE') {
      return (
        <div className="w-full bg-green-50 text-green-700 border border-green-200 py-3 rounded-lg nice-shadow font-semibold flex items-center justify-center gap-2 mt-3">
          <UserPen className="w-5 h-5" />
          You are a contributor
        </div>
      );
    }

    if (contributorStatus === 'PENDING') {
      return (
        <div className="w-full bg-amber-50 text-amber-700 border border-amber-200 py-3 rounded-lg nice-shadow font-semibold flex items-center justify-center gap-2 mt-3">
          <ClockIcon className="w-5 h-5" />
          Contributor application pending
        </div>
      );
    }

    return (
      <button
        onClick={handleApplyToContribute}
        disabled={isContributeLoading}
        className="w-full bg-white text-neutral-700 py-3 rounded-lg nice-shadow font-semibold hover:bg-neutral-50 transition-colors flex items-center justify-center gap-2 mt-3 cursor-pointer disabled:cursor-not-allowed"
      >
        {isContributeLoading ? (
          <div className="w-5 h-5 border-2 border-neutral-700 border-t-transparent rounded-full animate-spin" />
        ) : (
          <>
            <UserPen className="w-5 h-5" />
            Apply to contribute
          </>
        )}
      </button>
    );
  };

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
              disabled={isActionLoading}
              className={`w-full py-3 rounded-lg nice-shadow font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer ${
                isStarted
                  ? 'bg-red-500 text-white hover:bg-red-600 disabled:bg-red-400'
                  : 'bg-neutral-900 text-white hover:bg-neutral-800 disabled:bg-neutral-700'
              }`}
            >
              {isActionLoading ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
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
            {renderContributorButton()}
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
        className={`w-full py-3 rounded-lg nice-shadow font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer ${
          isStarted
            ? 'bg-red-500 text-white hover:bg-red-600 disabled:bg-red-400'
            : 'bg-neutral-900 text-white hover:bg-neutral-800 disabled:bg-neutral-700'
        }`}
      >
        {isActionLoading ? (
          <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
        ) : !session.data?.user ? (
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
    .filter(author => author.authorship_status === 'ACTIVE')
    .sort((a, b) => {
      const rolePriority: Record<string, number> = {
        'CREATOR': 0,
        'MAINTAINER': 1,
        'CONTRIBUTOR': 2,
        'REPORTER': 3
      };
      return rolePriority[a.authorship] - rolePriority[b.authorship];
    });

  return (
    <div className="space-y-3 antialiased flex flex-col p-3 py-5 bg-white shadow-md shadow-gray-300/25 outline outline-1 outline-neutral-200/40 rounded-lg overflow-hidden">
      <MultipleAuthors authors={sortedAuthors} isMobile={isMobile} />
      <div className='px-3 py-2'>
        <Actions courseuuid={courseuuid} orgslug={orgslug} course={course} />
      </div>
    </div>
  )
}

export default CoursesActions