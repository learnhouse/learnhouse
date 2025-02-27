'use client'
import Link from 'next/link'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import Canva from '@components/Objects/Activities/DynamicCanva/DynamicCanva'
import VideoActivity from '@components/Objects/Activities/Video/Video'
import { BookOpenCheck, Check, CheckCircle, ChevronDown, ChevronLeft, ChevronRight, FileText, Folder, List, Menu, MoreVertical, UserRoundPen, Video, Layers, ListFilter, ListTree, X } from 'lucide-react'
import { markActivityAsComplete } from '@services/courses/activity'
import DocumentPdfActivity from '@components/Objects/Activities/DocumentPdf/DocumentPdf'
import ActivityIndicators from '@components/Pages/Courses/ActivityIndicators'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import { usePathname, useRouter } from 'next/navigation'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { useOrg } from '@components/Contexts/OrgContext'
import { CourseProvider } from '@components/Contexts/CourseContext'
import AIActivityAsk from '@components/Objects/Activities/AI/AIActivityAsk'
import AIChatBotProvider from '@components/Contexts/AI/AIChatBotContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import React, { useEffect } from 'react'
import { getAssignmentFromActivityUUID, getFinalGrade, submitAssignmentForGrading } from '@services/courses/assignments'
import AssignmentStudentActivity from '@components/Objects/Activities/Assignment/AssignmentStudentActivity'
import { AssignmentProvider } from '@components/Contexts/Assignments/AssignmentContext'
import { AssignmentsTaskProvider } from '@components/Contexts/Assignments/AssignmentsTaskContext'
import AssignmentSubmissionProvider, {  useAssignmentSubmission } from '@components/Contexts/Assignments/AssignmentSubmissionContext'
import toast from 'react-hot-toast'
import { mutate } from 'swr'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import { useMediaQuery } from 'usehooks-ts'
import PaidCourseActivityDisclaimer from '@components/Objects/Courses/CourseActions/PaidCourseActivityDisclaimer'

interface ActivityClientProps {
  activityid: string
  courseuuid: string
  orgslug: string
  activity: any
  course: any
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
 

