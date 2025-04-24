import { useCourse } from '@components/Contexts/CourseContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { getAPIUrl } from '@services/config/config'
import { updateCourseThumbnail } from '@services/courses/courses'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { ArrowBigUpDash, UploadCloud, Image as ImageIcon } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import React, { useState } from 'react'
import { mutate } from 'swr'
import UnsplashImagePicker from './UnsplashImagePicker'

function ThumbnailUpdate() {
  const course = useCourse() as any
  const session = useLHSession() as any;
  const org = useOrg() as any
  const [localThumbnail, setLocalThumbnail] = React.useState(null) as any
  const [isLoading, setIsLoading] = React.useState(false) as any
  const [error, setError] = React.useState('') as any
  const [showUnsplashPicker, setShowUnsplashPicker] = useState(false)
  const withUnpublishedActivities = course ? course.withUnpublishedActivities : false

  const validateFileType = (file: File): boolean => {
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png'];
    if (!validTypes.includes(file.type)) {
      setError('Please upload only PNG or JPG/JPEG images');
      return false;
    }
    return true;
  }

  const handleFileChange = async (event: any) => {
    const file = event.target.files[0]
    if (!file) return;
    
    if (!validateFileType(file)) {
      event.target.value = '';
      return;
    }
    
    setLocalThumbnail(file)
    await updateThumbnail(file)
  }

  const handleUnsplashSelect = async (imageUrl: string) => {
    setIsLoading(true)
    const response = await fetch(imageUrl)
    const blob = await response.blob()
    const file = new File([blob], 'unsplash_image.jpg', { type: 'image/jpeg' })
    setLocalThumbnail(file)
    await updateThumbnail(file)
  }

  const updateThumbnail = async (file: File) => {
    setIsLoading(true)
    const res = await updateCourseThumbnail(
      course.courseStructure.course_uuid,
      file,
      session.data?.tokens?.access_token
    )
    mutate(`${getAPIUrl()}courses/${course.courseStructure.course_uuid}/meta?with_unpublished_activities=${withUnpublishedActivities}`)
    // wait for 1 second to show loading animation
    await new Promise((r) => setTimeout(r, 1500))
    if (res.success === false) {
      setError(res.HTTPmessage)
    } else {
      setIsLoading(false)
      setError('')
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
              src={URL.createObjectURL(localThumbnail)}
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