'use client'

import React, { useMemo, lazy, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Layers } from 'lucide-react'
import { parseOpenApiSpec } from './OpenApiRenderer'
import SingleEndpointView from './SingleEndpointView'

const OpenApiRenderer = lazy(() => import('./OpenApiRenderer'))

interface ApiGroup {
  name: string
  uuid: string
  apiConfig: any
}

interface ApiReferenceViewProps {
  apiGroups: ApiGroup[]
  activeGroupId: string | null
  spaceslug: string
  sectionslug: string
  /** Show only this tag's endpoints (server-side fallback) */
  activeTag?: string | null
  /** Show single endpoint: method (server-side fallback) */
  endpointMethod?: string | null
  /** Show single endpoint: path (server-side fallback) */
  endpointPath?: string | null
}

const ApiReferenceView = ({
  apiGroups,
  activeGroupId,
  spaceslug,
  sectionslug,
}: ApiReferenceViewProps) => {
  // Read searchParams directly on the client so client-side <Link> navigations work
  const searchParams = useSearchParams()
  const activeTag = searchParams.get('tag') || null
  const endpointMethod = searchParams.get('method') || null
  const endpointPath = searchParams.get('path') || null

  const basePath = `/docs/${spaceslug}/${sectionslug}/api-reference`
  const isAll = activeGroupId === null
  const activeGroup = activeGroupId
    ? apiGroups.find((g) => g.uuid === activeGroupId)
    : null

  const isSingleEndpoint = !!(endpointMethod && endpointPath && activeGroup)

  // Parse tags for the active group (for tag sub-tabs)
  const groupTags = useMemo(() => {
    if (!activeGroup) return []
    const config = activeGroup.apiConfig
    const { tags } = parseOpenApiSpec(
      config.spec,
      config.excluded_paths || [],
      config.excluded_tags || []
    )
    return tags
  }, [activeGroup])

  // Single endpoint view
  if (isSingleEndpoint && activeGroup) {
    return (
      <SingleEndpointView
        apiConfig={activeGroup.apiConfig}
        method={endpointMethod!}
        path={endpointPath!}
        backHref={`${basePath}/${activeGroup.uuid}`}
      />
    )
  }

  return (
    <article className="w-full space-y-4">
      {/* Top bar: group selector */}
      <div className="bg-white rounded-xl nice-shadow p-2">
        <div className="flex items-center gap-1 overflow-x-auto">
          <Link
            href={basePath}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-colors flex-shrink-0 ${
              isAll
                ? 'bg-gray-900 text-white'
                : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
            }`}
          >
            <Layers size={14} />
            All
          </Link>
          {apiGroups.map((group) => (
            <Link
              key={group.uuid}
              href={`${basePath}/${group.uuid}`}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors flex-shrink-0 ${
                activeGroupId === group.uuid
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
              }`}
            >
              {group.name}
            </Link>
          ))}
        </div>
      </div>

      {/* Tag sub-tabs (only when viewing a specific group with multiple tags) */}
      {activeGroup && groupTags.length > 1 && (
        <div className="flex items-center gap-1 px-1 overflow-x-auto">
          <Link
            href={`${basePath}/${activeGroup.uuid}`}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex-shrink-0 ${
              !activeTag
                ? 'bg-gray-800 text-white'
                : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
            }`}
          >
            All endpoints
          </Link>
          {groupTags.map((tag) => (
            <Link
              key={tag}
              href={`${basePath}/${activeGroup.uuid}?tag=${encodeURIComponent(tag)}`}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex-shrink-0 ${
                activeTag === tag
                  ? 'bg-gray-800 text-white'
                  : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
              }`}
            >
              {tag}
            </Link>
          ))}
        </div>
      )}

      {/* Content */}
      {isAll ? (
        apiGroups.map((group) => (
          <div key={group.uuid}>
            <div className="flex items-center justify-between mb-3 px-1">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-gray-900">{group.name}</h2>
                <span className="text-[9px] font-bold text-purple-500 bg-purple-50 px-1.5 py-0.5 rounded">
                  API
                </span>
              </div>
              <Link
                href={`${basePath}/${group.uuid}`}
                className="text-xs font-medium text-gray-400 hover:text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
              >
                View &rarr;
              </Link>
            </div>
            <div className="bg-white rounded-xl nice-shadow p-6 sm:p-8">
              <Suspense fallback={<div className="text-gray-400 py-8 text-center">Loading...</div>}>
                <OpenApiRenderer apiConfig={group.apiConfig} defaultCollapsed />
              </Suspense>
            </div>
          </div>
        ))
      ) : activeGroup ? (
        <div className="bg-white rounded-xl nice-shadow p-6 sm:p-8">
          <Suspense fallback={<div className="text-gray-400 py-8 text-center">Loading...</div>}>
            <OpenApiRenderer apiConfig={activeGroup.apiConfig} filterTag={activeTag || undefined} />
          </Suspense>
        </div>
      ) : (
        <div className="flex items-center justify-center min-h-[300px]">
          <div className="text-center text-gray-400">
            <p className="text-lg font-medium">API reference not found</p>
          </div>
        </div>
      )}
    </article>
  )
}

export default ApiReferenceView
