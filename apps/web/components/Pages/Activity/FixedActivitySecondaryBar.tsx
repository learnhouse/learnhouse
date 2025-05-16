'use client'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { getUriWithOrg } from '@services/config/config'
import { useRouter } from 'next/navigation'
import React, { useEffect, useState, useRef, useMemo, memo } from 'react'
import ActivityIndicators from '@components/Pages/Courses/ActivityIndicators'
import ActivityChapterDropdown from './ActivityChapterDropdown'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { useOrg } from '@components/Contexts/OrgContext'

interface FixedActivitySecondaryBarProps {
  course: any
  currentActivityId: string
  orgslug: string
  activity: any
}

// Memoized navigation buttons component
const NavigationButtons = memo(({ 
  prevActivity, 
  nextActivity, 
  currentIndex, 
  allActivities, 
  navigateToActivity 
}: { 
  prevActivity: any, 
  nextActivity: any, 
  currentIndex: number, 
  allActivities: any[], 
  navigateToActivity: (activity: any) => void 
}) => (
  <div className="flex items-center space-x-2 sm:space-x-3">
    <button
      onClick={() => navigateToActivity(prevActivity)}
      className={`flex items-center space-x-1 sm:space-x-2 py-1.5 px-1.5 sm:px-2 rounded-md transition-all duration-200 ${
        prevActivity 
          ? 'text-gray-700 hover:bg-gray-100' 
          : 'text-gray-300 cursor-not-allowed'
      }`}
      disabled={!prevActivity}
      title={prevActivity ? `Previous: ${prevActivity.name}` : 'No previous activity'}
    >
      <ChevronLeft size={16} className="shrink-0 sm:w-5 sm:h-5" />
      <div className="flex flex-col items-start hidden sm:flex">
        <span className="text-xs text-gray-500">Previous</span>
        <span className="text-sm font-medium text-left truncate max-w-[100px] sm:max-w-[150px]">
          {prevActivity ? prevActivity.name : 'No previous activity'}
        </span>
      </div>
    </button>

    <span className="text-sm font-medium text-gray-500 px-1 sm:px-2">
      {currentIndex + 1} of {allActivities.length}
    </span>

    <button
      onClick={() => navigateToActivity(nextActivity)}
      className={`flex items-center space-x-1 sm:space-x-2 py-1.5 px-1.5 sm:px-2 rounded-md transition-all duration-200`}
      disabled={!nextActivity}
      title={nextActivity ? `Next: ${nextActivity.name}` : 'No next activity'}
    >
      <div className="flex flex-col items-end hidden sm:flex">
        <span className={`text-xs ${nextActivity ? 'text-gray-500' : 'text-gray-500'}`}>Next</span>
        <span className="text-sm font-medium text-right truncate max-w-[100px] sm:max-w-[150px]">
          {nextActivity ? nextActivity.name : 'No next activity'}
        </span>
      </div>
      <ChevronRight size={16} className="shrink-0 sm:w-5 sm:h-5" />
    </button>
  </div>
));

NavigationButtons.displayName = 'NavigationButtons';

// Memoized course info component
const CourseInfo = memo(({ course, org }: { course: any, org: any }) => (
  <div className="flex items-center space-x-2 sm:space-x-4 min-w-0 flex-shrink">
    <img
      className="w-[35px] sm:w-[45px] h-[20px] sm:h-[26px] rounded-md object-cover flex-shrink-0"
      src={`${getCourseThumbnailMediaDirectory(
        org?.org_uuid,
        course.course_uuid,
        course.thumbnail_image
      )}`}
      alt=""
    />
    <div className="flex flex-col -space-y-0.5 min-w-0 hidden sm:block">
      <p className="text-sm font-medium text-gray-500">Course</p>
      <h1 className="font-semibold text-gray-900 text-base truncate">
        {course.name}
      </h1>
    </div>
  </div>
));

CourseInfo.displayName = 'CourseInfo';

export default function FixedActivitySecondaryBar(props: FixedActivitySecondaryBarProps): React.ReactNode {
  const router = useRouter();
  const [isScrolled, setIsScrolled] = useState(false);
  const [shouldShow, setShouldShow] = useState(false);
  const mainActivityInfoRef = useRef<HTMLDivElement | null>(null);
  const org = useOrg() as any;

  // Memoize activity position calculation
  const { allActivities, currentIndex } = useMemo(() => {
    let allActivities: any[] = [];
    let currentIndex = -1;
    
    props.course.chapters.forEach((chapter: any) => {
      chapter.activities.forEach((activity: any) => {
        const cleanActivityUuid = activity.activity_uuid?.replace('activity_', '');
        allActivities.push({
          ...activity,
          cleanUuid: cleanActivityUuid,
          chapterName: chapter.name
        });
        
        if (cleanActivityUuid === props.currentActivityId.replace('activity_', '')) {
          currentIndex = allActivities.length - 1;
        }
      });
    });
    
    return { allActivities, currentIndex };
  }, [props.course, props.currentActivityId]);
  
  const prevActivity = currentIndex > 0 ? allActivities[currentIndex - 1] : null;
  const nextActivity = currentIndex < allActivities.length - 1 ? allActivities[currentIndex + 1] : null;
  
  const navigateToActivity = (activity: any) => {
    if (!activity) return;
    
    const cleanCourseUuid = props.course.course_uuid?.replace('course_', '');
    router.push(getUriWithOrg(props.orgslug, '') + `/course/${cleanCourseUuid}/activity/${activity.cleanUuid}`);
  };

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 0);
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        setShouldShow(!entry.isIntersecting);
      },
      {
        threshold: [0, 0.1, 1],
        rootMargin: '-80px 0px 0px 0px'
      }
    );

    const mainActivityInfo = document.querySelector('.activity-info-section');
    if (mainActivityInfo) {
      mainActivityInfoRef.current = mainActivityInfo as HTMLDivElement;
      observer.observe(mainActivityInfo);
    }

    window.addEventListener('scroll', handleScroll);
    
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (mainActivityInfoRef.current) {
        observer.unobserve(mainActivityInfoRef.current);
      }
    };
  }, []);

  if (!shouldShow) return null;

  return (
    <div 
      className={`fixed top-[60px] left-0 right-0 z-40 bg-white/90 backdrop-blur-xl transition-all duration-300 animate-in fade-in slide-in-from-top ${
        isScrolled ? 'nice-shadow' : ''
      }`}
    >
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16 py-2">
          <CourseInfo course={props.course} org={org} />
          
          <div className="flex items-center flex-shrink-0">
            <NavigationButtons
              prevActivity={prevActivity}
              nextActivity={nextActivity}
              currentIndex={currentIndex}
              allActivities={allActivities}
              navigateToActivity={navigateToActivity}
            />
          </div>
        </div>
      </div>
    </div>
  );
} 