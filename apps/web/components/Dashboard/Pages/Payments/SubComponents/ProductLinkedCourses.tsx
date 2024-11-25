import React, { useEffect, useState } from 'react';
import { getCoursesLinkedToProduct, unlinkCourseFromProduct } from '@services/payments/products';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import { useOrg } from '@components/Contexts/OrgContext';
import { Trash2, Plus, BookOpen } from 'lucide-react';
import { Button } from "@components/ui/button";
import toast from 'react-hot-toast';
import { mutate } from 'swr';
import Modal from '@components/Objects/StyledElements/Modal/Modal';
import LinkCourseModal from './LinkCourseModal';

interface ProductLinkedCoursesProps {
  productId: string;
}

export default function ProductLinkedCourses({ productId }: ProductLinkedCoursesProps) {
  const [linkedCourses, setLinkedCourses] = useState<any[]>([]);
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const session = useLHSession() as any;
  const org = useOrg() as any;

  const fetchLinkedCourses = async () => {
    try {
      const response = await getCoursesLinkedToProduct(org.id, productId, session.data?.tokens?.access_token);
      setLinkedCourses(response.data || []);
    } catch (error) {
      toast.error('Failed to fetch linked courses');
    }
  };

  const handleUnlinkCourse = async (courseId: string) => {
    try {
      const response = await unlinkCourseFromProduct(org.id, productId, courseId, session.data?.tokens?.access_token);
      if (response.success) {
        await fetchLinkedCourses();
        mutate([`/payments/${org.id}/products`, session.data?.tokens?.access_token]);
        toast.success('Course unlinked successfully');
      } else {
        toast.error(response.data?.detail || 'Failed to unlink course');
      }
    } catch (error) {
      toast.error('Failed to unlink course');
    }
  };

  useEffect(() => {
    if (org && session && productId) {
      fetchLinkedCourses();
    }
  }, [org, session, productId]);

  return (
    <div className="mt-4">
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-sm font-semibold text-gray-700">Linked Courses</h3>
        <Modal
          isDialogOpen={isLinkModalOpen}
          onOpenChange={setIsLinkModalOpen}
          dialogTitle="Link Course to Product"
          dialogDescription="Select a course to link to this product"
          dialogContent={
            <LinkCourseModal
              productId={productId}
              onSuccess={() => {
                setIsLinkModalOpen(false);
                fetchLinkedCourses();
              }}
            />
          }
          dialogTrigger={
            <Button variant="outline" size="sm" className="flex items-center gap-2">
              <Plus size={16} />
              <span>Link Course</span>
            </Button>
          }
        />
      </div>

      <div className="space-y-2">
        {linkedCourses.length === 0 ? (
          <div className="text-sm text-gray-500 flex items-center gap-2">
            <BookOpen size={16} />
            <span>No courses linked yet</span>
          </div>
        ) : (
          linkedCourses.map((course) => (
            <div
              key={course.id}
              className="flex items-center justify-between p-2 bg-gray-50 rounded-md"
            >
              <span className="text-sm font-medium">{course.name}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleUnlinkCourse(course.id)}
                className="text-red-500 hover:text-red-700"
              >
                <Trash2 size={16} />
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
} 