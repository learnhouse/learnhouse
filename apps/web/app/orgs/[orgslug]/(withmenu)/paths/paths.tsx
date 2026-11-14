'use client'

import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  CheckCircle,
  Circuitry,
  MagnifyingGlass,
  Medal,
  Signpost,
} from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import TypeOfContentTitle from '@components/Objects/StyledElements/Titles/TypeOfContentTitle'
import PathThumbnail, {
  PathCardSkeleton,
  PathContinueCard,
} from '@components/Objects/Thumbnails/PathThumbnail'
import { PathsIntro } from '@components/Objects/Paths/PathTrack'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import FeatureGate from '@components/Dashboard/Shared/FeatureGate/FeatureGate'
import {
  BTN_SECONDARY_SM,
  SearchInput,
  SegmentedControl,
  ToolbarSelect,
} from '@components/Dashboard/Shared/DashKit/DashKit'
import { getUriWithOrg } from '@services/config/config'
import { Path, PathLevel } from '@services/paths/paths'
import { searchMatchesAny } from '@/lib/search/normalize'
import { usePaths } from '@/hooks/queries/usePaths'

type Status = 'all' | 'following' | 'completed' | 'new'
const LEVELS: PathLevel[] = ['beginner', 'intermediate', 'advanced']

const following = (p: Path) => !!p.progress?.enrolled && !p.progress.completed
const completed = (p: Path) => !!p.progress?.enrolled && !!p.progress.completed

function SectionTitle({
  icon,
  title,
  count,
}: {
  icon: React.ReactNode
  title: string
  count?: number
}) {
  return (
    <h2 className="flex items-center gap-2 text-sm font-bold text-neutral-900 mb-3">
      <span className="w-6 h-6 rounded-lg bg-white nice-shadow text-neutral-600 flex items-center justify-center">
        {icon}
      </span>
      {title}
      {count !== undefined && (
        <span className="text-xs font-semibold tabular-nums text-neutral-500 bg-neutral-100 rounded-full px-2 py-0.5">
          {count}
        </span>
      )}
    </h2>
  )
}

