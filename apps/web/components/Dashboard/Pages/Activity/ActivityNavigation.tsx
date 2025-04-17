'use client'
import { useRouter } from 'next/navigation'
import { useMediaQuery } from 'usehooks-ts'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { getUriWithOrg } from '@services/config/config'
import React from 'react'

interface ActivityNavigationProps {
  course: any
  currentActivityId: string
  orgslug: string
}

export default function ActivityNavigation(props: ActivityNavigationProps): React.ReactNode {
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
        </>
      ) : (
        // Regular navigation - grid layout with centered counter
        <>
          <div className="justify-self-start">
            <button
              onClick={() => navigateToActivity(prevActivity)}
              className={`flex items-center space-x-1.5 px-3.5 py-2 rounded-md transition-all duration-200 cursor-pointer ${
                prevActivity 
                  ? 'bg-white nice-shadow text-gray-700' 
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              }`}
              disabled={!prevActivity}
              title={prevActivity ? `Previous: ${prevActivity.name}` : 'No previous activity'}
            >
              <ChevronLeft size={16} className="shrink-0" />
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
              className={`flex items-center space-x-1.5 px-3.5 py-2 rounded-md transition-all duration-200 cursor-pointer ${
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
              <ChevronRight size={16} className="shrink-0" />
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
            className="bg-white/90 backdrop-blur-xl rounded-full py-1.5 px-2.5 shadow-xs animate-in fade-in slide-in-from-bottom duration-300"
          >
            <NavigationButtons isFloating={true} />
          </div>
        </div>
      )}
    </>
  );
} 