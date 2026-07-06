// Shared types for the meaningful-error system. The classification CATALOG
// (lib/errors/catalog.ts) maps a raw error / HTTP failure to one of these
// categories so the UI can show a specific, reassuring message + the right
// recovery actions instead of a generic "Something went wrong".

export type ResolutionKind =
  | 'retry'
  | 'home'
  | 'signout'
  | 'login'
  | 'report'
  | 'wait'
  | 'reload'
  | 'contact_support'

export interface ErrorMatchers {
  /** HTTP status codes that map to this category. */
  statuses: number[]
  /** Lowercase substrings matched against the error message. */
  messageIncludes: string[]
  /** Error class/name matches, e.g. "ChunkLoadError", "TypeError". */
  names: string[]
}

export interface ErrorCategory {
  /** snake_case id, e.g. "auth_session", "network", "server". */
  kind: string
  /** Short, human, non-alarming headline. */
  title: string
  /** 1-2 plain sentences: what likely happened + reassurance. */
  description: string
  matchers: ErrorMatchers
  /** Ordered recovery actions, most relevant first. */
  resolutions: ResolutionKind[]
}

/** Anything we might be handed: an Error, a fetch Response-ish, a string, etc. */
export interface ErrorLike {
  message?: string
  name?: string
  status?: number
  statusCode?: number
  digest?: string
  cause?: unknown
}

export interface ClassifiedError {
  category: ErrorCategory
  /** The detail string we managed to extract (backend "detail", message…). */
  detail?: string
  /** HTTP status if we found one. */
  status?: number
  /** Next.js error digest, if present. */
  digest?: string
}
