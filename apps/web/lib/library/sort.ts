import type { FolderSortMode } from '@components/Dashboard/Library/FolderSortDropdown'

/*
 The library sort comparator, shared by the dashboard views and the public
 learner views so both render a folder's subfolders and content in the exact
 same order the org's sort_mode describes. Framework-free on purpose: no React,
 no i18n, nothing but the arrays it is handed.
*/

// Name/date accessors that work for both folders and content items (courses,
// media, …). Items carry their display fields under `.resource`.
export const _nameOf = (x: any) =>
  (x?.name ?? x?.resource?.name ?? x?.resource?.title ?? x?.title ?? '').toString().toLowerCase()
// 'newest'/'oldest' mean CREATION date, the same field the API sorts folders by
// (Folder.creation_date) and items by (_item_date in services/folders/folders.py).
// `update_date` is only a last resort: an item has no top-level date fields, so
// preferring it would silently re-sort every edited course away from the API order.
export const _dateOf = (x: any) => {
  const raw =
    x?.creation_date ?? x?.created_at ??
    x?.resource?.creation_date ?? x?.resource?.created_at ??
    x?.update_date ?? x?.resource?.update_date ?? ''
  const t = raw ? Date.parse(raw) : NaN
  return Number.isNaN(t) ? 0 : t
}

/**
 * Apply the selected sort mode to the visible library content, CLIENT-SIDE, so
 * it reorders folders AND items (courses/media) instantly and consistently.
 *
 * 'manual' is intentionally a no-op here: folders already arrive ordered by their
 * persisted `order` from the server, and drag-reordering mutates the array in
 * place — re-sorting by the (optimistically stale) `order` field would fight the
 * drag. So manual mode trusts the incoming order.
 */
export function sortLibrary(folders: any[], items: any[], mode: FolderSortMode) {
  if (mode === 'manual') return { folders, items }
  const byName = (a: any, b: any) => _nameOf(a).localeCompare(_nameOf(b))
  const cmp = (a: any, b: any) => {
    switch (mode) {
      case 'name_desc': return byName(b, a)
      case 'newest': return _dateOf(b) - _dateOf(a) || byName(a, b)
      case 'oldest': return _dateOf(a) - _dateOf(b) || byName(a, b)
      case 'name_asc':
      default: return byName(a, b)
    }
  }
  return { folders: [...folders].sort(cmp), items: [...items].sort(cmp) }
}