export default function PathsClient({
  orgslug,
  org_id,
}: {
  orgslug: string
  org_id: number
}) {
  const { t } = useTranslation()
  const { data, isLoading } = usePaths(org_id)
  const [searchQuery, setSearchQuery] = useState('')
  const [level, setLevel] = useState<'all' | PathLevel>('all')
  const [status, setStatus] = useState<Status>('all')

  // The learner catalog only lists published paths, even for authors.
  const paths = useMemo(() => (data || []).filter((p) => p.published), [data])
  const counts = useMemo(
    () => ({
      following: paths.filter(following).length,
      completed: paths.filter(completed).length,
      certificates: paths.filter(
        (p) => completed(p) && p.progress?.certificate_uuid
      ).length,
    }),
    [paths]
  )
  const hasJourneys = counts.following + counts.completed > 0
  const hasLevels = paths.some((p) => p.level)

  const filtered = useMemo(
    () =>
      paths.filter((p) => {
        if (level !== 'all' && p.level !== level) return false
        if (status === 'following' && !following(p)) return false
        if (status === 'completed' && !completed(p)) return false
        if (status === 'new' && p.progress?.enrolled) return false
        return (
          !searchQuery.trim() ||
          searchMatchesAny([p.name, p.description], searchQuery)
        )
      }),
    [paths, level, status, searchQuery]
  )
  // Paths in progress get their own wide row at the top of the default view.
  const splitOut = status === 'all'
  const continuing = splitOut ? filtered.filter(following) : []
  const rest = splitOut ? filtered.filter((p) => !following(p)) : filtered
  const hasFilters = !!searchQuery.trim() || level !== 'all' || status !== 'all'

  return (
    <FeatureGate feature="paths" orgslug={orgslug} context="public">
      <div className="w-full">
        <GeneralWrapperStyled>
          <div className="flex items-center justify-between">
            <TypeOfContentTitle title={t('paths.title')} type="path" />
            <AuthenticatedClientElement
              checkMethod="roles"
              action="create"
              ressourceType="courses"
              orgId={org_id}
            >
              <Link
                href={getUriWithOrg(orgslug, '/dash/paths')}
                className="inline-flex items-center gap-1 text-xs font-semibold text-neutral-500 hover:text-neutral-900 transition-colors"
              >
                {t('paths.manage_paths')}
                <ArrowRight
                  size={12}
                  weight="bold"
                  className="rtl:rotate-180"
                />
              </Link>
            </AuthenticatedClientElement>
          </div>
          <div className="-mt-2 mb-5 flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="text-sm text-neutral-500 max-w-2xl">
              {t('paths.catalog_subtitle')}
            </p>
            {hasJourneys && (
              <div className="flex flex-wrap items-center gap-1.5">
                {counts.following > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white nice-shadow px-2.5 h-7 text-xs font-semibold text-neutral-700 tabular-nums">
                    <Signpost size={13} className="text-sky-600" />
                    {t('paths.catalog.following_count', {
                      count: counts.following,
                    })}
                  </span>
                )}
                {counts.completed > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white nice-shadow px-2.5 h-7 text-xs font-semibold text-neutral-700 tabular-nums">
                    <CheckCircle size={13} className="text-emerald-600" />
                    {t('paths.catalog.completed_count', {
                      count: counts.completed,
                    })}
                  </span>
                )}
                {counts.certificates > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white nice-shadow px-2.5 h-7 text-xs font-semibold text-neutral-700 tabular-nums">
                    <Medal size={13} className="text-amber-500" />
                    {t('paths.catalog.certificates_count', {
                      count: counts.certificates,
                    })}
                  </span>
                )}
              </div>
            )}
          </div>

          {paths.length > 0 && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-6">
              <SearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder={t('paths.search_placeholder')}
                className="sm:max-w-xs"
              />
              <div className="flex flex-wrap items-center gap-2 sm:ms-auto">
                {hasJourneys && (
                  <div className="max-w-full overflow-x-auto">
                    <SegmentedControl<Status>
                      value={status}
                      onChange={setStatus}
                      ariaLabel={t('paths.catalog.status_filter')}
                      options={[
                        { key: 'all', label: t('paths.dashboard.filters.all') },
                        {
                          key: 'following',
                          label: t('paths.in_progress'),
                          count: counts.following,
                        },
                        {
                          key: 'completed',
                          label: t('paths.completed'),
                          count: counts.completed,
                        },
                        { key: 'new', label: t('paths.catalog.not_started') },
                      ]}
                    />
                  </div>
                )}
                {hasLevels && (
                  <ToolbarSelect
                    value={level}
                    onChange={(v) => setLevel(v as 'all' | PathLevel)}
                    ariaLabel={t('paths.form.level')}
                    options={[
                      { value: 'all', label: t('paths.levels.all') },
                      ...LEVELS.map((l) => ({
                        value: l,
                        label: t(`paths.levels.${l}`),
                      })),
                    ]}
                  />
                )}
              </div>
            </div>
          )}

          {continuing.length > 0 && (
            <section className="mb-8">
              <SectionTitle
                icon={<Signpost size={14} />}
                title={t('paths.catalog.continue_journey')}
                count={continuing.length}
              />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {continuing.map((path) => (
                  <PathContinueCard
                    key={path.path_uuid}
                    path={path}
                    orgslug={orgslug}
                  />
                ))}
              </div>
            </section>
          )}

          {(isLoading || rest.length > 0) && (
            <section>
              {continuing.length > 0 && (
                <SectionTitle
                  icon={<Circuitry size={14} />}
                  title={t('paths.catalog.explore')}
                  count={rest.length}
                />
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
                {isLoading
                  ? [1, 2, 3].map((i) => <PathCardSkeleton key={i} />)
                  : rest.map((path) => (
                      <PathThumbnail
                        key={path.path_uuid}
                        path={path}
                        orgslug={orgslug}
                      />
                    ))}
              </div>
            </section>
          )}

          {!isLoading && paths.length === 0 && (
            <div className="bg-white rounded-2xl nice-shadow">
              <PathsIntro
                title={t('paths.no_public_paths')}
                description={t('paths.catalog.intro_description')}
                points={[
                  t('paths.intro.ordered'),
                  t('paths.intro.electives'),
                  t('paths.intro.certificate'),
                ]}
              />
            </div>
          )}

          {!isLoading && paths.length > 0 && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center text-center py-14 px-6 gap-3">
              <div className="w-12 h-12 rounded-2xl bg-neutral-100 text-neutral-400 flex items-center justify-center">
                <MagnifyingGlass size={22} />
              </div>
              <p className="text-base font-semibold text-neutral-900">
                {t('paths.no_search_results')}
              </p>
              {hasFilters && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('')
                    setLevel('all')
                    setStatus('all')
                  }}
                  className={BTN_SECONDARY_SM}
                >
                  {t('paths.dashboard.clear_filters')}
                </button>
              )}
            </div>
          )}
        </GeneralWrapperStyled>
      </div>
    </FeatureGate>
  )
}
