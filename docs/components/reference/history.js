/**
 * Playground request history, shared by the (lazy) Playground and the nav.
 * Kept in its own tiny module so the nav never pulls the Playground chunk in.
 */
export const HISTORY_STORAGE_KEY = 'lh:ref-history'
export const HISTORY_EVENT = 'lh-ref-history'
export const HISTORY_LIMIT = 12

export function readHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) || '[]')
  } catch {
    return []
  }
}

export function pushHistory(entry) {
  try {
    const history = readHistory()
    history.unshift(entry)
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history.slice(0, HISTORY_LIMIT)))
    window.dispatchEvent(new CustomEvent(HISTORY_EVENT))
  } catch {}
}
