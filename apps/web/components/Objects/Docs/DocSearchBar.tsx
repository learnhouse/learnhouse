'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Search, FileText, Command } from 'lucide-react'
import { searchDocPages } from '@services/docs/docspaces'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import Link from 'next/link'

interface DocSearchBarProps {
  docspaceUuid: string
  spaceslug: string
  onClose?: () => void
  inline?: boolean
}

const DocSearchBar = ({ docspaceUuid, spaceslug, onClose, inline }: DocSearchBarProps) => {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const search = useCallback(
    async (q: string) => {
      if (q.length < 2) {
        setResults([])
        return
      }
      setIsSearching(true)
      try {
        const res = await searchDocPages(
          docspaceUuid,
          q,
          1,
          10,
          { revalidate: 0 },
          access_token
        )
        setResults(res || [])
      } catch {
        setResults([])
      } finally {
        setIsSearching(false)
      }
    },
    [docspaceUuid, access_token]
  )

  useEffect(() => {
    const timeout = setTimeout(() => {
      search(query)
    }, 300)
    return () => clearTimeout(timeout)
  }, [query, search])

  // Cmd+K shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setDialogOpen(true)
      }
      if (e.key === 'Escape' && dialogOpen) {
        closeDialog()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [dialogOpen])

  // Focus input when dialog opens
  useEffect(() => {
    if (dialogOpen) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [dialogOpen])

  const closeDialog = () => {
    setDialogOpen(false)
    setQuery('')
    setResults([])
    onClose?.()
  }

  // Inline trigger mode: styled like OrgMenu SearchBar
  if (inline) {
    return (
      <>
        <button
          onClick={() => setDialogOpen(true)}
          className="relative group w-full max-w-sm"
        >
          <div
            className="w-full h-9 pl-11 pr-4 rounded-xl bg-white text-black/40 nice-shadow
                       flex items-center text-sm transition-all
                       focus-within:ring-1 focus-within:ring-black/5 focus-within:border-black/20"
          >
            <span>Search docs...</span>
            <kbd className="hidden sm:inline-flex items-center gap-0.5 ml-auto px-1.5 py-0.5 text-[10px] font-medium text-black/30 bg-black/[0.03] rounded border border-black/[0.06]">
              <Command size={10} />K
            </kbd>
          </div>
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
            <Search className="text-black/40 group-hover:text-black/60 transition-colors" size={18} />
          </div>
        </button>

        {dialogOpen &&
          createPortal(
            <SearchDialog
              query={query}
              setQuery={setQuery}
              results={results}
              isSearching={isSearching}
              spaceslug={spaceslug}
              onClose={closeDialog}
              inputRef={inputRef}
            />,
            document.body
          )}
      </>
    )
  }

  // Fallback: original dropdown mode
  return (
    <div className="relative">
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search documentation..."
          className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-1"
          autoFocus
        />
      </div>

      {(results.length > 0 || (query.length >= 2 && !isSearching)) && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg z-20 max-h-64 overflow-y-auto">
          {results.length === 0 && !isSearching ? (
            <div className="px-4 py-3 text-sm text-gray-400 text-center">
              No results found
            </div>
          ) : (
            results.map((page: any) => (
              <Link
                key={page.docpage_uuid}
                href={`/docs/${spaceslug}/${page.section_slug}/${page.slug}`}
                onClick={onClose}
                className="flex items-center gap-2 px-4 py-2.5 hover:bg-gray-50 text-sm text-gray-700 border-b last:border-b-0"
              >
                <FileText size={14} className="text-gray-400 flex-shrink-0" />
                <span className="truncate">{page.name}</span>
                <span className="text-[10px] text-gray-400 ml-auto flex-shrink-0">
                  {page.page_type}
                </span>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  )
}

const SearchDialog = ({
  query,
  setQuery,
  results,
  isSearching,
  spaceslug,
  onClose,
  inputRef,
}: {
  query: string
  setQuery: (q: string) => void
  results: any[]
  isSearching: boolean
  spaceslug: string
  onClose: () => void
  inputRef: React.RefObject<HTMLInputElement | null>
}) => {
  return (
    <div className="fixed inset-0 flex items-start justify-center pt-[20vh]" style={{ zIndex: 100 }}>
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative w-full max-w-lg mx-4 bg-white rounded-xl shadow-2xl border overflow-hidden">
        <div className="flex items-center gap-3 px-4 border-b">
          <Search size={16} className="text-gray-400 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search documentation..."
            className="flex-1 py-3.5 text-sm focus:outline-none"
          />
          <kbd className="text-[10px] font-medium text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">
            ESC
          </kbd>
        </div>

        <div className="max-h-72 overflow-y-auto">
          {query.length < 2 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              Type to search...
            </div>
          ) : isSearching ? (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              Searching...
            </div>
          ) : results.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              No results found
            </div>
          ) : (
            results.map((page: any) => (
              <Link
                key={page.docpage_uuid}
                href={`/docs/${spaceslug}/${page.section_slug}/${page.slug}`}
                onClick={onClose}
                className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-sm text-gray-700 border-b last:border-b-0 transition-colors"
              >
                <FileText size={14} className="text-gray-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="truncate block">{page.name}</span>
                </div>
                <span className="text-[10px] text-gray-400 flex-shrink-0 uppercase">
                  {page.page_type}
                </span>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export default DocSearchBar
