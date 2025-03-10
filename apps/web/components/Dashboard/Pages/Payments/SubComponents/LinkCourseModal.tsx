import React, { useState } from 'react';
import { useOrg } from '@components/Contexts/OrgContext';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import { linkCourseToProduct } from '@services/payments/products';
import { Button } from "@components/ui/button";
import { Input } from "@components/ui/input";
import { Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { mutate } from 'swr';
import useSWR from 'swr';
import { getOrgCourses } from '@services/courses/courses';
import { getCoursesLinkedToProduct } from '@services/payments/products';
import Link from 'next/link';
import { getCourseThumbnailMediaDirectory } from '@services/media/media';
import { getUriWithOrg } from '@services/config/config';

interface LinkCourseModalProps {
  productId: string;
  onSuccess: () => void;
}

interface CoursePreviewProps {
  course: {
    id: string;
    name: string;
    description: string;
    thumbnail_image: string;
    course_uuid: string;
  };
  orgslug: string;
  onLink: (courseId: string) => void;
  isLinked: boolean;
}

const CoursePreview = ({ course, orgslug, onLink, isLinked }: CoursePreviewProps) => {
  const org = useOrg() as any;
  
  const thumbnailImage = course.thumbnail_image
    ? getCourseThumbnailMediaDirectory(org?.org_uuid, course.course_uuid, course.thumbnail_image)
    : '../empty_thumbnail.png';

  return (
    <div className="flex gap-4 p-4 bg-white rounded-lg border border-gray-100 hover:border-gray-200 transition-colors">
      {/* Thumbnail */}
      <div 
        className="shrink-0 w-[120px] h-[68px] rounded-md bg-cover bg-center ring-1 ring-inset ring-black/10"
        style={{ backgroundImage: `url(${thumbnailImage})` }}
      />
      
      {/* Content */}
      <div className="grow space-y-1">
        <h3 className="font-medium text-gray-900 line-clamp-1">
          {course.name}
        </h3>
        <p className="text-sm text-gray-500 line-clamp-2">
          {course.description}
        </p>
      </div>

      {/* Action Button */}
      <div className="shrink-0 flex items-center">
        {isLinked ? (
          <Button
            variant="outline"
            size="sm"
            disabled
            className="text-gray-500"
          >
            Already Linked
          </Button>
        ) : (
          <Button
            onClick={() => onLink(course.id)}
            size="sm"
          >
            Link Course
          </Button>
        )}
      </div>
    </div>
  );
};

export default function LinkCourseModal({ productId, onSuccess }: LinkCourseModalProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const org = useOrg() as any;
  const session = useLHSession() as any;

  const { data: courses } = useSWR(
    () => org && session ? [org.slug, searchTerm, session.data?.tokens?.access_token] : null,
    ([orgSlug, search, token]) => getOrgCourses(orgSlug, null, token)
  );

  const { data: linkedCourses } = useSWR(
    () => org && session ? [`/payments/${org.id}/products/${productId}/courses`, session.data?.tokens?.access_token] : null,
    ([_, token]) => getCoursesLinkedToProduct(org.id, productId, token)
  );

  const handleLinkCourse = async (courseId: string) => {
    try {
      const response = await linkCourseToProduct(org.id, productId, courseId, session.data?.tokens?.access_token);
      if (response.success) {
        mutate([`/payments/${org.id}/products`, session.data?.tokens?.access_token]);
        toast.success('Course linked successfully');
        onSuccess();
      } else {
        toast.error(response.data?.detail || 'Failed to link course');
      }
    } catch (error) {
      toast.error('Failed to link course');
    }
  };

  const isLinked = (courseId: string) => {
    return linkedCourses?.data?.some((course: any) => course.id === courseId);
  };

  return (
    <div className="space-y-4">
     

      {/* Course List */}
      <div className="max-h-[400px] overflow-y-auto space-y-2 px-3">
        {courses?.map((course: any) => (
          <CoursePreview 
            key={course.course_uuid}
            course={course}
            orgslug={org.slug}
            onLink={handleLinkCourse}
            isLinked={isLinked(course.id)}
          />
        ))}
        
        {/* Empty State */}
        {(!courses || courses.length === 0) && (
          <div className="text-center py-6 text-gray-500">
            No courses found
          </div>
        )}
      </div>
    </div>
  );
} 