  function getChapterNameByActivityId(course: any, activity_id: any) {
    for (let i = 0; i < course.chapters.length; i++) {
      let chapter = course.chapters[i]
      for (let j = 0; j < chapter.activities.length; j++) {
        let activity = chapter.activities[j]
        if (activity.id === activity_id) {
          return chapter.name
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
      setBgColor('bg-white nice-shadow');
    }
    else if (activity.activity_type == 'TYPE_ASSIGNMENT') {
      setMarkStatusButtonActive(false);
      setBgColor('bg-white nice-shadow');
      getAssignmentUI();
    }
    else {
      setBgColor('bg-zinc-950');
    }
  }
    , [activity, pathname])

  return (
    <>
      <CourseProvider courseuuid={course?.course_uuid}>
        <AIChatBotProvider>
          <GeneralWrapperStyled>
            <div className="space-y-4 pt-4">
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
                  <h1 className="font-bold text-gray-950 text-2xl first-letter:uppercase">
                    {course.name}
                  </h1>
                </div>
              </div>
              <ActivityIndicators
                course_uuid={courseuuid}
                current_activity={activityid}
                orgslug={orgslug}
                course={course}
              />

              <div className="flex justify-between items-center">
                <div className="flex items-center space-x-3">
                  <ActivityChapterDropdown 
                    course={course}
                    currentActivityId={activity.activity_uuid ? activity.activity_uuid.replace('activity_', '') : activityid.replace('activity_', '')}
                    orgslug={orgslug}
                  />
                  <div className="flex flex-col -space-y-1">
                    <p className="font-bold text-gray-700 text-md">
                      Chapter : {getChapterNameByActivityId(course, activity.id)}
                    </p>
                    <h1 className="font-bold text-gray-950 text-2xl first-letter:uppercase">
                      {activity.name}
                    </h1>
                  </div>
                </div>
                <div className="flex space-x-1 items-center">
                  {activity && activity.published == true && activity.content.paid_access != false && (
                    <AuthenticatedClientElement checkMethod="authentication">
                      {activity.activity_type != 'TYPE_ASSIGNMENT' &&
                        <>
                          <AIActivityAsk activity={activity} />
                          <MoreVertical size={17} className="text-gray-300 " />
                          <MarkStatus
                            activity={activity}
                            activityid={activityid}
                            course={course}
                            orgslug={orgslug}
                          />
                        </>
                      }
                      {activity.activity_type == 'TYPE_ASSIGNMENT' &&
                        <>
                          <MoreVertical size={17} className="text-gray-300 " />
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
                      }

                    </AuthenticatedClientElement>
                  )}
                </div>
              </div>
              {activity && activity.published == false && (
                <div className="p-7 drop-shadow-sm rounded-lg bg-gray-800">
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
                    <div className={`p-7 drop-shadow-sm rounded-lg ${bgColor}`}>
                      {/* Activity Types */}
                      <div>
                        {activity.activity_type == 'TYPE_DYNAMIC' && (
                          <Canva content={activity.content} activity={activity} />
                        )}
                        {activity.activity_type == 'TYPE_VIDEO' && (
                          <VideoActivity course={course} activity={activity} />
                        )}
                        {activity.activity_type == 'TYPE_DOCUMENT' && (
                          <DocumentPdfActivity
                            course={course}
                            activity={activity}
                          />
                        )}
                        {activity.activity_type == 'TYPE_ASSIGNMENT' && (
                          <div>
                            {assignment ? (
                              <AssignmentProvider assignment_uuid={assignment?.assignment_uuid}>
                                <AssignmentsTaskProvider>
                                  <AssignmentSubmissionProvider assignment_uuid={assignment?.assignment_uuid}>
                                    <AssignmentStudentActivity />
                                  </AssignmentSubmissionProvider>
                                </AssignmentsTaskProvider>
                              </AssignmentProvider>
                            ) : (
                              <div></div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
              
              {/* Activity Navigation */}
              {activity && activity.published == true && activity.content.paid_access != false && (
                <ActivityNavigation
                  course={course}
                  currentActivityId={activity.activity_uuid ? activity.activity_uuid.replace('activity_', '') : activityid.replace('activity_', '')}
                  orgslug={orgslug}
                />
              )}
              
              {<div style={{ height: '100px' }}></div>}
            </div>
          </GeneralWrapperStyled>
        </AIChatBotProvider>
      </CourseProvider>
    </>
  )
}

export function MarkStatus(props: {
  activity: any
  activityid: string
  course: any
  orgslug: string
}) {
  const router = useRouter()
  const session = useLHSession() as any;
  const isMobile = useMediaQuery('(max-width: 768px)')
  async function markActivityAsCompleteFront() {
    const trail = await markActivityAsComplete(
      props.orgslug,
      props.course.course_uuid,
      props.activity.activity_uuid,
      session.data?.tokens?.access_token
    )
    router.refresh()
  }

  const isActivityCompleted = () => {
    let run = props.course.trail.runs.find(
      (run: any) => run.course_id == props.course.id
    )
    if (run) {
      return run.steps.find(
        (step: any) => (step.activity_id == props.activity.id) && (step.complete == true)
      )
    }
  }

  return (
    <>
      {isActivityCompleted() ? (
        <div className="bg-teal-600 rounded-full px-5 drop-shadow-md flex items-center space-x-2  p-2.5  text-white hover:cursor-pointer transition delay-150 duration-300 ease-in-out">
          <i>
            <Check size={17}></Check>
          </i>{' '}
          <i className="not-italic text-xs font-bold">Complete</i>
        </div>
      ) : (
        <div
          className="bg-gray-800 rounded-full px-5 drop-shadow-md flex  items-center space-x-2 p-2.5  text-white hover:cursor-pointer transition delay-150 duration-300 ease-in-out"
          onClick={markActivityAsCompleteFront}
        >
          {' '}
          <i>
            <Check size={17}></Check>
          </i>{' '}
          {!isMobile && <i className="not-italic text-xs font-bold">Mark as complete</i>}
        </div>
      )}
    </>
  )
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
          <div className="bg-cyan-800 rounded-full px-5 drop-shadow-md flex items-center space-x-2 p-2.5 text-white hover:cursor-pointer transition delay-150 duration-300 ease-in-out">
            <BookOpenCheck size={17} />
            <span className="text-xs font-bold">Submit for grading</span>
          </div>
        }
        functionToExecute={submitForGradingUI}
        status="info"
      />
    )
  }

  if (submission[0].submission_status === 'SUBMITTED') {
    return (
      <div className="bg-amber-800 rounded-full px-5 drop-shadow-md flex items-center space-x-2 p-2.5 text-white transition delay-150 duration-300 ease-in-out">
        <UserRoundPen size={17} />
        <span className="text-xs font-bold">Grading in progress</span>
      </div>
    )
  }

  if (submission[0].submission_status === 'GRADED') {
    return (
      <div className="bg-teal-600 rounded-full px-5 drop-shadow-md flex items-center space-x-2 p-2.5 text-white transition delay-150 duration-300 ease-in-out">
        <CheckCircle size={17} />
        <span className="text-xs flex space-x-2 font-bold items-center"><span>Graded </span> <span className='bg-white text-teal-800 px-1 py-0.5 rounded-md'>{finalGrade}</span></span>
      </div>
    )
  }

  // Default return in case none of the conditions are met
  return null
}

function ActivityChapterDropdown(props: {
  course: any
  currentActivityId: string
  orgslug: string
}): React.ReactNode {
  const [isOpen, setIsOpen] = React.useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);
  const isMobile = useMediaQuery('(max-width: 768px)');

  // Close dropdown when clicking outside
  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const toggleDropdown = () => {
    setIsOpen(!isOpen);
  };

  // Function to get the appropriate icon for activity type
  const getActivityTypeIcon = (activityType: string) => {
    switch (activityType) {
      case 'TYPE_VIDEO':
        return <Video size={16} />;
      case 'TYPE_DOCUMENT':
        return <FileText size={16} />;
      case 'TYPE_DYNAMIC':
        return <Layers size={16} />;
      case 'TYPE_ASSIGNMENT':
        return <BookOpenCheck size={16} />;
      default:
        return <FileText size={16} />;
    }
  };

  // Function to get the appropriate badge color for activity type
  const getActivityTypeBadgeColor = (activityType: string) => {
    return 'bg-gray-100 text-gray-600';
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={toggleDropdown}
        className="flex items-center justify-center bg-white nice-shadow p-2.5 rounded-full"
        aria-label="View all activities"
        title="View all activities"
      >
        <ListTree size={18} className="text-gray-700" />
      </button>
      
      {isOpen && (
        <div className={`absolute z-50 mt-2 ${isMobile ? 'left-0 w-[90vw] sm:w-80' : 'left-0 w-80'} max-h-[70vh] overflow-y-auto bg-white rounded-lg shadow-xl border border-gray-200 py-2 animate-in fade-in duration-200`}>
          <div className="px-4 py-2 border-b border-gray-100 flex justify-between items-center">
            <h3 className="font-bold text-gray-800">Course Content</h3>
            <button 
              onClick={() => setIsOpen(false)}
              className="text-gray-500 hover:text-gray-700 p-1 rounded-full hover:bg-gray-100"
            >
              <X size={18} />
            </button>
          </div>
          
          <div className="py-1">
            {props.course.chapters.map((chapter: any) => (
              <div key={chapter.id} className="mb-2">
                <div className="px-4 py-2 font-medium text-gray-600 bg-gray-50 border-y border-gray-100 flex items-center">
                  <div className="flex items-center space-x-2">
                    <Folder size={16} className="text-gray-400" />
                    <span>{chapter.name}</span>
                  </div>
                </div>
                <div className="py-1">
                  {chapter.activities.map((activity: any) => {
                    // Remove any prefixes from UUIDs
                    const cleanActivityUuid = activity.activity_uuid?.replace('activity_', '');
                    const cleanCourseUuid = props.course.course_uuid?.replace('course_', '');
                    
                    return (
                      <Link
                        key={activity.id}
                        href={getUriWithOrg(props.orgslug, '') + `/course/${cleanCourseUuid}/activity/${cleanActivityUuid}`}
                        onClick={() => setIsOpen(false)}
                      >
                        <div 
                          className={`px-4 py-2.5 hover:bg-gray-100 transition-colors flex items-center ${
                            cleanActivityUuid === props.currentActivityId.replace('activity_', '') ? 'bg-gray-50 border-l-2 border-gray-300 pl-3 font-medium' : ''
                          }`}
                        >
                          <div className="flex-1 flex items-center gap-2">
                            <span className="text-gray-400">
                              {getActivityTypeIcon(activity.activity_type)}
                            </span>
                            <div className="text-sm">
                              {activity.name}
                            </div>
                          </div>
                          {props.course.trail?.runs?.find(
                            (run: any) => run.course_id === props.course.id
                          )?.steps?.find(
                            (step: any) => (step.activity_id === activity.id || step.activity_id === activity.activity_uuid) && step.complete === true
                          ) && (
                            <span className="ml-2 text-gray-400 flex-shrink-0">
                              <Check size={14} />
                            </span>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ActivityNavigation(props: {
  course: any
  currentActivityId: string
  orgslug: string
}): React.ReactNode {
  const router = useRouter();
  const isMobile = useMediaQuery('(max-width: 768px)');
  const [isBottomNavVisible, setIsBottomNavVisible] = React.useState(true);
  const bottomNavRef = React.useRef<HTMLDivElement>(null);
  const [navWidth, setNavWidth] = React.useState<number | null>(null);
  
  // Function to find the current activity's position in the course
  const findActivityPosition = () => {
    let allActivities: any[] = [];
    let currentIndex = -1;
    
    // Flatten all activities from all chapters
    props.course.chapters.forEach((chapter: any) => {
      chapter.activities.forEach((activity: any) => {
        const cleanActivityUuid = activity.activity_uuid?.replace('activity_', '');
        allActivities.push({
          ...activity,
          cleanUuid: cleanActivityUuid,
          chapterName: chapter.name
        });
        
        // Check if this is the current activity
        if (cleanActivityUuid === props.currentActivityId.replace('activity_', '')) {
          currentIndex = allActivities.length - 1;
        }
      });
    });
    
    return { allActivities, currentIndex };
  };
  
  const { allActivities, currentIndex } = findActivityPosition();
  
  // Get previous and next activities
  const prevActivity = currentIndex > 0 ? allActivities[currentIndex - 1] : null;
  const nextActivity = currentIndex < allActivities.length - 1 ? allActivities[currentIndex + 1] : null;
  
  // Navigate to an activity
  const navigateToActivity = (activity: any) => {
    if (!activity) return;
    
    const cleanCourseUuid = props.course.course_uuid?.replace('course_', '');
    router.push(getUriWithOrg(props.orgslug, '') + `/course/${cleanCourseUuid}/activity/${activity.cleanUuid}`);
  };

  // Set up intersection observer to detect when bottom nav is out of viewport
  // and measure the width of the bottom navigation
  React.useEffect(() => {
    if (!bottomNavRef.current) return;
    
    // Update width when component mounts and on window resize
    const updateWidth = () => {
      if (bottomNavRef.current) {
        setNavWidth(bottomNavRef.current.offsetWidth);
      }
    };
    
    // Initial width measurement
    updateWidth();
    
    // Set up resize listener
    window.addEventListener('resize', updateWidth);
    
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsBottomNavVisible(entry.isIntersecting);
      },
      { threshold: 0.1 }
    );
    
    observer.observe(bottomNavRef.current);
    
    return () => {
      window.removeEventListener('resize', updateWidth);
      if (bottomNavRef.current) {
        observer.unobserve(bottomNavRef.current);
      }
    };
  }, []);

  // Navigation buttons component - reused for both top and bottom
  const NavigationButtons = ({ isFloating = false }) => (
    <div className={`${isFloating ? 'flex justify-between' : 'grid grid-cols-3'} items-center w-full`}>
      {isFloating ? (
        // Floating navigation - original flex layout
        <>
          <button
            onClick={() => navigateToActivity(prevActivity)}
            className={`flex items-center space-x-1.5 p-2 rounded-md transition-all duration-200 ${
              prevActivity 
                ? 'text-gray-700' 
                : 'opacity-50 text-gray-400 cursor-not-allowed'
            }`}
            disabled={!prevActivity}
            title={prevActivity ? `Previous: ${prevActivity.name}` : 'No previous activity'}
          >
            <ChevronLeft size={20} className="text-gray-800 flex-shrink-0" />
            <div className="flex flex-col items-start">
              <span className="text-xs text-gray-500">Previous</span>
              <span className="text-sm capitalize font-semibold text-left">
                {prevActivity ? prevActivity.name : 'No previous activity'}
              </span>
            </div>
          </button>
          
          <button
            onClick={() => navigateToActivity(nextActivity)}
            className={`flex items-center space-x-1.5 p-2 rounded-md transition-all duration-200 ${
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
            <ChevronRight size={20} className="text-gray-800 flex-shrink-0" />
          </button>
        </>
      ) : (
        // Regular navigation - grid layout with centered counter
        <>
          <div className="justify-self-start">
            <button
              onClick={() => navigateToActivity(prevActivity)}
              className={`flex items-center space-x-1.5 px-3.5 py-2 rounded-md transition-all duration-200 ${
                prevActivity 
                  ? 'bg-white nice-shadow text-gray-700' 
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              }`}
              disabled={!prevActivity}
              title={prevActivity ? `Previous: ${prevActivity.name}` : 'No previous activity'}
            >
              <ChevronLeft size={16} className="flex-shrink-0" />
              <div className="flex flex-col items-start">
                <span className="text-xs text-gray-500">Previous</span>
                <span className="text-sm capitalize font-semibold text-left">
                  {prevActivity ? prevActivity.name : 'No previous activity'}
                </span>
              </div>
            </button>
          </div>
          
          <div className="text-sm text-gray-500 justify-self-center">
            {currentIndex + 1} of {allActivities.length}
          </div>
          
          <div className="justify-self-end">
            <button
              onClick={() => navigateToActivity(nextActivity)}
              className={`flex items-center space-x-1.5 px-3.5 py-2 rounded-md transition-all duration-200 ${
                nextActivity 
                  ? 'bg-white nice-shadow text-gray-700' 
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
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
              <ChevronRight size={16} className="flex-shrink-0" />
            </button>
          </div>
        </>
      )}
    </div>
  );
  
  return (
    <>
      {/* Bottom navigation (in-place) */}
      <div ref={bottomNavRef} className="mt-6 mb-2 w-full">
        <NavigationButtons isFloating={false} />
      </div>
      
      {/* Floating bottom navigation - shown when bottom nav is not visible */}
      {!isBottomNavVisible && (
        <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2 z-50 w-[85%] sm:w-auto sm:min-w-[350px] max-w-lg transition-all duration-300 ease-in-out">
          <div 
            className="bg-white/90 backdrop-blur-xl rounded-full py-1.5 px-2.5 shadow-sm animate-in fade-in slide-in-from-bottom duration-300"
          >
            <NavigationButtons isFloating={true} />
          </div>
        </div>
      )}
    </>
  );
}

export default ActivityClient
