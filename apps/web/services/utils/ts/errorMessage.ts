// Minimal translate signature, so this module doesn't depend on react-i18next.
export type Translate = (key: string, options?: Record<string, unknown>) => string

// API error codes the web phrases itself, mapped to their i18n keys.
const ERROR_CODE_KEYS: Record<string, string> = {
  PROFILE_FIELD_INVALID: 'auth.errors.profile_field_invalid',
  RATE_LIMITED: 'auth.errors.rate_limited',
  WEAK_PASSWORD: 'auth.password_requirements_not_met',
}

// Labels for the field names the API reports in `invalid_fields`.
const FIELD_LABEL_KEYS: Record<string, string> = {
  username: 'user.username',
  first_name: 'user.first_name',
  last_name: 'user.last_name',
}

function errorCode(detail: unknown): string | null {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return null
  const code = (detail as any).code
  return typeof code === 'string' ? code : null
}

function invalidFields(detail: unknown): string[] {
  const fields = detail && typeof detail === 'object' ? (detail as any).invalid_fields : null
  return Array.isArray(fields) ? fields.filter((f): f is string => typeof f === 'string' && f.length > 0) : []
}

function localizeErrorCode(detail: unknown, t: Translate): string | null {
  const code = errorCode(detail)
  const key = code ? ERROR_CODE_KEYS[code] : undefined
  if (!key) return null
  if (code === 'PROFILE_FIELD_INVALID') {
    const labels = invalidFields(detail).map((f) => (FIELD_LABEL_KEYS[f] ? t(FIELD_LABEL_KEYS[f]) : f))
    // The API always names the fields; if it ever doesn't, keep its own message.
    if (!labels.length) return null
    return t(key, { fields: labels.join(', ') })
  }
  return t(key)
}

// Per-field messages for errors that name the offending inputs, keyed by the
// form field name, so forms can highlight them next to the input.
export function getFieldErrors(detail: unknown, t: Translate): Record<string, string> {
  if (errorCode(detail) !== 'PROFILE_FIELD_INVALID') return {}
  const message = t('auth.errors.field_no_links')
  return Object.fromEntries(invalidFields(detail).map((f) => [f, message]))
}

// FastAPI returns error `detail` in several shapes:
//   - string:                    HTTPException(status, detail="msg")
//   - array of {loc,msg,type}:   422 request validation (Pydantic)
//   - object {code,message,...}: custom structured errors (e.g. WEAK_PASSWORD)
// Passing a non-string into React state that later renders as a child throws
// "Objects are not valid as a React child" and crashes the page. Always funnel
// backend `detail` through this to get a safe display string.
//
// Structured errors carry a stable `code`. Pass `t` and the codes listed in
// ERROR_CODE_KEYS come back in the user's language; any other error keeps the
// server's (English) message.
export function getErrorMessage(detail: unknown, fallback: string, t?: Translate): string {
  const localized = t ? localizeErrorCode(detail, t) : null
  if (localized) return localized
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

// A backend 403 that an upgrade (or, for a brand-new free org, waiting) would
// resolve. Detecting these lets the UI offer a contextual upgrade prompt at the
// moment of value instead of a dead-end error toast. Covers:
//   - "Usage Limit has been reached for {Feature}": plan quota hit
//   - "{Feature} is not enabled for this organization": feature gated to a
//     higher plan
//   - { code: "ACCOUNT_TOO_NEW" }: free-tier age gate (upgrading lifts it)
export function isPlanLimitError(detail: unknown): boolean {
  if (typeof detail === 'string') {
    return (
      /Usage Limit has been reached/i.test(detail) ||
      /is not enabled for this organization/i.test(detail)
    )
  }
  if (detail && typeof detail === 'object') {
    return (detail as any).code === 'ACCOUNT_TOO_NEW'
  }
  return false
}
