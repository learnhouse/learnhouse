import React, { useState, useEffect } from 'react'
import { removeCourse, startCourse } from '@services/courses/activity'
import { revalidateTags } from '@services/utils/ts/requests'
import { useRouter } from 'next/navigation'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl, getUriWithOrg, getUriWithoutOrg } from '@services/config/config'
import { getProductsByCourse } from '@services/payments/products'
import { LogIn, LogOut, ShoppingCart, AlertCircle, UserPen, ClockIcon, ArrowRight, Sparkles, BookOpen } from 'lucide-react'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import CoursePaidOptions from './CoursePaidOptions'
import { checkPaidAccess } from '@services/payments/payments'
import { applyForContributor } from '@services/courses/courses'
import toast from 'react-hot-toast'
import { useContributorStatus } from '../../../../hooks/useContributorStatus'
import CourseProgress from '../CourseProgress/CourseProgress'
import UserAvatar from '@components/Objects/UserAvatar'
import { useOrg } from '@components/Contexts/OrgContext'
import { mutate } from 'swr'

interface CourseRun {
  status: string
  course_id: string
  steps: Array<{
    activity_id: string
    complete: boolean
  }>
}

interface Course {
  id: string
  course_uuid: string
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
  trailData?: any
}

function CoursesActions({ courseuuid, orgslug, course, trailData }: CourseActionsProps) {
  const router = useRouter()
  const session = useLHSession() as any
  const [linkedProducts, setLinkedProducts] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isActionLoading, setIsActionLoading] = useState(false)
  const [isContributeLoading, setIsContributeLoading] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [hasAccess, setHasAccess] = useState<boolean | null>(null)
  const { contributorStatus, refetch } = useContributorStatus(courseuuid)
  const [isProgressOpen, setIsProgressOpen] = useState(false)
  const org = useOrg() as any

  // Clean up course UUID by removing 'course_' prefix if it exists
  const cleanCourseUuid = course.course_uuid?.replace('course_', '');

  const isStarted = trailData?.runs?.find(
    (run: any) => {
      const cleanRunCourseUuid = run.course?.course_uuid?.replace('course_', '');
      return cleanRunCourseUuid === cleanCourseUuid;
    }
  ) ?? false;

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
        mutate(`${getAPIUrl()}trail/org/${org?.id}/trail`)
        toast.success('Successfully left the course', { id: loadingToast })
      } else {
        await startCourse('course_' + courseuuid, orgslug, session.data?.tokens?.access_token)
        mutate(`${getAPIUrl()}trail/org/${org?.id}/trail`)
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
          mutate(`${getAPIUrl()}trail/org/${org?.id}/trail`)
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
      await revalidateTags(['courses'], orgslug)
      await refetch()
      toast.success('Your application to contribute has been submitted successfully', { id: loadingToast })
    } catch (error) {
      console.error('Failed to apply as contributor:', error)
      toast.error('Failed to submit your application. Please try again later.', { id: loadingToast })
    } finally {
      setIsContributeLoading(false)
    }
  }

  const renderActionButton = (action: 'start' | 'leave') => {
    if (!session.data?.user) {
      return (
        <>
          <UserAvatar width={24} predefined_avatar="empty" rounded="rounded-full" border="border-2" borderColor="border-white" />
          <span>{action === 'start' ? 'Start Course' : 'Leave Course'}</span>
          <ArrowRight className="w-5 h-5" />
        </>
      );
    }

    return (
      <>
        <UserAvatar 
          width={24} 
          use_with_session={true} 
          rounded="rounded-full" 
          border="border-2" 
          borderColor="border-white"
        />
        <span>{action === 'start' ? 'Start Course' : 'Leave Course'}</span>
        <ArrowRight className="w-5 h-5" />
      </>
    );
  };

  const renderContributorButton = () => {
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

  const renderProgressSection = () => {
    const totalActivities = course.chapters?.reduce((acc: number, chapter: any) => acc + chapter.activities.length, 0) || 0;
    
    // Find the correct run using the cleaned UUID
    const run = trailData?.runs?.find(
      (run: any) => {
        const cleanRunCourseUuid = run.course?.course_uuid?.replace('course_', '');
        return cleanRunCourseUuid === cleanCourseUuid;
      }
    );
    
    const completedActivities = run?.steps?.filter((step: any) => step.complete)?.length || 0;
    const progressPercentage = Math.round((completedActivities / totalActivities) * 100);

    if (!isStarted) {
      return (
        <div className="relative bg-white nice-shadow rounded-lg overflow-hidden">
          <div 
            className="absolute inset-0 opacity-[0.05]" 
            style={{
              backgroundImage: 'radial-gradient(circle at center, #101010 1px, transparent 1px)',
              backgroundSize: '12px 12px'
            }}
          />
          <div className="relative p-4">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-4">
                  <div className="relative w-16 h-16">
                    <svg className="w-full h-full transform -rotate-90">
                      <circle
                        cx="32"
                        cy="32"
                        r="28"
                        stroke="#e5e7eb"
                        strokeWidth="6"
                        fill="none"
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <BookOpen className="w-6 h-6 text-neutral-400" />
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-900">Ready to Begin?</div>
                    <div className="text-sm text-gray-500">
                      Start your learning journey with {totalActivities} exciting {totalActivities === 1 ? 'activity' : 'activities'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
        <div className="relative bg-white nice-shadow rounded-lg overflow-hidden">
          <div 
          className="absolute inset-0 opacity-[0.05]" 
          style={{
            backgroundImage: 'radial-gradient(circle at center, #000 1px, transparent 1px)',
            backgroundSize: '24px 24px'
          }}
        />
        <div className="relative p-4">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-4">
                <div className="relative w-16 h-16">
                  <svg className="w-full h-full transform -rotate-90">
                    <circle
                      cx="32"
                      cy="32"
                      r="28"
                      stroke="#e5e7eb"
                      strokeWidth="6"
                      fill="none"
                    />
                    <circle
                      cx="32"
                      cy="32"
                      r="28"
                      stroke="#10b981"
                      strokeWidth="6"
                      fill="none"
                      strokeLinecap="round"
                      strokeDasharray={2 * Math.PI * 28}
                      strokeDashoffset={2 * Math.PI * 28 * (1 - completedActivities / totalActivities)}
                      className="transition-all duration-500 ease-out"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-lg font-bold text-gray-800">
                      {progressPercentage}%
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setIsProgressOpen(true)}
                  className="flex-1 text-left hover:bg-neutral-50/50 p-2 rounded-lg transition-colors"
                >
                  <div className="text-sm font-medium text-gray-900">Course Progress</div>
                  <div className="text-sm text-gray-500">
                    {completedActivities} of {totalActivities} completed
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (isLoading) {
    return <div className="animate-pulse h-20 bg-gray-100 rounded-lg nice-shadow" />
  }

  if (linkedProducts.length > 0) {
    return (
      <div className="bg-white shadow-md shadow-gray-300/25 outline outline-1 outline-neutral-200/40 rounded-lg overflow-hidden p-4">
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
                ) : (
                  renderActionButton(isStarted ? 'leave' : 'start')
                )}
              </button>
              {renderContributorButton()}
            </>
          ) : (
            <>
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg nice-shadow">
                <div className="flex items-center gap-3">
                  <AlertCircle className="w-5 h-5 text-amber-800" />
                  <h3 className="text-amber-800 font-semibold">Paid Course</h3>
                </div>
                <p className="text-amber-700 text-sm mt-1">
                  This course requires purchase to access its content.
                </p>
              </div>
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
      </div>
    )
  }

  return (
    <div className="bg-white shadow-md shadow-gray-300/25 outline outline-1 outline-neutral-200/40 rounded-lg overflow-hidden p-4">
      <div className="space-y-4">
        {/* Progress Section */}
        {renderProgressSection()}

        {/* Start/Leave Course Button */}
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
          ) : (
            renderActionButton(isStarted ? 'leave' : 'start')
          )}
        </button>

        {/* Contributor Button */}
        {renderContributorButton()}

        {/* Course Progress Modal */}
        <CourseProgress
          course={course}
          orgslug={orgslug}
          isOpen={isProgressOpen}
          onClose={() => setIsProgressOpen(false)}
          trailData={trailData}
        />
      </div>
    </div>
  )
}

export default CoursesActions