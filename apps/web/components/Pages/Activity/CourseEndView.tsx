import React from 'react';
import ReactConfetti from 'react-confetti';
import { Trophy, ArrowLeft } from 'lucide-react';
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
}

const CourseEndView: React.FC<CourseEndViewProps> = ({ courseName, orgslug, courseUuid, thumbnailImage }) => {
  const { width, height } = useWindowSize();
  const org = useOrg() as any;

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
};

export default CourseEndView; 