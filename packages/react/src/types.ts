import type { ComponentType, CSSProperties, ReactNode } from 'react'
import type { LearnHouseClient } from '@learnhouse/sdk'
import type { GetLearnHouseSession, LearnHouseSessionInput } from '@learnhouse/sdk'

export type { GetLearnHouseSession, LearnHouseSessionInput }

/** A TipTap / ProseMirror JSON document, as stored in a LearnHouse dynamic activity. */
export interface ActivityDocument {
  type: string
  attrs?: Record<string, any>
  content?: ActivityDocument[]
  marks?: { type: string; attrs?: Record<string, any> }[]
  text?: string
}

/** The activity object returned by the LearnHouse API. */
export interface LearnHouseActivityData {
  activity_uuid: string
  name: string
  activity_type: string
  activity_sub_type?: string
  content: any
  published?: boolean
  [key: string]: any
}

export type ThemeMode = 'light' | 'dark' | 'auto'

export interface LearnHouseTheme {
  mode?: ThemeMode
  /** Links, focus rings and interactive accents. */
  accent?: string
  background?: string
  text?: string
  mutedText?: string
  border?: string
  fontFamily?: string
  headingFontFamily?: string
  codeFontFamily?: string
  /** Base font size, e.g. `16px` or `1rem`. Numbers are pixels. */
  fontSize?: string | number
  /** Corner radius of blocks (callouts, quizzes, images). Numbers are pixels. */
  radius?: string | number
  /** Max width of the content column. Numbers are pixels. `none` for full width. */
  contentWidth?: string | number
  /** Padding around the content. Numbers are pixels. */
  padding?: string | number
  /** Any extra CSS custom properties, set on the root element. */
  cssVariables?: Record<string, string>
}

export type LearnHouseEvent =
  | { type: 'load'; activity: LearnHouseActivityData }
  | { type: 'ready' }
  | { type: 'error'; error: Error }
  | { type: 'link_click'; href: string; external: boolean }
  | { type: 'media'; action: 'play' | 'pause' | 'ended' | 'progress'; media: 'video' | 'audio'; src: string; currentTime: number; duration: number }
  | { type: 'resize'; width: number; height: number }
  | { type: 'visible'; ratio: number }
  | { type: 'complete'; activityId?: string }
  /** The learner's completion of the activity changed (saved to their LearnHouse progress). */
  | { type: 'progress'; activityId: string; completed: boolean }
  /** The session ran out and no new one could be fetched; the components act signed out. */
  | { type: 'session_expired' }
  | { type: 'analytics'; name: string; surface?: string; [key: string]: unknown }

/** Props passed to a block override in `components`. `Default` renders the built-in block. */
export interface BlockOverrideProps {
  node: { type: { name: string }; attrs: Record<string, any>; textContent: string; toJSON(): ActivityDocument }
  attrs: Record<string, any>
  parent?: unknown
  children?: ReactNode
  Default: ComponentType<any>
}

export interface MarkOverrideProps {
  mark: { type: { name: string }; attrs: Record<string, any> }
  attrs: Record<string, any>
  children?: ReactNode
}

export interface LearnHouseActivityProps {
  // ── What to render (pick one) ──────────────────────────────────────────
  /** Activity uuid (`activity_…`). Fetched from the instance. */
  activityId?: string
  /** Look an activity up by its name inside `courseId` (case-insensitive). */
  activityName?: string
  /** Course uuid; needed with `activityName`, and gives media blocks their course. */
  courseId?: string
  /** An activity object you already fetched (e.g. server-side with @learnhouse/sdk). */
  activity?: LearnHouseActivityData
  /** A raw document to render, no network involved. */
  content?: ActivityDocument | string

  // ── Where from (defaults to the nearest LearnHouseProvider) ────────────
  /** Base URL of the LearnHouse instance, e.g. `https://learn.acme.com`. */
  baseUrl?: string
  /**
   * The learner session (an embed session minted on your server), used when
   * rendering without a provider. Never pass an `lh_` API token to the browser.
   */
  session?: LearnHouseSessionInput | null
  /** Fetches a new learner session from your server; called before the current one expires. */
  getSession?: GetLearnHouseSession
  /** @deprecated Use `session`. A user access token. */
  token?: string
  /** Org uuid for media URLs when rendering `content` without fetching. */
  orgId?: string
  /** Address of the LearnHouse site (not the API), used to link back to the activity. */
  siteUrl?: string

