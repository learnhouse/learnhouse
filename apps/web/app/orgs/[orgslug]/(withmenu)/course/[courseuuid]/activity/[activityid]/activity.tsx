'use client'
import Link from 'next/link'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import { BookOpenCheck, Check, CheckCircle, ChevronDown, ChevronLeft, ChevronRight, FileText, Folder, List, Menu, MoreVertical, UserRoundPen, Video, Layers, ListFilter, ListTree, X, Edit2, EllipsisVertical, Maximize2, Minimize2 } from 'lucide-react'
import { markActivityAsComplete, unmarkActivityAsComplete } from '@services/courses/activity'
import { usePathname, useRouter } from 'next/navigation'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import { getCourseThumbnailMediaDirectory, getUserAvatarMediaDirectory } from '@services/media/media'
import { useOrg } from '@components/Contexts/OrgContext'
import { CourseProvider } from '@components/Contexts/CourseContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import React, { useEffect, useRef, useMemo, lazy, Suspense } from 'react'
import { getAssignmentFromActivityUUID, getFinalGrade, submitAssignmentForGrading } from '@services/courses/assignments'
import { AssignmentProvider } from '@components/Contexts/Assignments/AssignmentContext'
import { AssignmentsTaskProvider } from '@components/Contexts/Assignments/AssignmentsTaskContext'
import AssignmentSubmissionProvider, { useAssignmentSubmission } from '@components/Contexts/Assignments/AssignmentSubmissionContext'
import toast from 'react-hot-toast'
import { mutate } from 'swr'
import useSWR from 'swr'
import { swrFetcher } from '@services/utils/ts/requests'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import { useMediaQuery } from 'usehooks-ts'
import PaidCourseActivityDisclaimer from '@components/Objects/Courses/CourseActions/PaidCourseActivityDisclaimer'
import { useContributorStatus } from '../../../../../../../../hooks/useContributorStatus'
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'
import ActivityNavigation from '@components/Pages/Activity/ActivityNavigation'
import ActivityChapterDropdown from '@components/Pages/Activity/ActivityChapterDropdown'
import FixedActivitySecondaryBar from '@components/Pages/Activity/FixedActivitySecondaryBar'
import CourseEndView from '@components/Pages/Activity/CourseEndView'
import { motion, AnimatePresence } from 'framer-motion'
import ActivityBreadcrumbs from '@components/Pages/Activity/ActivityBreadcrumbs'
import MiniInfoTooltip from '@components/Objects/MiniInfoTooltip'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import ActivityIndicators from '@components/Pages/Courses/ActivityIndicators'
import { revalidateTags } from '@services/utils/ts/requests'
import UserAvatar from '@components/Objects/UserAvatar'
import CoursesActions from '@components/Objects/Courses/CourseActions/CoursesActions'

// Lazy load heavy components
const Canva = lazy(() => import('@components/Objects/Activities/DynamicCanva/DynamicCanva'))
const VideoActivity = lazy(() => import('@components/Objects/Activities/Video/Video'))
const DocumentPdfActivity = lazy(() => import('@components/Objects/Activities/DocumentPdf/DocumentPdf'))
const AssignmentStudentActivity = lazy(() => import('@components/Objects/Activities/Assignment/AssignmentStudentActivity'))
const AIActivityAsk = lazy(() => import('@components/Objects/Activities/AI/AIActivityAsk'))
const AIChatBotProvider = lazy(() => import('@components/Contexts/AI/AIChatBotContext'))

// Loading fallback component
const LoadingFallback = () => (
  <div className="flex items-center justify-center h-64">
    <div className="relative w-6 h-6">
      <div className="absolute top-0 left-0 w-full h-full border-2 border-gray-100 rounded-full"></div>
      <div className="absolute top-0 left-0 w-full h-full border-2 border-gray-400 rounded-full animate-spin border-t-transparent"></div>
    </div>
  </div>
);

interface ActivityClientProps {
  activityid: string
  courseuuid: string
  orgslug: string
  activity: any
  course: any
}

interface ActivityActionsProps {
  activity: any
  activityid: string
  course: any
  orgslug: string
  assignment: any
  showNavigation?: boolean
}

// Custom hook for activity position
function useActivityPosition(course: any, activityId: string) {
  return useMemo(() => {
    let allActivities: any[] = [];
    let currentIndex = -1;
    
    course.chapters.forEach((chapter: any) => {
      chapter.activities.forEach((activity: any) => {
        const cleanActivityUuid = activity.activity_uuid?.replace('activity_', '');
        allActivities.push({
          ...activity,
          cleanUuid: cleanActivityUuid,
          chapterName: chapter.name
        });
        
        if (cleanActivityUuid === activityId.replace('activity_', '')) {
          currentIndex = allActivities.length - 1;
        }
      });
    });
    
    return { allActivities, currentIndex };
  }, [course, activityId]);
}

