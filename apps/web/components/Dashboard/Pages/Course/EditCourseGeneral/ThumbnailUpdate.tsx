import { useCourse } from '@components/Contexts/CourseContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { updateCourseThumbnail } from '@services/courses/courses'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { ArrowFatLinesUp, CloudArrowUp, Image as ImageIcon, VideoCamera } from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import React, { useState, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@lib/query/keys'
import AIImageButton from '@components/Objects/AI/AIImageButton'
import { aiButtonClass } from '@components/Objects/AI/AIBrand'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { SafeImage, SafeVideo } from '@components/Objects/SafeImage'
import { BTN_SECONDARY, Chip, SegmentedControl } from '@components/Dashboard/Shared/DashKit/DashKit'
import ThumbnailImage from '@components/Objects/Thumbnails/ThumbnailImage'

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
  const { t } = useTranslation()
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const course = useCourse() as any
  const session = useLHSession() as any;
  const org = useOrg() as any
  const queryClient = useQueryClient()
  const [localThumbnail, setLocalThumbnail] = useState<{ file: File; url: string; type: 'image' | 'video' } | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<TabType>('image')
  const _withUnpublishedActivities = course ? course.withUnpublishedActivities : false

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
        showError(t('dashboard.courses.general.thumbnail.invalid_image_type', { type: file.type }));
        return false;
      }

      if (file.size > MAX_FILE_SIZE) {
        showError(t('dashboard.courses.general.thumbnail.image_too_large', { size: (file.size / 1024 / 1024).toFixed(2) }));
        return false;
      }
    } else {
      if (!VALID_VIDEO_MIME_TYPES.includes(file.type as ValidVideoMimeType)) {
        showError(t('dashboard.courses.general.thumbnail.invalid_video_type', { type: file.type }));
        return false;
      }

      if (file.size > MAX_VIDEO_FILE_SIZE) {
        showError(t('dashboard.courses.general.thumbnail.video_too_large', { size: (file.size / 1024 / 1024).toFixed(2) }));
        return false;
      }
    }

    return true;
  }

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>, type: 'image' | 'video') => {
    const file = event.target.files?.[0];
    
    if (!file) {
      showError(t('dashboard.courses.general.thumbnail.select_file'));
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

  const handleRemoteImageSelect = async (imageUrl: string) => {
    try {
      setIsLoading(true);
      const response = await fetch(imageUrl);
      const blob = await response.blob();

      if (!VALID_IMAGE_MIME_TYPES.includes(blob.type as ValidImageMimeType)) {
        throw new Error('Invalid generated image format');
      }

      const file = new File([blob], `ai_image_${Date.now()}.jpg`, { type: blob.type });

      if (!validateFile(file, 'image')) {
        return;
      }

      const blobUrl = URL.createObjectURL(file);
      setLocalThumbnail({ file, url: blobUrl, type: 'image' });
      await updateThumbnail(file, 'image');
    } catch (_err) {
      showError(t('dashboard.courses.general.thumbnail.load_generated_failed'));
      setIsLoading(false);
    }
  }

  const handleAIImageFile = async (file: File) => {
    if (!validateFile(file, 'image')) return
    const blobUrl = URL.createObjectURL(file)
    setLocalThumbnail({ file, url: blobUrl, type: 'image' })
    await updateThumbnail(file, 'image')
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
      
      // Invalidate course meta cache
      const cleanUuid = course.courseStructure.course_uuid.replace('course_', '')
      await queryClient.invalidateQueries({ queryKey: queryKeys.courses.meta(cleanUuid) })
      await queryClient.invalidateQueries({ queryKey: queryKeys.courses.list(org.slug) })
      await new Promise((r) => setTimeout(r, 1500));

      if (res.success === false) {
        showError(res.HTTPmessage);
      } else {
        setLocalThumbnail(null);
        toast.success(t('dashboard.courses.communities.thumbnail.toasts.update_success'), {
          duration: 3000,
          position: 'top-center',
        });
      }
    } catch (_err) {
      showError(t('dashboard.courses.communities.thumbnail.toasts.update_error'));
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
        : null;
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

  const previewClass = 'w-full aspect-video object-cover rounded-xl ring-1 ring-black/5 bg-neutral-100'

  const renderThumbnailPreview = () => {
    if (localThumbnail) {
      return localThumbnail.type === 'video' ? (
        <SafeVideo
          src={localThumbnail.url}
          className={`${isLoading ? 'animate-pulse' : ''} ${previewClass}`}
          controls
        />
      ) : (
        <SafeImage
          src={localThumbnail.url}
          alt={t('dashboard.courses.general.thumbnail.preview_alt')}
          className={`${isLoading ? 'animate-pulse' : ''} ${previewClass}`}
        />
      );
    }

    const currentThumbnailUrl = getThumbnailUrl(activeTab);
    if (activeTab === 'video' && currentThumbnailUrl) {
      return <SafeVideo src={currentThumbnailUrl} className={previewClass} controls />;
    } else if (activeTab === 'image') {
      // ThumbnailImage shows the default placeholder when there is no image
      // or the file is missing, instead of a broken <img> with alt text.
      return (
        <ThumbnailImage
          src={currentThumbnailUrl}
          loading="eager"
          alt={t('dashboard.courses.general.thumbnail.current_alt')}
          className={previewClass}
        />
      );
    }

    // No video uploaded yet: an empty frame keeps the layout steady.
    return (
      <div className={`${previewClass} flex items-center justify-center text-neutral-300`}>
        <VideoCamera size={28} />
      </div>
    );
  };

  const renderTabContent = () => {
    if (isLoading) {
      return (
        <Chip tone="emerald" icon={<ArrowFatLinesUp size={14} className="animate-bounce" />}>
          {t('dashboard.courses.communities.thumbnail.uploading')}
        </Chip>
      );
    }

    if (activeTab === 'image') {
      return (
        <div className="flex flex-wrap gap-2">
          <input
            ref={imageInputRef}
            type="file"
            className="hidden"
            accept=".jpg,.jpeg,.png"
            onChange={(e) => handleFileChange(e, 'image')}
          />
          <button
            type="button"
            className={BTN_SECONDARY}
            onClick={() => imageInputRef.current?.click()}
          >
            <CloudArrowUp size={16} />
            {t('dashboard.courses.general.thumbnail.upload_image')}
          </button>
          {/* Its own generator (pick a style, choose among results) stays
              here: Atlas's "Generate a thumbnail" sets one for you instead. */}
          <AIImageButton
            onSelect={handleRemoteImageSelect}
            onSelectFile={handleAIImageFile}
            className={aiButtonClass('soft', 'md')}
          />
        </div>
      );
    }

    return (
      <div className="flex flex-wrap gap-2">
        <input
          ref={videoInputRef}
          type="file"
          className="hidden"
          accept=".mp4,.webm"
          onChange={(e) => handleFileChange(e, 'video')}
        />
        <button
          type="button"
          className={BTN_SECONDARY}
          onClick={() => videoInputRef.current?.click()}
        >
          <VideoCamera size={16} />
          {t('dashboard.courses.general.thumbnail.upload_video')}
        </button>
      </div>
    );
  };

  return (
    <div className="w-full flex flex-col md:flex-row gap-5">
      <div className="w-full md:w-[360px] shrink-0">{renderThumbnailPreview()}</div>
      <div className="flex flex-col gap-4 min-w-0">
        {thumbnailType === 'both' && (
          <SegmentedControl
            value={activeTab}
            onChange={setActiveTab}
            options={[
              {
                key: 'image',
                label: (
                  <>
                    <ImageIcon size={14} />
                    {t('dashboard.courses.general.thumbnail.tabs.image')}
                  </>
                ),
              },
              {
                key: 'video',
                label: (
                  <>
                    <VideoCamera size={14} />
                    {t('dashboard.courses.general.thumbnail.tabs.video')}
                  </>
                ),
              },
            ]}
          />
        )}
        {renderTabContent()}
        <p className="text-xs text-neutral-400">
          {activeTab === 'image' && t('dashboard.courses.general.thumbnail.supported_formats.image')}
          {activeTab === 'video' && t('dashboard.courses.general.thumbnail.supported_formats.video')}
        </p>
        {/* Uploads are actions, not form state: they apply without the header Save. */}
        <p className="text-xs text-neutral-400">{t('dashboard.courses.editor.general.thumbnail_saves_now')}</p>
      </div>
    </div>
  )
}

export default ThumbnailUpdate
