// ThumbnailUploader.tsx
import React, { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { getAPIUrl } from '@services/config/config';
import { updateCourseThumbnail } from '@services/courses/courses';
import { useRouter } from 'next/navigation';
import { revalidateTags } from '@services/utils/ts/requests';
import { getCourseThumbnailMediaDirectory } from '@services/media/media'; // Added import

interface ThumbnailUploaderProps {
  courseid: string;
}

const ThumbnailUploader: React.FC<ThumbnailUploaderProps> = ({ courseid }) => {
  const router = useRouter();
  const { data: course } = useSWR(`${getAPIUrl()}courses/course_${courseid}`);
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (file) {
      setUploading(true);

      try {
        await updateCourseThumbnail(courseid, file);

        // Trigger SWR mutate to update the course data
        mutate(`${getAPIUrl()}courses/course_${courseid}`);

        // Revalidate specific tags and router refresh in a Next.js context
        await revalidateTags(['courses'], course.org_slug);
        router.refresh();
      } catch (error) {
        console.error('Error uploading thumbnail:', error);
      } finally {
        setUploading(false);
      }
    }
  };

  return (
    <div className="flex items-center justify-center">
      <div className="relative">
        {/* Current Thumbnail */}
        <img
          src={course?.thumbnailUrl}
          alt="Current Thumbnail"
          className="w-40 h-40 object-cover rounded"
        />

        {/* Hidden File Input */}
        <input
          type="file"
          id={`thumbnail-upload-${courseid}`}
          accept="image/*"
          className="hidden"
          onChange={handleUpload}
        />

        {/* Visible Update Thumbnail Button */}
        <label htmlFor={`thumbnail-upload-${courseid}`} className="inline-block px-4 py-2 text-white bg-blue-500 rounded hover:bg-blue-700">
          {uploading ? 'Uploading...' : 'Update Thumbnail'}
        </label>
      </div>
    </div>
  );
};

export default ThumbnailUploader;