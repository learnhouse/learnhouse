import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { Button } from '@components/ui/button'
import { getOrgCourses } from '@services/courses/courses'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { linkCourseToProduct } from '@services/payments/products'
import { getCoursesLinkedToProduct } from '@services/payments/products'
import { useState } from 'react'
import toast from 'react-hot-toast'
import { mutate } from 'swr'
import useSWR from 'swr'

interface LinkCourseModalProps {
  productId: string
  onSuccess: () => void
}

interface CoursePreviewProps {
  course: {
    id: string
    name: string
    description: string
    thumbnail_image: string
    course_uuid: string
  }
  orgslug: string
  onLink: (courseId: string) => void
  isLinked: boolean
}

const CoursePreview = ({
  course,
  orgslug,
  onLink,
  isLinked,
}: CoursePreviewProps) => {
  const org = useOrg() as any

  const thumbnailImage = course.thumbnail_image
    ? getCourseThumbnailMediaDirectory(
        org?.org_uuid,
        course.course_uuid,
        course.thumbnail_image
      )
    : '../empty_thumbnail.png'

  return (
    <div className="flex gap-4 rounded-lg border border-gray-100 bg-white p-4 transition-colors hover:border-gray-200">
      {/* Thumbnail */}
      <div
        className="h-[68px] w-[120px] shrink-0 rounded-md bg-cover bg-center ring-1 ring-black/10 ring-inset"
        style={{ backgroundImage: `url(${thumbnailImage})` }}
      />

      {/* Content */}
      <div className="grow space-y-1">
        <h3 className="line-clamp-1 font-medium text-gray-900">
          {course.name}
        </h3>
        <p className="line-clamp-2 text-sm text-gray-500">
          {course.description}
        </p>
      </div>

      {/* Action Button */}
      <div className="flex shrink-0 items-center">
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
          <Button onClick={() => onLink(course.id)} size="sm">
            Link Course
          </Button>
        )}
      </div>
    </div>
  )
}

export default function LinkCourseModal({
  productId,
  onSuccess,
}: LinkCourseModalProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const org = useOrg() as any
  const session = useLHSession() as any

  const { data: courses } = useSWR(
    () =>
      org && session
        ? [org.slug, searchTerm, session.data?.tokens?.access_token]
        : null,
    ([orgSlug, search, token]) => getOrgCourses(orgSlug, null, token)
  )

  const { data: linkedCourses } = useSWR(
    () =>
      org && session
        ? [
            `/payments/${org.id}/products/${productId}/courses`,
            session.data?.tokens?.access_token,
          ]
        : null,
    ([_, token]) => getCoursesLinkedToProduct(org.id, productId, token)
  )

  const handleLinkCourse = async (courseId: string) => {
    try {
      const response = await linkCourseToProduct(
        org.id,
        productId,
        courseId,
        session.data?.tokens?.access_token
      )
      if (response.success) {
        mutate([
          `/payments/${org.id}/products`,
          session.data?.tokens?.access_token,
        ])
        toast.success('Course linked successfully')
        onSuccess()
      } else {
        toast.error(response.data?.detail || 'Failed to link course')
      }
    } catch (error) {
      toast.error('Failed to link course')
    }
  }

  const isLinked = (courseId: string) => {
    return linkedCourses?.data?.some((course: any) => course.id === courseId)
  }

  return (
    <div className="space-y-4">
      {/* Course List */}
      <div className="max-h-[400px] space-y-2 overflow-y-auto px-3">
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
          <div className="py-6 text-center text-gray-500">No courses found</div>
        )}
      </div>
    </div>
  )
}
