import { ERROR_CATALOG, UNKNOWN_CATEGORY } from './catalog'
import type { ClassifiedError } from './types'

// Turn whatever we were handed (an Error, a thrown backend payload, a fetch
// Response, a plain string) into a meaningful ClassifiedError by matching it
// against the catalog. Deterministic: walks ERROR_CATALOG in order and the
// first category whose status/name/message matches wins; falls back to the
// UNKNOWN catch-all.

function extractStatus(error: any): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const candidates = [error.status, error.statusCode, error.code, error.response?.status]
  for (const c of candidates) {
    const n = typeof c === 'string' ? parseInt(c, 10) : c
    if (typeof n === 'number' && n >= 100 && n < 600) return n
  }
  return undefined
}

function extractMessage(error: any): string {
  if (error == null) return ''
  if (typeof error === 'string') return error
  // FastAPI shape: { detail: string | [{ msg }] }
  const detail = error.detail ?? error.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail) && detail[0]?.msg) return String(detail[0].msg)
  if (typeof error.message === 'string') return error.message
  if (typeof error.error === 'string') return error.error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function extractName(error: any): string {
  if (error && typeof error === 'object' && typeof error.name === 'string') return error.name
  return ''
}

function extractDigest(error: any): string | undefined {
  if (error && typeof error === 'object' && typeof error.digest === 'string') return error.digest
  return undefined
}

export function classifyError(error: unknown): ClassifiedError {
  const status = extractStatus(error)
  const rawMessage = extractMessage(error)
  const message = rawMessage.toLowerCase()
  const name = extractName(error)
  const digest = extractDigest(error)

  for (const category of ERROR_CATALOG) {
    const m = category.matchers
    const statusHit = status !== undefined && m.statuses.includes(status)
    const nameHit = name !== '' && m.names.some((n) => name === n || name.includes(n))
    const messageHit = message !== '' && m.messageIncludes.some((s) => message.includes(s))
    if (statusHit || nameHit || messageHit) {
      return { category, detail: rawMessage || undefined, status, digest }
    }
  }

  return { category: UNKNOWN_CATEGORY, detail: rawMessage || undefined, status, digest }
}

/** Convenience: just the human title for a quick inline message. */
export function meaningfulMessage(error: unknown): string {
  return classifyError(error).category.title
}
