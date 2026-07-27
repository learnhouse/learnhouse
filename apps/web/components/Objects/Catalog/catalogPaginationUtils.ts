export const CATALOG_PAGE_SIZE = 12

export type CatalogPageNumber = number | '...'

export function getCatalogPageNumbers(
  currentPage: number,
  totalPages: number
): CatalogPageNumber[] {
  const pages: CatalogPageNumber[] = []
  const maxVisiblePages = 5

  if (totalPages <= 0) {
    return pages
  }

  if (totalPages <= maxVisiblePages) {
    for (let page = 1; page <= totalPages; page++) pages.push(page)
    return pages
  }

  if (currentPage <= 3) {
    for (let page = 1; page <= 4; page++) pages.push(page)
    pages.push('...', totalPages)
    return pages
  }

  if (currentPage >= totalPages - 2) {
    pages.push(1, '...')
    for (let page = totalPages - 3; page <= totalPages; page++) {
      pages.push(page)
    }
    return pages
  }

  pages.push(1, '...')
  for (let page = currentPage - 1; page <= currentPage + 1; page++) {
    pages.push(page)
  }
  pages.push('...', totalPages)

  return pages
}
