import { BookCopy, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { getUriWithOrg } from '@services/config/config'
import React from 'react'
import { useTranslation } from 'react-i18next'

interface CourseBreadcrumbsProps {
  course: any
  orgslug: string
}

export default function CourseBreadcrumbs({ course, orgslug }: CourseBreadcrumbsProps) {
  const { t } = useTranslation()
  const cleanCourseUuid = course.course_uuid?.replace('course_', '')

  return (
    <div className="flex items-center gap-2 mb-4 group cursor-default">
      <div className="flex items-center gap-1.5">
        <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-white border border-gray-200/60 shadow-xs">
          <BookCopy size={13} className="text-black" />
        </div>
        <Link 
          href={getUriWithOrg(orgslug, '') + `/courses`}
          className="text-[10px] font-bold text-gray-400 hover:text-black transition-colors uppercase tracking-[0.2em]"
        >
          {t('courses.courses')}
        </Link>
      </div>
      
      <ChevronRight size={12} className="text-gray-300" />
      
      <span className="text-[10px] font-bold text-gray-900 uppercase tracking-[0.2em] line-clamp-1">
        {course.name}
      </span>
    </div>
  )
}
