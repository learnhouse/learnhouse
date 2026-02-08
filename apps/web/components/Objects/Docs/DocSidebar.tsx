'use client'

import React, { useState, useMemo } from 'react'
import Link from 'next/link'
import { ExternalLink, ChevronRight, ChevronDown } from 'lucide-react'
import PhosphorIconRenderer from './PhosphorIconRenderer'
import { parseOpenApiSpec } from './OpenApiRenderer'

interface DocSidebarProps {
  meta: any
  spaceslug: string
  currentSectionSlug?: string
  currentPageSlug?: string
  currentSubpageSlug?: string
}

const DocSidebar = ({
  meta,
  spaceslug,
  currentSectionSlug,
  currentPageSlug,
  currentSubpageSlug,
}: DocSidebarProps) => {
  const sections = meta?.sections || []
  const currentSection = sections.find((s: any) => s.slug === currentSectionSlug)

  if (!currentSection) {
    return null
  }

  return (
    <aside className="w-[20%] flex-shrink-0 hidden lg:block">
      <nav className="sticky top-[118px] max-h-[calc(100vh-134px)] overflow-y-auto bg-white rounded-xl nice-shadow p-3">
        {/* Ungrouped pages first */}
        <div className="space-y-0.5">
          {currentSection.pages?.map((page: any) => (
            <SidebarPageLink
              key={page.docpage_uuid}
              page={page}
              spaceslug={spaceslug}
              sectionslug={currentSectionSlug!}
              isActive={page.slug === currentPageSlug && !currentSubpageSlug}
              currentSubpageSlug={currentSubpageSlug}
              currentPageSlug={currentPageSlug}
            />
          ))}
        </div>

        {/* Groups */}
        {currentSection.groups?.map((group: any) => (
          <SidebarGroup
            key={group.docgroup_uuid}
            group={group}
            spaceslug={spaceslug}
            sectionslug={currentSectionSlug!}
            currentPageSlug={currentPageSlug}
            currentSubpageSlug={currentSubpageSlug}
          />
        ))}
      </nav>
    </aside>
  )
}

const METHOD_COLORS: Record<string, string> = {
  get: 'text-green-600 bg-green-50',
  post: 'text-blue-600 bg-blue-50',
  put: 'text-orange-600 bg-orange-50',
  patch: 'text-purple-600 bg-purple-50',
  delete: 'text-red-600 bg-red-50',
}

const SidebarGroup = ({
  group,
  spaceslug,
  sectionslug,
  currentPageSlug,
  currentSubpageSlug,
}: {
  group: any
  spaceslug: string
  sectionslug: string
  currentPageSlug?: string
  currentSubpageSlug?: string
}) => {
  const isApiReference = group.group_type === 'API_REFERENCE'
  const apiConfig = group.api_config

  const parsed = useMemo(() => {
    if (!isApiReference || !apiConfig?.spec) return null
    return parseOpenApiSpec(
      apiConfig.spec,
      apiConfig.excluded_paths || [],
      apiConfig.excluded_tags || []
    )
  }, [isApiReference, apiConfig])

  // Group endpoints by tag
  const byTag = useMemo(() => {
    if (!parsed) return null
    const grouped: Record<string, { method: string; path: string; summary: string }[]> = {}
    for (const ep of parsed.endpoints) {
      for (const tag of ep.tags) {
        if (!grouped[tag]) grouped[tag] = []
        grouped[tag].push(ep)
      }
    }
    return { tags: parsed.tags, grouped }
  }, [parsed])

  return (
    <div className="mt-5">
      <div className="px-3 pb-1.5 flex items-center gap-1.5">
        {group.icon && (
          <PhosphorIconRenderer iconName={group.icon} size={12} className="text-gray-400 flex-shrink-0" />
        )}
        <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
          {group.name}
        </span>
        {isApiReference && (
          <span className="text-[9px] font-bold text-purple-500 bg-purple-50 px-1 py-0.5 rounded">
            API
          </span>
        )}
      </div>

      {/* Regular pages */}
      <div className="space-y-0.5">
        {group.pages?.map((page: any) => (
          <SidebarPageLink
            key={page.docpage_uuid}
            page={page}
            spaceslug={spaceslug}
            sectionslug={sectionslug}
            isActive={page.slug === currentPageSlug && !currentSubpageSlug}
            currentSubpageSlug={currentSubpageSlug}
            currentPageSlug={currentPageSlug}
          />
        ))}
      </div>

      {/* API Reference endpoints from spec */}
      {byTag && byTag.tags.map((tag) => (
        <SidebarApiTag
          key={tag}
          tag={tag}
          endpoints={byTag.grouped[tag] || []}
          groupPath={`/docs/${spaceslug}/${sectionslug}/api-reference/${group.docgroup_uuid}`}
        />
      ))}
    </div>
  )
}

