// FastAPI returns error `detail` in several shapes:
//   - string:                    HTTPException(status, detail="msg")
//   - array of {loc,msg,type}:   422 request validation (Pydantic)
//   - object {code,message,...}: custom structured errors (e.g. WEAK_PASSWORD)
// Passing a non-string into React state that later renders as a child throws
// "Objects are not valid as a React child" and crashes the page. Always funnel
// backend `detail` through this to get a safe display string.
export function getErrorMessage(detail: unknown, fallback: string): string {
  if (typeof detail === 'string' && detail.trim()) return detail
  if (Array.isArray(detail)) {
    const msgs = detail
      .map((e) => (e && typeof e === 'object' && 'msg' in e ? (e as any).msg : typeof e === 'string' ? e : null))
      .filter((m): m is string => typeof m === 'string' && m.length > 0)
    if (msgs.length) return msgs.join(', ')
  }
  if (detail && typeof detail === 'object') {
    const m = (detail as any).message ?? (detail as any).msg
    if (typeof m === 'string' && m.trim()) return m
  }
  return fallback
}
