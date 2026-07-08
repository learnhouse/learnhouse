'use client'

import React, { useCallback, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  CATALOG_PAGE_SIZE,
  CatalogPageNumber,
  getCatalogPageNumbers,
} from './catalogPagination'

const paginationWrapperClassName = 'flex items-center justify-center gap-2'
const paginationNavButtonClassName =
  'flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-600 bg-white nice-shadow rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
const paginationPagesClassName = 'flex items-center gap-1'
const paginationEllipsisClassName = 'px-2 py-1 text-gray-400'
const paginationPageButtonBaseClassName =
  'px-3 py-2 text-sm font-medium rounded-lg transition-colors'
const paginationActivePageButtonClassName = 'bg-black text-white'
const paginationInactivePageButtonClassName =
  'bg-white text-gray-600 nice-shadow hover:bg-gray-50'

type CatalogPaginationProps = {
  currentPage: number
  totalPages: number
  pageNumbers: CatalogPageNumber[]
  onPageChange: (_page: number) => void
  previousLabel: string
  nextLabel: string
  className?: string
}

export function useCatalogPagination<T>(
  items: T[],
  pageSize = CATALOG_PAGE_SIZE
) {
  const [currentPage, setCurrentPage] = useState(1)
  const totalPages = Math.ceil(items.length / pageSize)
  const visibleCurrentPage = totalPages > 0 ? Math.min(currentPage, totalPages) : 1

  const paginatedItems = useMemo(() => {
    const startIndex = (visibleCurrentPage - 1) * pageSize
    return items.slice(startIndex, startIndex + pageSize)
  }, [items, visibleCurrentPage, pageSize])

  const pageNumbers = useMemo(
    () => getCatalogPageNumbers(visibleCurrentPage, totalPages),
    [visibleCurrentPage, totalPages]
  )

  const goToPage = useCallback((page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page)
    }
  }, [totalPages])

  const resetPage = useCallback(() => {
    setCurrentPage(1)
  }, [])

  return {
    currentPage: visibleCurrentPage,
    totalPages,
    paginatedItems,
    pageNumbers,
    goToPage,
    resetPage,
  }
}

export default function CatalogPagination({
  currentPage,
  totalPages,
  pageNumbers,
  onPageChange,
  previousLabel,
  nextLabel,
  className,
}: CatalogPaginationProps) {
  if (totalPages <= 1) {
    return null
  }

  const wrapperClassName = [className, paginationWrapperClassName]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={wrapperClassName}>
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className={paginationNavButtonClassName}
      >
        <ChevronLeft className="w-4 h-4" />
        <span className="hidden sm:inline">{previousLabel}</span>
      </button>

      <div className={paginationPagesClassName}>
        {pageNumbers.map((page, index) => (
          <React.Fragment key={`${page}-${index}`}>
            {page === '...' ? (
              <span className={paginationEllipsisClassName}>...</span>
            ) : (
              <button
                onClick={() => onPageChange(page)}
                className={`${paginationPageButtonBaseClassName} ${
                  currentPage === page
                    ? paginationActivePageButtonClassName
                    : paginationInactivePageButtonClassName
                }`}
              >
                {page}
              </button>
            )}
          </React.Fragment>
        ))}
      </div>

      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className={paginationNavButtonClassName}
      >
        <span className="hidden sm:inline">{nextLabel}</span>
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  )
}
