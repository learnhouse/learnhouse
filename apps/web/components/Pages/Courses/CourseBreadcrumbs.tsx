import { Book, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { getUriWithOrg } from '@services/config/config'
import React from 'react'

interface CourseBreadcrumbsProps {
  course: any
  orgslug: string
}

export default function CourseBreadcrumbs({ course, orgslug }: CourseBreadcrumbsProps) {
  const cleanCourseUuid = course.course_uuid?.replace('course_', '')

  return (
    <div className="text-gray-400 tracking-tight font-medium text-sm flex space-x-1 pt-2">
      <div className="flex items-center space-x-1">
        <div className="flex space-x-2 items-center">
          <Book className="text-gray" size={14} />
          <Link href={getUriWithOrg(orgslug, '') + `/courses`}>
            Courses
          </Link>
        </div>
        <ChevronRight size={14} />
        <div className="first-letter:uppercase">
          {course.name}
        </div>
      </div>
    </div>
  )
} 