const SidebarApiTag = ({
  tag,
  endpoints,
  groupPath,
}: {
  tag: string
  endpoints: { method: string; path: string; summary: string }[]
  groupPath: string
}) => {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="mt-2">
      <Link
        href={`${groupPath}?tag=${encodeURIComponent(tag)}`}
        onClick={(e) => {
          // Only toggle expand, don't navigate when clicking the tag header
          e.preventDefault()
          setExpanded(!expanded)
        }}
        className="w-full flex items-center gap-1.5 px-3 py-1 text-left hover:bg-gray-50 rounded-lg transition-colors"
      >
        {expanded ? <ChevronDown size={12} className="text-gray-300" /> : <ChevronRight size={12} className="text-gray-300" />}
        <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider truncate">{tag}</span>
        <span className="text-[10px] text-gray-300 ml-auto">{endpoints.length}</span>
      </Link>
      {expanded && (
        <div className="space-y-0.5 mt-0.5">
          {endpoints.map((ep, i) => (
            <Link
              key={`${ep.method}-${ep.path}-${i}`}
              href={`${groupPath}?method=${ep.method}&path=${encodeURIComponent(ep.path)}`}
              className="flex items-center gap-2 px-3 py-1.5 text-sm transition-colors rounded-lg text-gray-500 hover:bg-gray-50 hover:text-gray-700"
            >
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${METHOD_COLORS[ep.method] || 'text-gray-500 bg-gray-50'}`}>
                {ep.method.toUpperCase()}
              </span>
              <code className="text-xs font-mono truncate">{ep.path}</code>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

const SidebarPageLink = ({
  page,
  spaceslug,
  sectionslug,
  isActive,
  currentSubpageSlug,
  currentPageSlug,
}: {
  page: any
  spaceslug: string
  sectionslug: string
  isActive: boolean
  currentSubpageSlug?: string
  currentPageSlug?: string
}) => {
  const subpages = page.subpages || []
  const hasSubpages = subpages.length > 0
  const isParentOfActive = hasSubpages && page.slug === currentPageSlug
  const [expanded, setExpanded] = useState(isParentOfActive)

  // LINK pages navigate directly to the external URL
  if (page.page_type === 'LINK' && page.content?.url) {
    return (
      <a
        href={page.content.url}
        target={page.content.open_in_new_tab !== false ? '_blank' : undefined}
        rel={page.content.open_in_new_tab !== false ? 'noopener noreferrer' : undefined}
        className="flex items-center gap-2.5 px-3 py-1.5 text-sm transition-colors rounded-lg text-gray-500 hover:bg-gray-50 hover:text-gray-700"
      >
        <PhosphorIconRenderer
          iconName={page.icon}
          size={14}
          className="flex-shrink-0 text-gray-400"
        />
        <span className="truncate flex-1">{page.name}</span>
        <ExternalLink size={12} className="flex-shrink-0 text-gray-300" />
      </a>
    )
  }

  return (
    <div>
      <div className="flex items-center">
        {hasSubpages && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex-shrink-0 p-1 text-gray-300 hover:text-gray-500 transition-colors"
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        )}
        <Link
          href={`/docs/${spaceslug}/${sectionslug}/${page.slug}`}
          className={`flex items-center gap-2.5 px-3 py-1.5 text-sm transition-colors rounded-r-lg relative flex-1 ${
            isActive
              ? 'text-gray-900 font-medium bg-gray-50'
              : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
          }`}
        >
          {isActive && (
            <span className="absolute left-0 top-1 bottom-1 w-[3px] rounded-full bg-gray-900" />
          )}
          <PhosphorIconRenderer
            iconName={page.icon}
            size={14}
            className={`flex-shrink-0 ${isActive ? 'text-gray-700' : 'text-gray-400'}`}
          />
          <span className="truncate">{page.name}</span>
        </Link>
      </div>

      {/* Subpages */}
      {expanded && hasSubpages && (
        <div className="ml-6 border-l border-gray-100 space-y-0.5 mt-0.5">
          {subpages.map((sub: any) => {
            const isSubActive = isParentOfActive && sub.slug === currentSubpageSlug
            return (
              <Link
                key={sub.docpage_uuid}
                href={`/docs/${spaceslug}/${sectionslug}/${page.slug}/${sub.slug}`}
                className={`flex items-center gap-2 px-3 py-1 text-sm transition-colors rounded-r-lg relative ${
                  isSubActive
                    ? 'text-gray-900 font-medium bg-gray-50'
                    : 'text-gray-400 hover:bg-gray-50 hover:text-gray-600'
                }`}
              >
                {isSubActive && (
                  <span className="absolute left-0 top-1 bottom-1 w-[2px] rounded-full bg-gray-700" />
                )}
                <PhosphorIconRenderer
                  iconName={sub.icon}
                  size={14}
                  className={`flex-shrink-0 ${isSubActive ? 'text-gray-600' : 'text-gray-300'}`}
                />
                <span className="truncate text-[13px]">{sub.name}</span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default DocSidebar
