import { useCourse } from '@components/Contexts/CourseContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { getAPIUrl } from '@services/config/config'
import { updateCourseThumbnail } from '@services/courses/courses'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { ArrowBigUpDash, UploadCloud, Image as ImageIcon, Video } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import React, { useState, useEffect, useRef } from 'react'
import { mutate } from 'swr'
import UnsplashImagePicker from './UnsplashImagePicker'
import toast from 'react-hot-toast'

const MAX_FILE_SIZE = 8_000_000; // 8MB for images
const MAX_VIDEO_FILE_SIZE = 100_000_000; // 100MB for videos
const VALID_IMAGE_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png'] as const;
const VALID_VIDEO_MIME_TYPES = ['video/mp4', 'video/webm'] as const;

type ValidImageMimeType = typeof VALID_IMAGE_MIME_TYPES[number];
type ValidVideoMimeType = typeof VALID_VIDEO_MIME_TYPES[number];

type ThumbnailUpdateProps = {
  thumbnailType: 'image' | 'video' | 'both';
}

type TabType = 'image' | 'video';

function ThumbnailUpdate({ thumbnailType }: ThumbnailUpdateProps) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const course = useCourse() as any
  const session = useLHSession() as any;
  const org = useOrg() as any
  const [localThumbnail, setLocalThumbnail] = useState<{ file: File; url: string; type: 'image' | 'video' } | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [showUnsplashPicker, setShowUnsplashPicker] = useState(false)
  const [activeTab, setActiveTab] = useState<TabType>('image')
  const withUnpublishedActivities = course ? course.withUnpublishedActivities : false

  // Set initial active tab based on thumbnailType
  useEffect(() => {
    if (thumbnailType === 'video') {
      setActiveTab('video');
    } else {
      setActiveTab('image');
    }
  }, [thumbnailType]);

  // Cleanup blob URLs when component unmounts or when thumbnail changes
  useEffect(() => {
    return () => {
      if (localThumbnail?.url) {
        URL.revokeObjectURL(localThumbnail.url);
      }
    };
  }, [localThumbnail]);

  const showError = (message: string) => {
    toast.error(message, {
      duration: 3000,
      position: 'top-center',
    });
  };

  const validateFile = (file: File, type: 'image' | 'video'): boolean => {
    if (type === 'image') {
      if (!VALID_IMAGE_MIME_TYPES.includes(file.type as ValidImageMimeType)) {
        showError(`Invalid file type: ${file.type}. Please upload only PNG or JPG/JPEG images`);
        return false;
      }

      if (file.size > MAX_FILE_SIZE) {
        showError(`File size (${(file.size / 1024 / 1024).toFixed(2)}MB) exceeds the 8MB limit`);
        return false;
      }
    } else {
      if (!VALID_VIDEO_MIME_TYPES.includes(file.type as ValidVideoMimeType)) {
        showError(`Invalid file type: ${file.type}. Please upload only MP4 or WebM videos`);
        return false;
      }

      if (file.size > MAX_VIDEO_FILE_SIZE) {
        showError(`File size (${(file.size / 1024 / 1024).toFixed(2)}MB) exceeds the 100MB limit`);
        return false;
      }
    }

    return true;
  }

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>, type: 'image' | 'video') => {
    const file = event.target.files?.[0];
    
    if (!file) {
      showError('Please select a file');
      return;
    }
    
    if (!validateFile(file, type)) {
      event.target.value = '';
      return;
    }
    
    const blobUrl = URL.createObjectURL(file);
    setLocalThumbnail({ file, url: blobUrl, type });
    await updateThumbnail(file, type);
  }

  const handleUnsplashSelect = async (imageUrl: string) => {
    try {
      setIsLoading(true);
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      
      if (!VALID_IMAGE_MIME_TYPES.includes(blob.type as ValidImageMimeType)) {
        throw new Error('Invalid image format from Unsplash');
      }

      const file = new File([blob], `unsplash_${Date.now()}.jpg`, { type: blob.type });
      
      if (!validateFile(file, 'image')) {
        return;
      }

      const blobUrl = URL.createObjectURL(file);
      setLocalThumbnail({ file, url: blobUrl, type: 'image' });
      await updateThumbnail(file, 'image');
    } catch (err) {
      showError('Failed to process Unsplash image');
      setIsLoading(false);
    }
  }

  const updateThumbnail = async (file: File, type: 'image' | 'video') => {
    setIsLoading(true);
    try {
      const formData = new FormData();
      formData.append('thumbnail', file);
      formData.append('thumbnail_type', type);

      const res = await updateCourseThumbnail(
        course.courseStructure.course_uuid,
        formData,
        session.data?.tokens?.access_token
      );
      
      await mutate(`${getAPIUrl()}courses/${course.courseStructure.course_uuid}/meta?with_unpublished_activities=${withUnpublishedActivities}`);
      await new Promise((r) => setTimeout(r, 1500));

      if (res.success === false) {
        showError(res.HTTPmessage);
      } else {
        setLocalThumbnail(null);
        toast.success('Thumbnail updated successfully', {
          duration: 3000,
          position: 'top-center',
        });
      }
    } catch (err) {
      showError('Failed to update thumbnail');
    } finally {
      setIsLoading(false);
    }
  }

  const getThumbnailUrl = (type: 'image' | 'video') => {
    if (type === 'image') {
      return course.courseStructure.thumbnail_image
        ? getCourseThumbnailMediaDirectory(
            org?.org_uuid,
            course.courseStructure.course_uuid,
            course.courseStructure.thumbnail_image
          )
        : '/empty_thumbnail.png';
    } else {
      return course.courseStructure.thumbnail_video
        ? getCourseThumbnailMediaDirectory(
            org?.org_uuid,
            course.courseStructure.course_uuid,
            course.courseStructure.thumbnail_video
          )
        : undefined;
    }
  };

  const renderThumbnailPreview = () => {
    if (localThumbnail) {
      if (localThumbnail.type === 'video') {
        return (
          <div className="max-w-[480px] mx-auto">
            <video
              src={localThumbnail.url}
              className={`${isLoading ? 'animate-pulse' : ''} w-full aspect-video object-cover rounded-lg border border-gray-200`}
              controls
            />
          </div>
        );
      } else {
        return (
          <div className="max-w-[480px] mx-auto">
            <img
              src={localThumbnail.url}
              alt="Course thumbnail preview"
              className={`${isLoading ? 'animate-pulse' : ''} w-full aspect-video object-cover rounded-lg border border-gray-200`}
            />
          </div>
        );
      }
    }

    const currentThumbnailUrl = getThumbnailUrl(activeTab);
    if (activeTab === 'video' && currentThumbnailUrl) {
      return (
        <div className="max-w-[480px] mx-auto">
          <video
            src={currentThumbnailUrl}
            className="w-full aspect-video object-cover rounded-lg border border-gray-200"
            controls
          />
        </div>
      );
    } else if (currentThumbnailUrl) {
      return (
        <div className="max-w-[480px] mx-auto">
          <img
            src={currentThumbnailUrl}
            alt="Current course thumbnail"
            className="w-full aspect-video object-cover rounded-lg border border-gray-200"
          />
        </div>
      );
    }

    return null;
  };

  const renderTabContent = () => {
    if (isLoading) {
      return (
        <div className="flex justify-center items-center mt-4">
          <div className="font-medium text-sm text-green-800 bg-green-50 rounded-full px-4 py-2 flex items-center">
            <ArrowBigUpDash size={16} className="mr-2 animate-bounce" />
            Uploading...
          </div>
        </div>
      );
    }

    if (activeTab === 'image') {
      return (
        <div className="flex gap-2 mt-4">
          <input
            ref={imageInputRef}
            type="file"
            className="hidden"
            accept=".jpg,.jpeg,.png"
            onChange={(e) => handleFileChange(e, 'image')}
          />
          <button
            type="button"
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            onClick={() => imageInputRef.current?.click()}
          >
            <UploadCloud size={16} />
            Upload Image
          </button>
          <button
            type="button"
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            onClick={() => setShowUnsplashPicker(true)}
          >
            <ImageIcon size={16} />
            Gallery
          </button>
        </div>
      );
    }

    return (
      <div className="flex gap-2 mt-4">
        <input
          ref={videoInputRef}
          type="file"
          className="hidden"
          accept=".mp4,.webm"
          onChange={(e) => handleFileChange(e, 'video')}
        />
        <button
          type="button"
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          onClick={() => videoInputRef.current?.click()}
        >
          <Video size={16} />
          Upload Video
        </button>
      </div>
    );
  };

  return (
    <div className="w-full bg-white rounded-xl">
      {/* Tabs Navigation */}
      {thumbnailType === 'both' && (
        <div className="flex border-b border-gray-100">
          <button
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === 'image'
                ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50'
                : 'text-gray-600 hover:text-gray-900'
            }`}
            onClick={() => setActiveTab('image')}
          >
            <ImageIcon size={16} />
            Image
          </button>
          <button
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === 'video'
                ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50'
                : 'text-gray-600 hover:text-gray-900'
            }`}
            onClick={() => setActiveTab('video')}
          >
            <Video size={16} />
            Video
          </button>
        </div>
      )}

      <div className="p-6">
        <div className="space-y-6">
          {renderThumbnailPreview()}
          {renderTabContent()}
          
          <p className="text-sm text-gray-500">
            {activeTab === 'image' && 'Supported formats: PNG, JPG/JPEG (max 8MB)'}
            {activeTab === 'video' && 'Supported formats: MP4, WebM (max 100MB)'}
          </p>
        </div>
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