function ActivityActions({ activity, activityid, course, orgslug, assignment, showNavigation = true }: ActivityActionsProps) {
  
  const { contributorStatus } = useContributorStatus(course.course_uuid);
  const org = useOrg() as any;
  const session = useLHSession() as any;
  const access_token = session?.data?.tokens?.access_token;

  // Add SWR for trail data
  const { data: trailData } = useSWR(
    `${getAPIUrl()}trail/org/${org?.id}/trail`,
    (url) => swrFetcher(url, access_token)
  );


  return (
    <div className="flex space-x-2 items-center">
      {activity && activity.published == true && activity.content.paid_access != false && (
        <AuthenticatedClientElement checkMethod="authentication">
          {activity.activity_type != 'TYPE_ASSIGNMENT' && (
            <>
              <MarkStatus
                activity={activity}
                activityid={activityid}
                course={course}
                orgslug={orgslug}
                trailData={trailData}
              />
            </>
          )}
          {activity.activity_type == 'TYPE_ASSIGNMENT' && (
            <>
              <AssignmentSubmissionProvider assignment_uuid={assignment?.assignment_uuid}>
                <AssignmentTools
                  assignment={assignment}
                  activity={activity}
                  activityid={activityid}
                  course={course}
                  orgslug={orgslug}
                />
              </AssignmentSubmissionProvider>
            </>
          )}
          {showNavigation && (
            <NextActivityButton course={course} currentActivityId={activity.id} orgslug={orgslug} />
          )}
        </AuthenticatedClientElement>
      )}
    </div>
  );
}

function getRelativeTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (years > 0) return `${years} year${years > 1 ? 's' : ''} ago`;
  if (months > 0) return `${months} month${months > 1 ? 's' : ''} ago`;
  if (weeks > 0) return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  return 'just now';
}

