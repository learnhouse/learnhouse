'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Circuitry } from '@phosphor-icons/react'
import { useOrg } from '@components/Contexts/OrgContext'
import PathThumbnail from '@components/Objects/Thumbnails/PathThumbnail'
import { useMyPaths } from '@/hooks/queries/usePaths'
import { getUriWithOrg } from '@services/config/config'
import { TrailSection } from './trailUi'
import { coursePath } from '@/lib/seo/paths'

/** Trail section listing the paths a learner follows, with their progress
 * (on the path card) and the next course to take. Path certificates are
 * listed with the course ones in UserCertificates. Hidden without Paths. */
function UserPaths({ orgslug }: { orgslug: string }) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const enabled = org?.config?.config?.resolved_features?.paths?.enabled === true
  const { data: paths } = useMyPaths(enabled ? org?.id : undefined)

  if (!enabled || !paths?.length) return null

  return (
    <TrailSection
      id="trail-paths"
      icon={<Circuitry size={18} />}
      title={t('paths.my_paths')}
      description={t('trail.paths.description', 'Learning paths you follow and the course to take next.')}
      count={paths.length}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {paths.map((path) => {
          const courses = Array.isArray(path.courses) ? path.courses : []
          const next = path.progress?.completed ? null : courses.find((c) => !c.completed && !c.locked)
          return (
            <div key={path.path_uuid} className="flex flex-col gap-2">
              <PathThumbnail path={path} orgslug={orgslug} />
              {next?.course && (
                <Link
                  href={getUriWithOrg(orgslug, coursePath(next))}
                  className="inline-flex items-center gap-1.5 self-start max-w-full rounded-full bg-white nice-shadow px-3 h-7 text-xs font-semibold text-neutral-700 hover:text-neutral-900"
                >
                  <span className="truncate">{t('trail.paths.next', { defaultValue: 'Next: {{name}}', name: next.course.name })}</span>
                  <ArrowRight size={12} weight="bold" className="shrink-0 rtl:rotate-180" />
                </Link>
              )}
            </div>
          )
        })}
      </div>
    </TrailSection>
  )
}

export default UserPaths
