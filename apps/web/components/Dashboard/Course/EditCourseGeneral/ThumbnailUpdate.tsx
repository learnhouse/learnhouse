import { useCourse } from '@components/Contexts/CourseContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { getAPIUrl } from '@services/config/config'
import { updateCourseThumbnail } from '@services/courses/courses'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { ArrowBigUpDash, UploadCloud } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import React from 'react'
import { mutate } from 'swr'

function ThumbnailUpdate() {
  const course = useCourse() as any
  const session = useLHSession()
  const org = useOrg() as any
  const [localThumbnail, setLocalThumbnail] = React.useState(null) as any
  const [isLoading, setIsLoading] = React.useState(false) as any
  const [error, setError] = React.useState('') as any

  const handleFileChange = async (event: any) => {
    const file = event.target.files[0]
    setLocalThumbnail(file)
    setIsLoading(true)
    const res = await updateCourseThumbnail(
      course.courseStructure.course_uuid,
      file,
      session.data?.tokens?.access_token
    )
    mutate(`${getAPIUrl()}courses/${course.courseStructure.course_uuid}/meta`)
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
    <div className="w-auto bg-gray-50 rounded-xl outline outline-1 outline-gray-200 h-[200px] shadow">
      <div className="flex flex-col justify-center items-center h-full">
        <div className="flex flex-col justify-center items-center">
          <div className="flex flex-col justify-center items-center">
            {error && (
              <div className="flex justify-center bg-red-200 rounded-md text-red-950 space-x-2 items-center p-2 transition-all shadow-sm">
                <div className="text-sm font-semibold">{error}</div>
              </div>
            )}
            {localThumbnail ? (
              <img
                src={URL.createObjectURL(localThumbnail)}
                className={`${isLoading ? 'animate-pulse' : ''
                  } shadow w-[200px] h-[100px] rounded-md`}
              />
            ) : (
              <img
                src={`${course.courseStructure.thumbnail_image ? getCourseThumbnailMediaDirectory(
                  org?.org_uuid,
                  course.courseStructure.course_uuid,
                  course.courseStructure.thumbnail_image
                ) : '/empty_thumbnail.png'}`}
                className="shadow w-[200px] h-[100px] rounded-md bg-gray-200"
              />
            )}
          </div>
          {isLoading ? (
            <div className="flex justify-center items-center">
              <input
                type="file"
                id="fileInput"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
              <div className="font-bold  animate-pulse antialiased items-center bg-green-200 text-gray text-sm rounded-md px-4 py-2 mt-4 flex">
                <ArrowBigUpDash size={16} className="mr-2" />
                <span>Uploading</span>
              </div>
            </div>
          ) : (
            <div className="flex justify-center items-center">
              <input
                type="file"
                id="fileInput"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
              <button
                className="font-bold antialiased items-center  text-gray text-sm rounded-md px-4  mt-6 flex"
                onClick={() => document.getElementById('fileInput')?.click()}
              >
                <UploadCloud size={16} className="mr-2" />
                <span>Change Thumbnail</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default ThumbnailUpdate