function ActivityClient(props: ActivityClientProps) {
  const activityid = props.activityid
  const courseuuid = props.courseuuid
  const orgslug = props.orgslug
  const activity = props.activity
  const course = props.course
  const org = useOrg() as any
  const session = useLHSession() as any;
  const pathname = usePathname()
  const access_token = session?.data?.tokens?.access_token;
  const [bgColor, setBgColor] = React.useState('bg-white')
  const [assignment, setAssignment] = React.useState(null) as any;
  const [markStatusButtonActive, setMarkStatusButtonActive] = React.useState(false);
  const [isFocusMode, setIsFocusMode] = React.useState(false);
  const isInitialRender = useRef(true);
  const { contributorStatus } = useContributorStatus(courseuuid);
  const router = useRouter();

  // Add SWR for trail data
  const { data: trailData, error: error } = useSWR(
    `${getAPIUrl()}trail/org/${org?.id}/trail`,
    (url) => swrFetcher(url, access_token)
  )

  // Memoize activity position calculation
  const { allActivities, currentIndex } = useActivityPosition(course, activityid);
  
  // Get previous and next activities
  const prevActivity = currentIndex > 0 ? allActivities[currentIndex - 1] : null;
  const nextActivity = currentIndex < allActivities.length - 1 ? allActivities[currentIndex + 1] : null;

  // Memoize activity content
  const activityContent = useMemo(() => {
    if (!activity || !activity.published || activity.content.paid_access === false) {
      return null;
    }

    switch (activity.activity_type) {
      case 'TYPE_DYNAMIC':
        return (
          <Suspense fallback={<LoadingFallback />}>
            <Canva content={activity.content} activity={activity} />
          </Suspense>
        );
      case 'TYPE_VIDEO':
        return (
          <Suspense fallback={<LoadingFallback />}>
            <VideoActivity course={course} activity={activity} />
          </Suspense>
        );
      case 'TYPE_DOCUMENT':
        return (
          <Suspense fallback={<LoadingFallback />}>
            <DocumentPdfActivity course={course} activity={activity} />
          </Suspense>
        );
      case 'TYPE_ASSIGNMENT':
        return assignment ? (
          <Suspense fallback={<LoadingFallback />}>
            <AssignmentProvider assignment_uuid={assignment?.assignment_uuid}>
              <AssignmentsTaskProvider>
                <AssignmentSubmissionProvider assignment_uuid={assignment?.assignment_uuid}>
                  <AssignmentStudentActivity />
                </AssignmentSubmissionProvider>
              </AssignmentsTaskProvider>
            </AssignmentProvider>
          </Suspense>
        ) : null;
      default:
        return null;
    }
  }, [activity, course, assignment]);

  // Navigate to an activity
  const navigateToActivity = (activity: any) => {
    if (!activity) return;
    
    const cleanCourseUuid = course.course_uuid?.replace('course_', '');
    router.push(getUriWithOrg(orgslug, '') + `/course/${cleanCourseUuid}/activity/${activity.cleanUuid}`);
  };

  // Initialize focus mode from localStorage
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('globalFocusMode');
      setIsFocusMode(saved === 'true');
    }
  }, []);

  // Save focus mode to localStorage
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('globalFocusMode', isFocusMode.toString());
      // Dispatch custom event for focus mode change
      window.dispatchEvent(new CustomEvent('focusModeChange', { 
        detail: { isFocusMode } 
      }));
      isInitialRender.current = false;
    }
  }, [isFocusMode]);

  function getChapterNameByActivityId(course: any, activity_id: any) {
    for (let i = 0; i < course.chapters.length; i++) {
      let chapter = course.chapters[i]
      for (let j = 0; j < chapter.activities.length; j++) {
        let activity = chapter.activities[j]
        if (activity.id === activity_id) {
          return `Chapter ${i + 1} : ${chapter.name}`
        }
      }
    }
    return null // return null if no matching activity is found
  }

  async function getAssignmentUI() {
    const assignment = await getAssignmentFromActivityUUID(activity.activity_uuid, access_token)
    setAssignment(assignment.data)
  }

  useEffect(() => {
    if (activity.activity_type == 'TYPE_DYNAMIC') {
      setBgColor(isFocusMode ? 'bg-white' : 'bg-white nice-shadow');
    }
    else if (activity.activity_type == 'TYPE_ASSIGNMENT') {
      setMarkStatusButtonActive(false);
      setBgColor(isFocusMode ? 'bg-white' : 'bg-white nice-shadow');
      getAssignmentUI();
    }
    else {
      setBgColor(isFocusMode ? 'bg-zinc-950' : 'bg-zinc-950 nice-shadow');
    }
  }
    , [activity, pathname, isFocusMode])

  return (
    <>
      <CourseProvider courseuuid={course?.course_uuid}>
        <Suspense fallback={<LoadingFallback />}>
          <AIChatBotProvider>
            {isFocusMode ? (
              <AnimatePresence>
                <motion.div 
                  initial={isInitialRender.current ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="fixed inset-0 bg-white z-50"
                >
                  {/* Focus Mode Top Bar */}
                  <motion.div 
                    initial={isInitialRender.current ? false : { y: -100 }}
                    animate={{ y: 0 }}
                    exit={{ y: -100 }}
                    transition={{ duration: 0.3 }}
                    className="fixed top-0 left-0 right-0 z-50 bg-white/90 backdrop-blur-xl border-b border-gray-100"
                  >
                    <div className="container mx-auto px-4 py-2">
                      <div className="flex items-center justify-between h-14">
                        {/* Progress Indicator - Moved to left */}
                        <motion.div 
                          initial={isInitialRender.current ? false : { opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.2 }}
                          className="flex items-center space-x-2"
                        >
                          <div className="relative w-8 h-8">
                            <svg className="w-full h-full transform -rotate-90">
                              <circle
                                cx="16"
                                cy="16"
                                r="14"
                                stroke="#e5e7eb"
                                strokeWidth="3"
                                fill="none"
                              />
                              <circle
                                cx="16"
                                cy="16"
                                r="14"
                                stroke="#10b981"
                                strokeWidth="3"
                                fill="none"
                                strokeLinecap="round"
                                strokeDasharray={2 * Math.PI * 14}
                                strokeDashoffset={2 * Math.PI * 14 * (1 - (trailData?.runs?.find((run: any) => run.course_uuid === course.course_uuid)?.steps?.filter((step: any) => step.complete)?.length || 0) / (course.chapters?.reduce((acc: number, chapter: any) => acc + chapter.activities.length, 0) || 1))}
                              />
                            </svg>
                            <div className="absolute inset-0 flex items-center justify-center">
                              <span className="text-xs font-bold text-gray-800">
                                {Math.round(((trailData?.runs?.find((run: any) => run.course_uuid === course.course_uuid)?.steps?.filter((step: any) => step.complete)?.length || 0) / (course.chapters?.reduce((acc: number, chapter: any) => acc + chapter.activities.length, 0) || 1)) * 100)}%
                              </span>
                            </div>
                          </div>
                          <div className="text-xs text-gray-600">
                            {trailData?.runs?.find((run: any) => run.course_uuid === course.course_uuid)?.steps?.filter((step: any) => step.complete)?.length || 0} of {course.chapters?.reduce((acc: number, chapter: any) => acc + chapter.activities.length, 0) || 0}
                          </div>
                        </motion.div>
                        
                        {/* Center Course Info */}
                        <motion.div 
                          initial={isInitialRender.current ? false : { opacity: 0, y: -20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.1 }}
                          className="flex items-center space-x-4"
                        >
                          <div className="flex">
                            <Link
                              href={getUriWithOrg(orgslug, '') + `/course/${courseuuid}`}
                            >
                              <img
                                className="w-[60px] h-[34px] rounded-md drop-shadow-md"
                                src={`${getCourseThumbnailMediaDirectory(
                                  org?.org_uuid,
                                  course.course_uuid,
                                  course.thumbnail_image
                                )}`}
                                alt=""
                              />
                            </Link>
                          </div>
                          <div className="flex flex-col -space-y-1">
                            <p className="font-bold text-gray-700 text-sm">Course </p>
                            <h1 className="font-bold text-gray-950 text-lg first-letter:uppercase">
                              {course.name}
                            </h1>
                          </div>
                        </motion.div>

                        {/* Minimize and Chapters - Moved to right */}
                        <motion.div 
                          initial={isInitialRender.current ? false : { opacity: 0, x: 20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.2 }}
                          className="flex items-center space-x-2"
                        >
                          <ActivityChapterDropdown 
                            course={course}
                            currentActivityId={activity.activity_uuid ? activity.activity_uuid.replace('activity_', '') : activityid.replace('activity_', '')}
                            orgslug={orgslug}
                            trailData={trailData}
                          />
                          <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => setIsFocusMode(false)}
                            className="bg-white nice-shadow p-2 rounded-full cursor-pointer hover:bg-gray-50"
                            title="Exit focus mode"
                          >
                            <Minimize2 size={16} className="text-gray-700" />
                          </motion.button>
                        </motion.div>
                      </div>
                    </div>
                  </motion.div>

                  {/* Focus Mode Content */}
                  <div className="pt-16 pb-20 h-full overflow-auto">
                    <div className="container mx-auto px-4">
                      {activity && activity.published == true && (
                        <>
                          {activity.content.paid_access == false ? (
                            <PaidCourseActivityDisclaimer course={course} />
                          ) : (
                            <motion.div 
                              initial={isInitialRender.current ? false : { scale: 0.95, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              transition={{ delay: 0.3 }}
                              className={`p-7 rounded-lg ${bgColor} mt-4`}
                            >
                              {/* Activity Types */}
                              <div>
                                {activityContent}
                              </div>
                            </motion.div>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Focus Mode Bottom Bar */}
                  {activity && activity.published == true && activity.content.paid_access != false && (
                    <motion.div 
                      initial={isInitialRender.current ? false : { y: 100 }}
                      animate={{ y: 0 }}
                      exit={{ y: 100 }}
                      transition={{ duration: 0.3 }}
                      className="fixed bottom-0 left-0 right-0 z-50 bg-white/90 backdrop-blur-xl border-t border-gray-100"
                    >
                      <div className="container mx-auto px-4">
                        <div className="flex items-center justify-between h-16">
                          <div className="flex items-center space-x-2">
                            <button
                              onClick={() => navigateToActivity(prevActivity)}
                              className={`flex items-center space-x-1.5 p-2 rounded-md transition-all duration-200 cursor-pointer ${
                                prevActivity 
                                  ? 'text-gray-700' 
                                  : 'opacity-50 text-gray-400 cursor-not-allowed'
                              }`}
                              disabled={!prevActivity}
                              title={prevActivity ? `Previous: ${prevActivity.name}` : 'No previous activity'}
                            >
                              <ChevronLeft size={20} className="text-gray-800 shrink-0" />
                              <div className="flex flex-col items-start">
                                <span className="text-xs text-gray-500">Previous</span>
                                <span className="text-sm capitalize font-semibold text-left">
                                  {prevActivity ? prevActivity.name : 'No previous activity'}
                                </span>
                              </div>
                            </button>
                          </div>
                          <div className="flex items-center space-x-2">
                            <ActivityActions 
                              activity={activity}
                              activityid={activityid}
                              course={course}
                              orgslug={orgslug}
                              assignment={assignment}
                              showNavigation={false}
                            />
                            <button
                              onClick={() => navigateToActivity(nextActivity)}
                              className={`flex items-center space-x-1.5 p-2 rounded-md transition-all duration-200 cursor-pointer ${
                                nextActivity 
                                  ? 'text-gray-700' 
                                  : 'opacity-50 text-gray-400 cursor-not-allowed'
                              }`}
                              disabled={!nextActivity}
                              title={nextActivity ? `Next: ${nextActivity.name}` : 'No next activity'}
                            >
                              <div className="flex flex-col items-end">
                                <span className="text-xs text-gray-500">Next</span>
                                <span className="text-sm capitalize font-semibold text-right">
                                  {nextActivity ? nextActivity.name : 'No next activity'}
                                </span>
                              </div>
                              <ChevronRight size={20} className="text-gray-800 shrink-0" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </motion.div>
              </AnimatePresence>
            ) : (
              <GeneralWrapperStyled>
                {/* Original non-focus mode UI */}
                {activityid === 'end' ? (
                  <CourseEndView 
                    courseName={course.name}
                    orgslug={orgslug}
                    courseUuid={course.course_uuid}
                    thumbnailImage={course.thumbnail_image}
                  />
                ) : (
                  <div className="space-y-4 pt-0">
                    <div className="pt-2">
                      <ActivityBreadcrumbs 
                        course={course}
                        activity={activity}
                        orgslug={orgslug}
                      />
                      <div className="space-y-4 pb-4 activity-info-section">
                        <div className="flex justify-between items-center">
                          <div className="flex space-x-6">
                            <div className="flex">
                              <Link
                                href={getUriWithOrg(orgslug, '') + `/course/${courseuuid}`}
                              >
                                <img
                                  className="w-[100px] h-[57px] rounded-md drop-shadow-md"
                                  src={`${getCourseThumbnailMediaDirectory(
                                    org?.org_uuid,
                                    course.course_uuid,
                                    course.thumbnail_image
                                  )}`}
                                  alt=""
                                />
                              </Link>
                            </div>
                            <div className="flex flex-col -space-y-1">
                              <p className="font-bold text-gray-700 text-md">Course </p>
                              <h1 className="font-bold text-gray-950 text-3xl first-letter:uppercase">
                                {course.name}
                              </h1>
                            </div>
                          </div>
                        </div>

                        <ActivityIndicators
                          course_uuid={courseuuid}
                          current_activity={activityid}
                          orgslug={orgslug}
                          course={course}
                          enableNavigation={true}
                          trailData={trailData}
                        />

                        <div className="flex justify-between items-center w-full">
                          <div className="flex flex-1/3 items-center space-x-3">
                            <div className="flex flex-col -space-y-1">
                              <p className="font-bold text-gray-700 text-md">
                                {getChapterNameByActivityId(course, activity.id)}
                              </p>
                              <h1 className="font-bold text-gray-950 text-2xl first-letter:uppercase">
                                {activity.name}
                              </h1>
                              {/* Authors and Dates Section */}
                              <div className="flex flex-wrap items-center gap-3 mt-2">
                                {/* Avatars */}
                                {course.authors && course.authors.length > 0 && (
                                  <div className="flex -space-x-3">
                                    {course.authors.filter((a: any) => a.authorship_status === 'ACTIVE').slice(0, 3).map((author: any, idx: number) => (
                                      <div key={author.user.user_uuid} className="relative z-[${10-idx}]">
                                        <UserAvatar
                                          border="border-2"
                                          rounded="rounded-full"
                                          avatar_url={author.user.avatar_image ? getUserAvatarMediaDirectory(author.user.user_uuid, author.user.avatar_image) : ''}
                                          predefined_avatar={author.user.avatar_image ? undefined : 'empty'}
                                          width={26}
                                          showProfilePopup={true}
                                          userId={author.user.id}
                                        />
                                      </div>
                                    ))}
                                    {course.authors.filter((a: any) => a.authorship_status === 'ACTIVE').length > 3 && (
                                      <div className="flex items-center justify-center bg-neutral-100 text-neutral-600 font-medium rounded-full border-2 border-white shadow-sm w-9 h-9 text-xs z-0">
                                        +{course.authors.filter((a: any) => a.authorship_status === 'ACTIVE').length - 3}
                                      </div>
                                    )}
                                  </div>
                                )}
                                {/* Author names */}
                                {course.authors && course.authors.length > 0 && (
                                  <div className="text-xs text-gray-700 font-medium flex items-center gap-1">
                                    {course.authors.filter((a: any) => a.authorship_status === 'ACTIVE').length > 1 && (
                                      <span>Co-created by </span>
                                    )}
                                    {course.authors.filter((a: any) => a.authorship_status === 'ACTIVE').slice(0, 2).map((author: any, idx: number, arr: any[]) => (
                                      <span key={author.user.user_uuid}>
                                        {author.user.first_name && author.user.last_name
                                          ? `${author.user.first_name} ${author.user.last_name}`
                                          : `@${author.user.username}`}
                                        {idx === 0 && arr.length > 1 ? ' & ' : ''}
                                      </span>
                                    ))}
                                    {course.authors.filter((a: any) => a.authorship_status === 'ACTIVE').length > 2 && (
                                      <ToolTip
                                        content={
                                          <div className="p-2">
                                            {course.authors
                                              .filter((a: any) => a.authorship_status === 'ACTIVE')
                                              .slice(2)
                                              .map((author: any) => (
                                                <div key={author.user.user_uuid} className="text-white text-sm py-1">
                                                  {author.user.first_name && author.user.last_name
                                                    ? `${author.user.first_name} ${author.user.last_name}`
                                                    : `@${author.user.username}`}
                                                </div>
                                              ))}
                                          </div>
                                        }
                                      >
                                        <div className="bg-gray-100 hover:bg-gray-200 text-gray-600 px-2 py-0.5 rounded-md cursor-pointer text-xs font-medium transition-colors duration-200">
                                          +{course.authors.filter((a: any) => a.authorship_status === 'ACTIVE').length - 2}
                                        </div>
                                      </ToolTip>
                                    )}
                                  </div>
                                )}
                                {/* Dates */}
                                <div className="flex items-center text-xs text-gray-500 gap-2">
                                  <span>
                                    Created on {new Date(course.creation_date).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
                                  </span>
                                  <span className="mx-1">•</span>
                                  <span>
                                    Last updated {getRelativeTime(new Date(course.updated_at || course.last_updated || course.creation_date))}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                          <div className="flex space-x-2 items-center">
                            {activity && activity.published == true && activity.content.paid_access != false && (
                              <AuthenticatedClientElement checkMethod="authentication">
                                {activity.activity_type != 'TYPE_ASSIGNMENT' && (
                                  <>
                                    <AIActivityAsk activity={activity} />
                                    <ActivityChapterDropdown 
                                      course={course}
                                      currentActivityId={activity.activity_uuid ? activity.activity_uuid.replace('activity_', '') : activityid.replace('activity_', '')}
                                      orgslug={orgslug}
                                      trailData={trailData}
                                    />
                                    {contributorStatus === 'ACTIVE' && activity.activity_type == 'TYPE_DYNAMIC' && (
                                      <Link
                                        href={getUriWithOrg(orgslug, '') + `/course/${courseuuid}/activity/${activityid}/edit`}
                                        className="bg-emerald-600 rounded-full px-5 drop-shadow-md flex items-center space-x-2 p-2.5 text-white hover:cursor-pointer transition delay-150 duration-300 ease-in-out"
                                      >
                                        <Edit2 size={17} />
                                        <span className="text-xs font-bold">Contribute</span>
                                      </Link>
                                    )}
                                  </>
                                )}
                              </AuthenticatedClientElement>
                            )}
                          </div>
                        </div>
                      </div>

                      {activity && activity.published == false && (
                        <div className="p-7 drop-shadow-xs rounded-lg bg-gray-800">
                          <div className="text-white">
                            <h1 className="font-bold text-2xl">
                              This activity is not published yet
                            </h1>
                          </div>
                        </div>
                      )}

                      {activity && activity.published == true && (
                        <>
                          {activity.content.paid_access == false ? (
                            <PaidCourseActivityDisclaimer course={course} />
                          ) : (
                            <div className={`p-7 drop-shadow-xs rounded-lg ${bgColor} relative`}>
                              <button
                                onClick={() => setIsFocusMode(true)}
                                className="absolute top-4 right-4 bg-white/80 hover:bg-white nice-shadow p-2 rounded-full cursor-pointer transition-all duration-200 group overflow-hidden z-50 pointer-events-auto"
                                title="Enter focus mode"
                              >
                                <div className="flex items-center">
                                  <Maximize2 size={16} className="text-gray-700" />
                                  <span className="text-xs font-bold text-gray-700 opacity-0 group-hover:opacity-100 transition-all duration-200 w-0 group-hover:w-auto group-hover:ml-2 whitespace-nowrap">
                                    Focus Mode
                                  </span>
                                </div>
                              </button>
                              {activityContent}
                            </div>
                          )}
                        </>
                      )}

                      {/* Activity Actions below the content box */}
                      {activity && activity.published == true && activity.content.paid_access != false && (
                        <div className="flex justify-between items-center mt-4 w-full">
                          <div>
                            <PreviousActivityButton 
                              course={course} 
                              currentActivityId={activity.id} 
                              orgslug={orgslug} 
                            />
                          </div>
                          <div className="flex items-center space-x-2">
                            <ActivityActions 
                              activity={activity}
                              activityid={activityid}
                              course={course}
                              orgslug={orgslug}
                              assignment={assignment}
                              showNavigation={false}
                            />
                            <NextActivityButton 
                              course={course} 
                              currentActivityId={activity.id} 
                              orgslug={orgslug} 
                            />
                          </div>
                        </div>
                      )}

                      {/* Fixed Activity Secondary Bar */}
                      {activity && activity.published == true && activity.content.paid_access != false && (
                        <FixedActivitySecondaryBar
                          course={course}
                          currentActivityId={activityid}
                          orgslug={orgslug}
                          activity={activity}
                        />
                      )}
                      
                      <div style={{ height: '100px' }}></div>
                    </div>
                  </div>
                )}
              </GeneralWrapperStyled>
            )}
          </AIChatBotProvider>
        </Suspense>
      </CourseProvider>
    </>
  )
}

export function MarkStatus(props: {
  activity: any
  activityid: string
  course: any
  orgslug: string,
  trailData: any
}) {
  const router = useRouter()
  const session = useLHSession() as any;
  const org = useOrg() as any;
  const isMobile = useMediaQuery('(max-width: 768px)')
  const [isLoading, setIsLoading] = React.useState(false);
  const [showMarkedTooltip, setShowMarkedTooltip] = React.useState(false);
  const [showUnmarkedTooltip, setShowUnmarkedTooltip] = React.useState(false);


  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      const markedTooltipCount = localStorage.getItem('activity_marked_tooltip_count');
      const unmarkedTooltipCount = localStorage.getItem('activity_unmarked_tooltip_count');
      
      if (!markedTooltipCount || parseInt(markedTooltipCount) < 3) {
        setShowMarkedTooltip(true);
      }
      if (!unmarkedTooltipCount || parseInt(unmarkedTooltipCount) < 3) {
        setShowUnmarkedTooltip(true);
      }
    }
  }, []);

  const handleMarkedTooltipClose = () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('activity_marked_tooltip_count', '3');
      setShowMarkedTooltip(false);
    }
  };

  const handleUnmarkedTooltipClose = () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('activity_unmarked_tooltip_count', '3');
      setShowUnmarkedTooltip(false);
    }
  };

  const infoIcon = (
    <svg 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );

  const areAllActivitiesCompleted = () => {
    const run = props.trailData?.runs?.find(
      (run: any) => run.course_uuid === props.course.course_uuid
    );
    if (!run) return false;

    let totalActivities = 0;
    let completedActivities = 0;

    props.course.chapters.forEach((chapter: any) => {
      chapter.activities.forEach((activity: any) => {
        totalActivities++;
        const isCompleted = run.steps.find(
          (step: any) => step.activity_uuid === activity.activity_uuid && step.complete === true
        );
        if (isCompleted) {
          completedActivities++;
        }
      });
    });

    return completedActivities >= totalActivities - 1;
  };

  async function markActivityAsCompleteFront() {
    try {
      const willCompleteAll = areAllActivitiesCompleted();
      setIsLoading(true);
      
      await markActivityAsComplete(
        props.orgslug,
        props.course.course_uuid,
        props.activity.activity_uuid,
        session.data?.tokens?.access_token
      );

      await mutate(`${getAPIUrl()}trail/org/${org?.id}/trail`);
      
      if (willCompleteAll) {
        const cleanCourseUuid = props.course.course_uuid.replace('course_', '');
        router.push(getUriWithOrg(props.orgslug, '') + `/course/${cleanCourseUuid}/activity/end`);
      }
    } catch (error) {
      console.error('Error marking activity as complete:', error);
      toast.error('Failed to mark activity as complete');
    } finally {
      setIsLoading(false);
    }
  }

  async function unmarkActivityAsCompleteFront() {
    try {
      setIsLoading(true);
      
      await unmarkActivityAsComplete(
        props.orgslug,
        props.course.course_uuid,
        props.activity.activity_uuid,
        session.data?.tokens?.access_token
      );

      await mutate(`${getAPIUrl()}trail/org/${org?.id}/trail`);
    } catch (error) {
      toast.error('Failed to unmark activity as complete');
    } finally {
      setIsLoading(false);
    }
  }

  const isActivityCompleted = () => {
    // Clean up course UUID by removing 'course_' prefix if it exists
    const cleanCourseUuid = props.course.course_uuid?.replace('course_', '');
    
    let run = props.trailData?.runs?.find(
      (run: any) => {
        const cleanRunCourseUuid = run.course?.course_uuid?.replace('course_', '');
        return cleanRunCourseUuid === cleanCourseUuid;
      }
    );

    if (run) {
      // Find the step that matches the current activity
      return run.steps.find(
        (step: any) => step.activity_id === props.activity.id && step.complete === true
      );
    }
    return false;
  }

  // Don't render until we have trail data
  if (!props.trailData) {
    return null;
  }

  return (
    <>
      {isActivityCompleted() ? (
        <div className="flex items-center space-x-2">
          <div className="relative">
            <ConfirmationModal
              confirmationButtonText="Unmark Activity"
              confirmationMessage="Are you sure you want to unmark this activity as complete? This will affect your course progress."
              dialogTitle="Unmark activity as complete"
              dialogTrigger={
                <div className="bg-teal-600 rounded-md px-4 nice-shadow flex flex-col p-2.5 text-white hover:cursor-pointer transition delay-150 duration-300 ease-in-out">
                  <span className="text-[10px] font-bold mb-1 uppercase">Status</span>
                  <div className="flex items-center space-x-2">
                    <svg 
                      width="17" 
                      height="17" 
                      viewBox="0 0 24 24" 
                      fill="none" 
                      stroke="currentColor" 
                      strokeWidth="2" 
                      strokeLinecap="round" 
                      strokeLinejoin="round"
                    >
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <path d="M7 12l3 3 7-7" />
                    </svg>
                    <span className="text-xs font-bold">Complete</span>
                  </div>
                </div>
              }
              functionToExecute={unmarkActivityAsCompleteFront}
              status="warning"
            />
            {showMarkedTooltip && (
              <MiniInfoTooltip
                icon={infoIcon}
                message="Click the checkbox to unmark as complete if needed"
                onClose={handleMarkedTooltipClose}
                iconColor="text-teal-600"
                iconSize={24}
                width="w-64"
              />
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center space-x-2">
          <div className="relative">
            <div
              className={`${isLoading ? 'opacity-90' : ''} bg-gray-800 rounded-md px-4 nice-shadow flex flex-col p-2.5 text-white hover:cursor-pointer transition-all duration-200 ${isLoading ? 'cursor-not-allowed' : 'hover:bg-gray-700'}`}
              onClick={!isLoading ? markActivityAsCompleteFront : undefined}
            >
              <span className="text-[10px] font-bold mb-1 uppercase">Status</span>
              <div className="flex items-center space-x-2">
                {isLoading ? (
                  <div className="animate-spin">
                    <svg 
                      width="17" 
                      height="17" 
                      viewBox="0 0 24 24" 
                      fill="none" 
                      stroke="currentColor" 
                      strokeWidth="2" 
                      strokeLinecap="round" 
                      strokeLinejoin="round"
                    >
                      <path d="M21 12a9 9 0 11-6.219-8.56" />
                    </svg>
                  </div>
                ) : (
                  <svg 
                    width="17" 
                    height="17" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="2" 
                    strokeLinecap="round" 
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                  </svg>
                )}
                <span className="text-xs font-bold min-w-[90px]">{isLoading ? 'Marking...' : 'Mark as complete'}</span>
              </div>
            </div>
            {showUnmarkedTooltip && (
              <MiniInfoTooltip
                icon={infoIcon}
                message="Click the checkbox to mark this activity as complete"
                onClose={handleUnmarkedTooltipClose}
                iconColor="text-gray-600"
                iconSize={24}
                width="w-64"
              />
            )}
          </div>
        </div>
      )}
    </>
  )
}

function NextActivityButton({ course, currentActivityId, orgslug }: { course: any, currentActivityId: string, orgslug: string }) {
  const router = useRouter();
  const isMobile = useMediaQuery('(max-width: 768px)');

  const findNextActivity = () => {
    let allActivities: any[] = [];
    let currentIndex = -1;
    
    // Flatten all activities from all chapters
    course.chapters.forEach((chapter: any) => {
      chapter.activities.forEach((activity: any) => {
        const cleanActivityUuid = activity.activity_uuid?.replace('activity_', '');
        allActivities.push({
          ...activity,
          cleanUuid: cleanActivityUuid,
          chapterName: chapter.name
        });
        
        // Check if this is the current activity
        if (activity.id === currentActivityId) {
          currentIndex = allActivities.length - 1;
        }
      });
    });
    
    // Get next activity
    return currentIndex < allActivities.length - 1 ? allActivities[currentIndex + 1] : null;
  };

  const nextActivity = findNextActivity();

  if (!nextActivity) return null;

  const navigateToActivity = () => {
    const cleanCourseUuid = course.course_uuid?.replace('course_', '');
    router.push(getUriWithOrg(orgslug, '') + `/course/${cleanCourseUuid}/activity/${nextActivity.cleanUuid}`);
  };

  return (
    <div
      onClick={navigateToActivity}
      className="bg-gray-200 rounded-md px-4 shadow-[inset_0_2px_4px_rgba(0,0,0,0.05)] flex flex-col p-2.5 text-gray-600 hover:cursor-pointer transition delay-150 duration-300 ease-in-out hover:bg-gray-200"
    >
      <span className="text-[10px] font-bold text-gray-500 mb-1 uppercase">Next</span>
      <div className="flex items-center space-x-1">
        <span className="text-sm font-semibold truncate max-w-[200px]">{nextActivity.name}</span>
        <ChevronRight size={17} />
      </div>
    </div>
  );
}

function PreviousActivityButton({ course, currentActivityId, orgslug }: { course: any, currentActivityId: string, orgslug: string }) {
  const router = useRouter();
  const isMobile = useMediaQuery('(max-width: 768px)');

  const findPreviousActivity = () => {
    let allActivities: any[] = [];
    let currentIndex = -1;
    
    // Flatten all activities from all chapters
    course.chapters.forEach((chapter: any) => {
      chapter.activities.forEach((activity: any) => {
        const cleanActivityUuid = activity.activity_uuid?.replace('activity_', '');
        allActivities.push({
          ...activity,
          cleanUuid: cleanActivityUuid,
          chapterName: chapter.name
        });
        
        // Check if this is the current activity
        if (activity.id === currentActivityId) {
          currentIndex = allActivities.length - 1;
        }
      });
    });
    
    // Get previous activity
    return currentIndex > 0 ? allActivities[currentIndex - 1] : null;
  };

  const previousActivity = findPreviousActivity();

  if (!previousActivity) return null;

  const navigateToActivity = () => {
    const cleanCourseUuid = course.course_uuid?.replace('course_', '');
    router.push(getUriWithOrg(orgslug, '') + `/course/${cleanCourseUuid}/activity/${previousActivity.cleanUuid}`);
  };

  return (
    <div
      onClick={navigateToActivity}
      className="bg-white rounded-md px-4 nice-shadow flex flex-col p-2.5 text-gray-600 hover:cursor-pointer transition delay-150 duration-300 ease-in-out"
    >
      <span className="text-[10px] font-bold text-gray-500 mb-1 uppercase">Previous</span>
      <div className="flex items-center space-x-1">
        <ChevronLeft size={17} />
        <span className="text-sm font-semibold truncate max-w-[200px]">{previousActivity.name}</span>
      </div>
    </div>
  );
}

function AssignmentTools(props: {
  activity: any
  activityid: string
  course: any
  orgslug: string
  assignment: any
}) {
  const submission = useAssignmentSubmission() as any
  const session = useLHSession() as any;
  const [finalGrade, setFinalGrade] = React.useState(null) as any;

  const submitForGradingUI = async () => {
    if (props.assignment) {
      const res = await submitAssignmentForGrading(
        props.assignment?.assignment_uuid,
        session.data?.tokens?.access_token
      )
      if (res.success) {
        toast.success('Assignment submitted for grading')
        mutate(`${getAPIUrl()}assignments/${props.assignment?.assignment_uuid}/submissions/me`,)
      }
      else {
        toast.error('Failed to submit assignment for grading')
      }
    }
  }

  const getGradingBasedOnMethod = async () => {
    const res = await getFinalGrade(
      session.data?.user?.id,
      props.assignment?.assignment_uuid,
      session.data?.tokens?.access_token
    );

    if (res.success) {
      const { grade, max_grade, grading_type } = res.data;
      let displayGrade;

      switch (grading_type) {
        case 'ALPHABET':
          displayGrade = convertNumericToAlphabet(grade, max_grade);
          break;
        case 'NUMERIC':
          displayGrade = `${grade}/${max_grade}`;
          break;
        case 'PERCENTAGE':
          const percentage = (grade / max_grade) * 100;
          displayGrade = `${percentage.toFixed(2)}%`;
          break;
        default:
          displayGrade = 'Unknown grading type';
      }

      // Use displayGrade here, e.g., update state or display it
      setFinalGrade(displayGrade);
    } else {
    }
  };

  // Helper function to convert numeric grade to alphabet grade
  function convertNumericToAlphabet(grade: any, maxGrade: any) {
    const percentage = (grade / maxGrade) * 100;
    if (percentage >= 90) return 'A';
    if (percentage >= 80) return 'B';
    if (percentage >= 70) return 'C';
    if (percentage >= 60) return 'D';
    return 'F';
  }

  useEffect(() => {
    if ( submission && submission.length > 0 && submission[0].submission_status === 'GRADED') {
      getGradingBasedOnMethod();
    }
  }
    , [submission, props.assignment])

  if (!submission || submission.length === 0) {
    return (
      <ConfirmationModal
        confirmationButtonText="Submit Assignment"
        confirmationMessage="Are you sure you want to submit your assignment for grading? Once submitted, you will not be able to make any changes."
        dialogTitle="Submit your assignment for grading"
        dialogTrigger={
          <div className="bg-cyan-800 rounded-md px-4 nice-shadow flex flex-col p-2.5 text-white hover:cursor-pointer transition delay-150 duration-300 ease-in-out">
            <span className="text-[10px] font-bold mb-1 uppercase">Status</span>
            <div className="flex items-center space-x-2">
              <BookOpenCheck size={17} />
              <span className="text-xs font-bold">Submit for grading</span>
            </div>
          </div>
        }
        functionToExecute={submitForGradingUI}
        status="info"
      />
    )
  }

  if (submission[0].submission_status === 'SUBMITTED') {
    return (
      <div className="bg-amber-800 rounded-md px-4 nice-shadow flex flex-col p-2.5 text-white transition delay-150 duration-300 ease-in-out">
        <span className="text-[10px] font-bold mb-1 uppercase">Status</span>
        <div className="flex items-center space-x-2">
          <UserRoundPen size={17} />
          <span className="text-xs font-bold">Grading in progress</span>
        </div>
      </div>
    )
  }

  if (submission[0].submission_status === 'GRADED') {
    return (
      <div className="bg-teal-600 rounded-md px-4 nice-shadow flex flex-col p-2.5 text-white transition delay-150 duration-300 ease-in-out">
        <span className="text-[10px] font-bold mb-1 uppercase">Status</span>
        <div className="flex items-center space-x-2">
          <CheckCircle size={17} />
          <span className="text-xs flex space-x-2 font-bold items-center">
            <span>Graded </span>
            <span className='bg-white text-teal-800 px-1 py-0.5 rounded-md'>{finalGrade}</span>
          </span>
        </div>
      </div>
    )
  }

  // Default return in case none of the conditions are met
  return null
}

export default ActivityClient
