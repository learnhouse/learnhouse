import { BookCopy, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { getUriWithOrg } from '@services/config/config'
import React from 'react'
import { useTranslation } from 'react-i18next'

interface ActivityBreadcrumbsProps {
  course: any
  activity: any
  orgslug: string
}

export default function ActivityBreadcrumbs({ course, activity, orgslug }: ActivityBreadcrumbsProps) {
  const { t } = useTranslation();
  const cleanCourseUuid = course.course_uuid?.replace('course_', '')

  return (
    <div className="flex items-center gap-2 mb-6 group cursor-default">
      <div className="flex items-center gap-1.5 shrink-0">
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
      
      <ChevronRight size={12} className="text-gray-300 shrink-0" />
      
      <Link 
        href={getUriWithOrg(orgslug, '') + `/course/${cleanCourseUuid}`}
        className="text-[10px] font-bold text-gray-400 hover:text-black transition-colors uppercase tracking-[0.2em] truncate max-w-[150px]"
      >
        {course.name}
      </Link>

      <ChevronRight size={12} className="text-gray-300 shrink-0" />

      <span className="text-[10px] font-bold text-gray-900 uppercase tracking-[0.2em] line-clamp-1">
        {activity.name}
      </span>
    </div>
  )
}
