import React, { useMemo } from 'react';
import ReactConfetti from 'react-confetti';
import { Trophy, ArrowLeft, BookOpen, Target } from 'lucide-react';
import Link from 'next/link';
import { getUriWithOrg } from '@services/config/config';
import { getCourseThumbnailMediaDirectory } from '@services/media/media';
import { useWindowSize } from 'usehooks-ts';
import { useOrg } from '@components/Contexts/OrgContext';

interface CourseEndViewProps {
  courseName: string;
  orgslug: string;
  courseUuid: string;
  thumbnailImage: string;
  course: any;
  trailData: any;
}

const CourseEndView: React.FC<CourseEndViewProps> = ({ 
  courseName, 
  orgslug, 
  courseUuid, 
  thumbnailImage, 
  course, 
  trailData 
}) => {
  const { width, height } = useWindowSize();
  const org = useOrg() as any;

  // Check if course is actually completed
  const isCourseCompleted = useMemo(() => {
    if (!trailData || !course) return false;
    
    // Flatten all activities
    const allActivities = course.chapters.flatMap((chapter: any) => 
      chapter.activities.map((activity: any) => ({
        ...activity,
        chapterId: chapter.id
      }))
    );
    
    // Check if all activities are completed
    const isActivityDone = (activity: any) => {
      const cleanCourseUuid = course.course_uuid?.replace('course_', '');
      const run = trailData?.runs?.find(
        (run: any) => {
          const cleanRunCourseUuid = run.course?.course_uuid?.replace('course_', '');
          return cleanRunCourseUuid === cleanCourseUuid;
        }
      );
      
      if (run) {
        return run.steps.find(
          (step: any) => step.activity_id === activity.id && step.complete === true
        );
      }
      return false;
    };
    
    const totalActivities = allActivities.length;
    const completedActivities = allActivities.filter((activity: any) => isActivityDone(activity)).length;
    return totalActivities > 0 && completedActivities === totalActivities;
  }, [trailData, course]);

  // Calculate progress for incomplete courses
  const progressInfo = useMemo(() => {
    if (!trailData || !course || isCourseCompleted) return null;
    
    const allActivities = course.chapters.flatMap((chapter: any) => 
      chapter.activities.map((activity: any) => ({
        ...activity,
        chapterId: chapter.id
      }))
    );
    
    const isActivityDone = (activity: any) => {
      const cleanCourseUuid = course.course_uuid?.replace('course_', '');
      const run = trailData?.runs?.find(
        (run: any) => {
          const cleanRunCourseUuid = run.course?.course_uuid?.replace('course_', '');
          return cleanRunCourseUuid === cleanCourseUuid;
        }
      );
      
      if (run) {
        return run.steps.find(
          (step: any) => step.activity_id === activity.id && step.complete === true
        );
      }
      return false;
    };
    
    const totalActivities = allActivities.length;
    const completedActivities = allActivities.filter((activity: any) => isActivityDone(activity)).length;
    const progressPercentage = Math.round((completedActivities / totalActivities) * 100);
    
    return {
      completed: completedActivities,
      total: totalActivities,
      percentage: progressPercentage
    };
  }, [trailData, course, isCourseCompleted]);

  if (isCourseCompleted) {
    // Show congratulations for completed course
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center text-center px-4 relative overflow-hidden">
        <div className="fixed inset-0 pointer-events-none">
          <ReactConfetti
            width={width}
            height={height}
            numberOfPieces={200}
            recycle={false}
            colors={['#6366f1', '#10b981', '#3b82f6']}
          />
        </div>
        
        <div className="bg-white rounded-2xl p-8 nice-shadow max-w-2xl w-full space-y-6 relative z-10">
          <div className="flex flex-col items-center space-y-6">
            {thumbnailImage && (
              <img
                className="w-[200px] h-[114px] rounded-lg shadow-md object-cover"
                src={`${getCourseThumbnailMediaDirectory(
                  org?.org_uuid,
                  courseUuid,
                  thumbnailImage
                )}`}
                alt={courseName}
              />
            )}
            
            <div className="bg-emerald-100 p-4 rounded-full">
              <Trophy className="w-16 h-16 text-emerald-600" />
            </div>
          </div>
          
          <h1 className="text-4xl font-bold text-gray-900">
            Congratulations! 🎉
          </h1>
          
          <p className="text-xl text-gray-600">
            You've successfully completed
            <span className="font-semibold text-gray-900"> {courseName}</span>
          </p>
          
          <p className="text-gray-500">
            Your dedication and hard work have paid off. You've mastered all the content in this course.
          </p>

          <div className="pt-6">
            <Link
              href={getUriWithOrg(orgslug, '') + `/course/${courseUuid.replace('course_', '')}`}
              className="inline-flex items-center space-x-2 bg-gray-800 text-white px-6 py-3 rounded-full hover:bg-gray-700 transition duration-200"
            >
              <ArrowLeft className="w-5 h-5" />
              <span>Back to Course</span>
            </Link>
          </div>
        </div>
      </div>
    );
  } else {
    // Show progress and encouragement for incomplete course
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center text-center px-4">
        <div className="bg-white rounded-2xl p-8 nice-shadow max-w-2xl w-full space-y-6">
          <div className="flex flex-col items-center space-y-6">
            {thumbnailImage && (
              <img
                className="w-[200px] h-[114px] rounded-lg shadow-md object-cover"
                src={`${getCourseThumbnailMediaDirectory(
                  org?.org_uuid,
                  courseUuid,
                  thumbnailImage
                )}`}
                alt={courseName}
              />
            )}
            
            <div className="bg-blue-100 p-4 rounded-full">
              <Target className="w-16 h-16 text-blue-600" />
            </div>
          </div>
          
          <h1 className="text-4xl font-bold text-gray-900">
            Keep Going! 💪
          </h1>
          
          <p className="text-xl text-gray-600">
            You're making great progress in
            <span className="font-semibold text-gray-900"> {courseName}</span>
          </p>
          
          {progressInfo && (
            <div className="bg-gray-50 rounded-lg p-6 space-y-4">
              <div className="flex items-center justify-center space-x-2">
                <BookOpen className="w-5 h-5 text-gray-600" />
                <span className="text-lg font-semibold text-gray-700">Course Progress</span>
              </div>
              
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Progress</span>
                  <span className="font-semibold text-gray-900">{progressInfo.percentage}%</span>
                </div>
                
                <div className="w-full bg-gray-200 rounded-full h-3">
                  <div 
                    className="bg-blue-600 h-3 rounded-full transition-all duration-500"
                    style={{ width: `${progressInfo.percentage}%` }}
                  ></div>
                </div>
                
                <div className="text-sm text-gray-500">
                  {progressInfo.completed} of {progressInfo.total} activities completed
                </div>
              </div>
            </div>
          )}
          
          <p className="text-gray-500">
            You're doing great! Complete the remaining activities to unlock your course completion certificate.
          </p>

          <div className="pt-6">
            <Link
              href={getUriWithOrg(orgslug, '') + `/course/${courseUuid.replace('course_', '')}`}
              className="inline-flex items-center space-x-2 bg-blue-600 text-white px-6 py-3 rounded-full hover:bg-blue-700 transition duration-200"
            >
              <ArrowLeft className="w-5 h-5" />
              <span>Continue Learning</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }
};

export default CourseEndView; 