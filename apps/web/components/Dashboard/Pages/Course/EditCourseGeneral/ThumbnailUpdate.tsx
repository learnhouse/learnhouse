import { useCourse } from '@components/Contexts/CourseContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { getAPIUrl } from '@services/config/config'
import { updateCourseThumbnail } from '@services/courses/courses'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { ArrowBigUpDash, UploadCloud, Image as ImageIcon } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import React, { useState, useEffect } from 'react'
import { mutate } from 'swr'
import UnsplashImagePicker from './UnsplashImagePicker'

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const VALID_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png'] as const;

type ValidMimeType = typeof VALID_MIME_TYPES[number];

function ThumbnailUpdate() {
  const course = useCourse() as any
  const session = useLHSession() as any;
  const org = useOrg() as any
  const [localThumbnail, setLocalThumbnail] = useState<{ file: File; url: string } | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string>('')
  const [showUnsplashPicker, setShowUnsplashPicker] = useState(false)
  const withUnpublishedActivities = course ? course.withUnpublishedActivities : false

  // Cleanup blob URLs when component unmounts or when thumbnail changes
  useEffect(() => {
    return () => {
      if (localThumbnail?.url) {
        URL.revokeObjectURL(localThumbnail.url);
      }
    };
  }, [localThumbnail]);

  const validateFile = (file: File): boolean => {
    if (!VALID_MIME_TYPES.includes(file.type as ValidMimeType)) {
      setError('Please upload only PNG or JPG/JPEG images');
      return false;
    }

    if (file.size > MAX_FILE_SIZE) {
      setError('File size should be less than 5MB');
      return false;
    }

    return true;
  }

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    if (!validateFile(file)) {
      event.target.value = '';
      return;
    }
    
    const blobUrl = URL.createObjectURL(file);
    setLocalThumbnail({ file, url: blobUrl });
    await updateThumbnail(file);
  }

  const handleUnsplashSelect = async (imageUrl: string) => {
    try {
      setIsLoading(true);
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      
      if (!VALID_MIME_TYPES.includes(blob.type as ValidMimeType)) {
        throw new Error('Invalid image format from Unsplash');
      }

      const file = new File([blob], `unsplash_${Date.now()}.jpg`, { type: blob.type });
      
      if (!validateFile(file)) {
        return;
      }

      const blobUrl = URL.createObjectURL(file);
      setLocalThumbnail({ file, url: blobUrl });
      await updateThumbnail(file);
    } catch (err) {
      setError('Failed to process Unsplash image');
      setIsLoading(false);
    }
  }

  const updateThumbnail = async (file: File) => {
    setIsLoading(true);
    try {
      const res = await updateCourseThumbnail(
        course.courseStructure.course_uuid,
        file,
        session.data?.tokens?.access_token
      );
      
      await mutate(`${getAPIUrl()}courses/${course.courseStructure.course_uuid}/meta?with_unpublished_activities=${withUnpublishedActivities}`);
      await new Promise((r) => setTimeout(r, 1500));

      if (res.success === false) {
        setError(res.HTTPmessage);
      } else {
        setError('');
      }
    } catch (err) {
      setError('Failed to update thumbnail');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="w-auto rounded-xl border border-gray-200 h-[250px] light-shadow bg-gray-50 transition-all duration-200">
      <div className="flex flex-col justify-center items-center h-full p-6 space-y-4">
        {error && (
          <div className="absolute top-4 flex justify-center bg-red-50 rounded-lg text-red-800 space-x-2 items-center p-3 transition-all">
            <div className="text-sm font-medium">{error}</div>
          </div>
        )}
        
        <div className="flex flex-col items-center space-y-4">
          {localThumbnail ? (
            <img
              src={localThumbnail.url}
              className={`${
                isLoading ? 'animate-pulse' : ''
              } shadow-sm w-[280px] h-[140px] object-cover rounded-lg border border-gray-200`}
              alt="Course thumbnail"
            />
          ) : (
            <img
              src={`${course.courseStructure.thumbnail_image ? getCourseThumbnailMediaDirectory(
                org?.org_uuid,
                course.courseStructure.course_uuid,
                course.courseStructure.thumbnail_image
              ) : '/empty_thumbnail.png'}`}
              className="shadow-sm w-[280px] h-[140px] object-cover rounded-lg border border-gray-200 bg-gray-50"
              alt="Course thumbnail"
            />
          )}

          {!isLoading && (
            <div className="flex space-x-2">
              <input
                type="file"
                id="fileInput"
                className="hidden"
                accept=".jpg,.jpeg,.png"
                onChange={handleFileChange}
              />
              <button
                className="bg-gray-50 text-gray-800 px-4 py-2 rounded-md text-sm font-medium flex items-center hover:bg-gray-100 transition-colors duration-200 border border-gray-200"
                onClick={() => document.getElementById('fileInput')?.click()}
              >
                <UploadCloud size={16} className="mr-2" />
                Upload
              </button>
              <button
                className="bg-gray-50 text-gray-800 px-4 py-2 rounded-md text-sm font-medium flex items-center hover:bg-gray-100 transition-colors duration-200 border border-gray-200"
                onClick={() => setShowUnsplashPicker(true)}
              >
                <ImageIcon size={16} className="mr-2" />
                Gallery
              </button>
            </div>
          )}
        </div>

        {isLoading && (
          <div className="flex justify-center items-center">
            <div className="font-medium text-sm text-green-800 bg-green-50 rounded-full px-4 py-2 flex items-center">
              <ArrowBigUpDash size={16} className="mr-2 animate-bounce" />
              Uploading...
            </div>
          </div>
        )}
        
        <p className="text-xs text-gray-500">Supported formats: PNG, JPG/JPEG</p>
      </div>
      
      {showUnsplashPicker && (
        <UnsplashImagePicker
          onSelect={handleUnsplashSelect}
          onClose={() => setShowUnsplashPicker(false)}
        />
      )}
    </div>
  )
}

export default ThumbnailUpdate