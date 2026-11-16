// Pure helpers behind useSubTab (SubTabs.tsx), kept free of React and Next so
// the URL rules can be unit tested on their own.

export const SUB_TAB_PARAM = 'section'

// Which sub-tab is open. A pick just made on this page comes first (the
// caller only passes it while the URL still shows what it was made on, i.e.
// before the URL catches up), then the URL (deep links, back/forward), then
// the one remembered from the last visit, then the default. Anything that is
// not one of the page's keys (a stale link, a tab hidden on this plan) is
// skipped.
export function resolveSubTab<K extends string>({
  urlValue,
  local,
  stored,
  defaultKey,
  keys,
}: {
  urlValue: string | null | undefined
  local?: string | null
  stored?: string | null
  defaultKey: K
  keys: readonly K[]
}): K {
  for (const candidate of [local, urlValue, stored]) {
    if (candidate && (keys as readonly string[]).includes(candidate)) return candidate as K
  }
  if (keys.includes(defaultKey) || keys.length === 0) return defaultKey
  return keys[0]
}

// The search string to write when `value` is picked. The default sub-tab
// drops the param so plain links stay clean; every other param is kept.
// Returns the string with its leading "?" (or "" when nothing is left).
export function buildSubTabSearch(currentSearch: string, param: string, value: string, defaultKey: string): string {
  const params = new URLSearchParams(currentSearch.startsWith('?') ? currentSearch.slice(1) : currentSearch)
  if (value === defaultKey) params.delete(param)
  else params.set(param, value)
  const next = params.toString()
  return next ? `?${next}` : ''
}

// Storage key for "last sub-tab opened on this page".
export function subTabStorageKey(page: string, param: string = SUB_TAB_PARAM): string {
  return `lh:subtab:${page}:${param}`
}
