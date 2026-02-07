'use client'

import React from 'react'
import DocOrgMenu from './DocOrgMenu'
import DocSidebar from './DocSidebar'
import { usePathname } from 'next/navigation'

interface DocSpaceLayoutClientProps {
  meta: any
  spaceslug: string
  orgslug: string
  children: React.ReactNode
}

const DocSpaceLayoutClient = ({
  meta,
  spaceslug,
  orgslug,
  children,
}: DocSpaceLayoutClientProps) => {
  const pathname = usePathname()

  if (!meta) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center text-gray-400">
          <p className="text-lg font-medium">Documentation not found</p>
          <p className="text-sm mt-1">This documentation space doesn&apos;t exist or you don&apos;t have access.</p>
        </div>
      </div>
    )
  }

  // Extract current section slug from pathname
  const pathParts = pathname.split('/')
  const docsIndex = pathParts.indexOf('docs')
  const currentSectionSlug = docsIndex >= 0 ? pathParts[docsIndex + 2] : undefined
  const currentPageSlug = docsIndex >= 0 ? pathParts[docsIndex + 3] : undefined
  const currentSubpageSlug = docsIndex >= 0 ? pathParts[docsIndex + 4] : undefined

  return (
    <div className="w-full">
      <DocOrgMenu
        meta={meta}
        spaceslug={spaceslug}
        orgslug={orgslug}
        currentSectionSlug={currentSectionSlug}
      />
      <div className="w-full max-w-(--breakpoint-2xl) mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex gap-8 py-6">
          <DocSidebar
            meta={meta}
            spaceslug={spaceslug}
            currentSectionSlug={currentSectionSlug}
            currentPageSlug={currentPageSlug}
            currentSubpageSlug={currentSubpageSlug}
          />
          <main className="flex-1 min-w-0">
            {children}
          </main>
        </div>
      </div>
    </div>
  )
}

export default DocSpaceLayoutClient
