'use client'

import React from 'react'
import Link from 'next/link'
import { FileText, Globe, Lock } from 'lucide-react'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'

interface DocsLandingClientProps {
  orgslug: string
  docspaces: any[]
}

const DocsLandingClient = ({ orgslug, docspaces }: DocsLandingClientProps) => {
  return (
    <div className="w-full">
      <GeneralWrapperStyled>
        <div className="flex flex-col space-y-2 mb-2">
          <div className="flex items-center gap-3 mb-4">
            <FileText size={28} className="text-gray-600" />
            <h1 className="text-3xl font-bold">Documentation</h1>
          </div>

          {docspaces.length === 0 ? (
            <div className="flex flex-col justify-center items-center py-12 px-4 border-2 border-dashed border-gray-100 rounded-2xl bg-gray-50/30">
              <div className="p-4 bg-white rounded-full nice-shadow mb-4">
                <FileText className="w-8 h-8 text-gray-300" strokeWidth={1.5} />
              </div>
              <h2 className="text-xl font-bold text-gray-600 mb-2">No documentation available</h2>
              <p className="text-md text-gray-400 text-center max-w-xs">
                Documentation hasn&apos;t been published yet. Check back later.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {docspaces.map((ds: any) => (
                <Link
                  key={ds.docspace_uuid}
                  href={`/docs/${ds.slug}`}
                  className="bg-white rounded-xl nice-shadow p-5 hover:shadow-md transition-shadow group"
                >
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-gray-800 group-hover:text-black truncate">
                      {ds.name}
                    </h3>
                    {ds.public ? (
                      <Globe size={14} className="text-green-500 flex-shrink-0" />
                    ) : (
                      <Lock size={14} className="text-gray-400 flex-shrink-0" />
                    )}
                  </div>
                  <p className="text-sm text-gray-500 line-clamp-2">
                    {ds.description || 'No description'}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>
      </GeneralWrapperStyled>
    </div>
  )
}

export default DocsLandingClient
