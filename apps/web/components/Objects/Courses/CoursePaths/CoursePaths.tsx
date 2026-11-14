'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { Circuitry } from '@phosphor-icons/react'
import { useOrg } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import { usePathsForCourse } from '@/hooks/queries/usePaths'
import { resourcePath } from '@/lib/seo/paths'

/** "Part of a path" box on the course page: points learners at the bigger
 * journeys this course belongs to. Renders nothing when there are none. */
function CoursePaths({ courseUuid, orgslug }: { courseUuid: string; orgslug: string }) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const enabled = org?.config?.config?.resolved_features?.paths?.enabled === true
  const { data: paths } = usePathsForCourse(courseUuid, enabled)

  if (!enabled || !paths?.length) return null

  return (
    <div className="bg-white shadow-md shadow-gray-300/25 outline outline-1 outline-neutral-200/40 rounded-lg overflow-hidden p-4 space-y-3">
      <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
        <Circuitry size={13} />
        {t('paths.part_of_paths')}
      </h3>
      <ul className="space-y-1">
        {paths.map((path) => (
          <li key={path.path_uuid}>
            <Link
              href={getUriWithOrg(orgslug, resourcePath('path', path))}
              className="group flex items-center gap-2 -mx-2 px-2 py-1.5 rounded-md hover:bg-gray-50 transition-colors"
            >
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-gray-900 truncate" dir="auto">{path.name}</span>
                <span className="block text-xs text-gray-500">
                  {path.progress?.enrolled
                    ? t('paths.progress_short', { done: path.progress.courses_done, total: path.progress.courses_needed })
                    : t('paths.course_count', { count: path.course_count })}
                </span>
              </span>
              <ChevronRight size={16} className="text-gray-300 group-hover:text-gray-500 rtl:rotate-180" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default CoursePaths
