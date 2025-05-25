'use client'
import { useMediaQuery } from 'usehooks-ts'
import { BookOpenCheck, Check, FileText, Folder, Layers, ListTree, Video, X, StickyNote, Backpack, ArrowRight } from 'lucide-react'
import { getUriWithOrg } from '@services/config/config'
import Link from 'next/link'
import React from 'react'

interface ActivityChapterDropdownProps {
  course: any
  currentActivityId: string
  orgslug: string
}

export default function ActivityChapterDropdown(props: ActivityChapterDropdownProps): React.ReactNode {
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
        return <Video size={10} />;
      case 'TYPE_DOCUMENT':
        return <FileText size={10} />;
      case 'TYPE_DYNAMIC':
        return <StickyNote size={10} />;
      case 'TYPE_ASSIGNMENT':
        return <Backpack size={10} />;
      default:
        return <FileText size={10} />;
    }
  };

  const getActivityTypeLabel = (activityType: string) => {
    switch (activityType) {
      case 'TYPE_VIDEO':
        return 'Video';
      case 'TYPE_DOCUMENT':
        return 'Document';
      case 'TYPE_DYNAMIC':
        return 'Page';
      case 'TYPE_ASSIGNMENT':
        return 'Assignment';
      default:
        return 'Learning Material';
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={toggleDropdown}
        className="bg-white rounded-full px-5 nice-shadow flex items-center space-x-2 p-2.5 text-gray-700 hover:bg-gray-50 transition delay-150 duration-300 ease-in-out"
        aria-label="View all activities"
        title="View all activities"
      >
        <ListTree size={17} />
        <span className="text-xs font-bold">Chapters</span>
      </button>
      
      {isOpen && (
        <div className={`absolute z-50 mt-2 ${isMobile ? 'left-0 w-[90vw] sm:w-72' : 'left-0 w-72'} max-h-[70vh] cursor-pointer overflow-y-auto bg-white rounded-lg shadow-xl border border-gray-200 py-1 animate-in fade-in duration-200`}>
          <div className="px-3 py-1.5 border-b border-gray-100 flex justify-between items-center">
            <h3 className="text-sm font-semibold text-gray-800">Course Content</h3>
            <button 
              onClick={() => setIsOpen(false)}
              className="text-gray-500 hover:text-gray-700 p-1 rounded-full hover:bg-gray-100 cursor-pointer"
            >
              <X size={14} />
            </button>
          </div>
          
          <div className="py-0.5">
            {props.course.chapters.map((chapter: any) => (
              <div key={chapter.id} className="mb-1">
                <div className="px-3 py-1.5 text-sm font-medium text-gray-600 bg-gray-50 border-y border-gray-100 flex items-center">
                  <div className="flex items-center space-x-1.5">
                    <Folder size={14} className="text-gray-400" />
                    <span>{chapter.name}</span>
                  </div>
                </div>
                <div className="py-0.5">
                  {chapter.activities.map((activity: any) => {
                    const cleanActivityUuid = activity.activity_uuid?.replace('activity_', '');
                    const cleanCourseUuid = props.course.course_uuid?.replace('course_', '');
                    const isCurrent = cleanActivityUuid === props.currentActivityId.replace('activity_', '');
                    
                    return (
                      <Link
                        key={activity.id}
                        href={getUriWithOrg(props.orgslug, '') + `/course/${cleanCourseUuid}/activity/${cleanActivityUuid}`}
                        prefetch={false}
                        onClick={() => setIsOpen(false)}
                      >
                        <div 
                          className={`group hover:bg-neutral-50 transition-colors px-3 py-2 ${
                            isCurrent ? 'bg-neutral-50 border-l-2 border-neutral-300 pl-2.5 font-medium' : ''
                          }`}
                        >
                          <div className="flex space-x-2 items-center">
                            <div className="flex items-center">
                              {props.course.trail?.runs?.find(
                                (run: any) => run.course_id === props.course.id
                              )?.steps?.find(
                                (step: any) => (step.activity_id === activity.id || step.activity_id === activity.activity_uuid) && step.complete === true
                              ) ? (
                                <div className="relative cursor-pointer">
                                  <Check size={14} className="stroke-[2.5] text-teal-600" />
                                </div>
                              ) : (
                                <div className="text-neutral-300 cursor-pointer">
                                  <Check size={14} className="stroke-[2]" />
                                </div>
                              )}
                            </div>
                            <div className="flex flex-col grow">
                              <div className="flex items-center space-x-1.5 w-full">
                                <p className="text-sm font-medium text-neutral-600 group-hover:text-neutral-800 transition-colors">
                                  {activity.name}
                                </p>
                                {isCurrent && (
                                  <div className="flex items-center space-x-1 text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full text-[10px] font-medium animate-pulse">
                                    <span>Current</span>
                                  </div>
                                )}
                              </div>
                              <div className="flex items-center space-x-1 mt-0.5 text-neutral-400">
                                {getActivityTypeIcon(activity.activity_type)}
                                <span className="text-[10px] font-medium">
                                  {getActivityTypeLabel(activity.activity_type)}
                                </span>
                              </div>
                            </div>
                            <div className="text-neutral-300 group-hover:text-neutral-400 transition-colors cursor-pointer">
                              <ArrowRight size={12} />
                            </div>
                          </div>
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