  // ── Look ───────────────────────────────────────────────────────────────
  theme?: LearnHouseTheme
  className?: string
  style?: CSSProperties
  /** Skip the root theming styles (keep only block markup + your own CSS). */
  unstyled?: boolean
  /** Show the activity name above the content. */
  showTitle?: boolean
  /** Rendered above the content; gets the loaded activity. */
  header?: ReactNode | ((activity: LearnHouseActivityData) => ReactNode)
  /** Rendered below the content; gets the loaded activity. */
  footer?: ReactNode | ((activity: LearnHouseActivityData) => ReactNode)
  /** Small "made with LearnHouse" link to the activity. Off by default. */
  showPoweredBy?: boolean

  // ── Content control ────────────────────────────────────────────────────
  /** Replace or wrap any block by node name (`blockQuiz`, `calloutInfo`, `heading`, `image`…). */
  components?: Record<string, ComponentType<BlockOverrideProps>>
  /** Replace any mark by name (`link`, `bold`, `code`…). */
  marks?: Record<string, ComponentType<MarkOverrideProps>>
  /** Node names to drop from the output. */
  hideBlocks?: string[]
  /** Rewrite the document before rendering (filter, annotate, inject). */
  transformContent?: (doc: ActivityDocument) => ActivityDocument

  // ── Behaviour ──────────────────────────────────────────────────────────
  /** Where links open. Default `_blank`. */
  linkTarget?: '_blank' | '_self' | '_parent' | '_top'
  /** Intercept link clicks. Return `false` to stop the navigation. */
  onLinkClick?: (href: string, event: MouseEvent) => boolean | void
  /** Fire `complete` when the end of the activity scrolls into view. */
  trackCompletion?: boolean
  /**
   * How a signed-in learner completes the activity (saved to their progress):
   * `button` shows a "Mark as complete" toggle (default with a session),
   * `scroll` marks it complete when the end scrolls into view, `none` leaves
   * it to you. Assignments complete by being submitted. Ignored without a session.
   */
  completion?: 'button' | 'scroll' | 'none'

  // ── Language ───────────────────────────────────────────────────────────
  /** UI language of the blocks (`en`, `fr`, `ar`…). Defaults to the provider's, then `en`. */
  locale?: string
  /** Override UI strings, keyed like LearnHouse's locale files (`editor.blocks.quiz.check`…). */
  messages?: Record<string, any>
  /** Text direction. `auto` follows the locale. */
  dir?: 'ltr' | 'rtl' | 'auto'

  // ── States & callbacks ────────────────────────────────────────────────
  /** Shown while fetching or loading block code. */
  fallback?: ReactNode
  /** Shown when the activity can't be loaded or rendered. */
  errorFallback?: ReactNode | ((error: Error, retry: () => void) => ReactNode)
  onLoad?: (activity: LearnHouseActivityData) => void
  onError?: (error: Error) => void
  /** Every event the renderer emits (see LearnHouseEvent). */
  onEvent?: (event: LearnHouseEvent) => void
}

export interface LearnHouseProviderProps {
  /** Address of the LearnHouse site (not the API), used to link back to activities. */
  siteUrl?: string
  /** Base URL of the LearnHouse instance, e.g. `https://learn.acme.com`. */
  baseUrl: string
  /** Where media is served from, if not the instance itself (CDN, S3). */
  mediaUrl?: string
  /** Bring your own @learnhouse/sdk client (shared cache, custom fetch, hooks). */
  client?: LearnHouseClient
  /**
   * The learner session: an embed session minted on your server with
   * `client.embed.createSession()` (the object, or just its `access_token`).
   * Without one, the components are read-only and anonymous.
   */
  session?: LearnHouseSessionInput | null
  /**
   * Fetches a new learner session from your server. Called on mount when no
   * `session` is given, shortly before each session expires, and once when the
   * API answers 401.
   */
  getSession?: GetLearnHouseSession
  /** @deprecated Use `session`. A user access token. */
  token?: string
  /** @deprecated Use `getSession`. Called before every request for a user access token. */
  getToken?: () => string | null | undefined | Promise<string | null | undefined>
  /** The signed-in user, for blocks that personalise (user block, dynamic variables). */
  user?: Record<string, any>
  /** Defaults applied to every <LearnHouseActivity> below. */
  theme?: LearnHouseTheme
  locale?: string
  messages?: Record<string, any>
  linkTarget?: '_blank' | '_self' | '_parent' | '_top'
  onEvent?: (event: LearnHouseEvent) => void
  children: ReactNode
}

