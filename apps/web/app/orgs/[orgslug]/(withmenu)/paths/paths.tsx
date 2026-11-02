'use client'

import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import { Route, Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import TypeOfContentTitle from '@components/Objects/StyledElements/Titles/TypeOfContentTitle'
import PathThumbnail from '@components/Objects/Thumbnails/PathThumbnail'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import FeatureGate from '@components/Dashboard/Shared/FeatureGate/FeatureGate'
import { getUriWithOrg } from '@services/config/config'
import { searchMatchesAny } from '@/lib/search/normalize'
import { usePaths } from '@/hooks/queries/usePaths'

export default function PathsClient({ orgslug, org_id }: { orgslug: string; org_id: number }) {
  const { t } = useTranslation()
  const { data, isLoading } = usePaths(org_id)
  const [searchQuery, setSearchQuery] = useState('')

  // The learner catalog only lists published paths, even for authors.
  const paths = useMemo(() => (data || []).filter((p) => p.published), [data])
  const filtered = useMemo(
    () => (searchQuery.trim() ? paths.filter((p) => searchMatchesAny([p.name, p.description], searchQuery)) : paths),
    [paths, searchQuery]
  )
  const following = filtered.filter((p) => p.progress?.enrolled && !p.progress.completed)
  const others = filtered.filter((p) => !(p.progress?.enrolled && !p.progress.completed))

  return (
    <FeatureGate feature="paths" orgslug={orgslug} context="public">
      <div className="w-full">
        <GeneralWrapperStyled>
          <div className="flex items-center justify-between">
            <TypeOfContentTitle title={t('paths.title')} type="path" />
            <AuthenticatedClientElement checkMethod="roles" action="create" ressourceType="courses" orgId={org_id}>
              <Link
                href={getUriWithOrg(orgslug, '/dash/paths')}
                className="text-xs font-bold text-gray-500 hover:text-gray-900 transition-colors"
              >
                {t('paths.manage_paths')} &rarr;
              </Link>
            </AuthenticatedClientElement>
          </div>
          <p className="text-sm text-gray-500 -mt-2 mb-4 max-w-2xl">{t('paths.catalog_subtitle')}</p>

          {paths.length > 0 && (
            <div className="relative w-full sm:w-80 mb-6">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label={t('paths.search_placeholder')}
                placeholder={t('paths.search_placeholder')}
                className="w-full ps-10 pe-10 py-2.5 bg-white nice-shadow rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-2 border-0"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  aria-label={t('paths.clear_search')}
                  className="absolute end-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )}

          {following.length > 0 && (
            <section className="mb-8">
              <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">{t('paths.continue_learning')}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {following.map((path) => (
                  <PathThumbnail key={path.path_uuid} path={path} orgslug={orgslug} />
                ))}
              </div>
            </section>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {isLoading &&
              [1, 2, 3, 4].map((i) => (
                <div key={i} className="bg-white rounded-xl nice-shadow overflow-hidden animate-pulse">
                  <div className="aspect-video bg-gray-100" />
                  <div className="p-3 space-y-2">
                    <div className="h-4 w-2/3 bg-gray-200 rounded" />
                    <div className="h-3 w-full bg-gray-100 rounded" />
                  </div>
                </div>
              ))}
            {others.map((path) => (
              <PathThumbnail key={path.path_uuid} path={path} orgslug={orgslug} />
            ))}
            {!isLoading && paths.length === 0 && (
              <div className="col-span-full flex flex-col justify-center items-center py-12 px-4 border-2 border-dashed border-gray-100 rounded-2xl bg-gray-50/30">
                <div className="p-4 bg-white rounded-full nice-shadow mb-4">
                  <Route className="w-8 h-8 text-gray-300" strokeWidth={1.5} />
                </div>
                <h1 className="text-xl font-bold text-gray-600 mb-2">{t('paths.no_public_paths')}</h1>
                <p className="text-md text-gray-400 text-center max-w-xs">{t('paths.no_public_paths_description')}</p>
              </div>
            )}
            {!isLoading && paths.length > 0 && filtered.length === 0 && (
              <div className="col-span-full flex flex-col justify-center items-center py-12 px-4">
                <Search className="w-12 h-12 text-gray-300 mb-4" />
                <h2 className="text-xl font-semibold text-gray-600">{t('paths.no_search_results')}</h2>
              </div>
            )}
          </div>
        </GeneralWrapperStyled>
      </div>
    </FeatureGate>
  )
}
