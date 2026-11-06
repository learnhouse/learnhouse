// Types-only entry for dist/element.d.ts (the runtime entry is element.tsx,
// which bundles web source). tests/exports.test.ts keeps both in sync.
import type { LearnHouseClient } from '@learnhouse/sdk'
import type {
  ActivityDocument,
  LearnHouseActivityData,
  LearnHouseActivityProps,
  LearnHouseEvent,
  LearnHouseTheme,
} from './types'

export type { ActivityDocument, LearnHouseActivityData, LearnHouseEvent, LearnHouseTheme }

/** `detail` of the cancelable `lh-link-click` event. Call `preventDefault()` on the event to stop the navigation. */
export interface LearnHouseLinkClickDetail {
  type: 'link_click'
  href: string
  external: boolean
  originalEvent: MouseEvent
}

/** DOM events of <learnhouse-activity>, with what each carries in `detail`. */
export interface LearnHouseActivityElementEventMap {
  'lh-event': CustomEvent<LearnHouseEvent>
  'lh-load': CustomEvent<Extract<LearnHouseEvent, { type: 'load' }>>
  'lh-ready': CustomEvent<Extract<LearnHouseEvent, { type: 'ready' }>>
  'lh-error': CustomEvent<Extract<LearnHouseEvent, { type: 'error' }>>
  'lh-link-click': CustomEvent<LearnHouseLinkClickDetail>
  'lh-media': CustomEvent<Extract<LearnHouseEvent, { type: 'media' }>>
  'lh-resize': CustomEvent<Extract<LearnHouseEvent, { type: 'resize' }>>
  'lh-visible': CustomEvent<Extract<LearnHouseEvent, { type: 'visible' }>>
  'lh-complete': CustomEvent<Extract<LearnHouseEvent, { type: 'complete' }>>
  'lh-analytics': CustomEvent<Extract<LearnHouseEvent, { type: 'analytics' }>>
}

export declare class LearnHouseActivityElement extends HTMLElement {
  activityId?: string
  activityName?: string
  courseId?: string
  activity?: LearnHouseActivityData
  content?: ActivityDocument | string
  baseUrl?: string
  mediaUrl?: string
  siteUrl?: string
  orgId?: string
  /** A user access token. Never pass an `lh_` API token to the browser. */
  token?: string
  getToken?: () => string | null | undefined | Promise<string | null | undefined>
  client?: LearnHouseClient
  user?: Record<string, any>
  theme?: LearnHouseTheme
  locale?: string
  messages?: Record<string, any>
  hideBlocks?: string[]
  linkTarget?: LearnHouseActivityProps['linkTarget']
  trackCompletion?: boolean
  showTitle?: boolean
  showPoweredBy?: boolean
  unstyled?: boolean
  /** Render nothing on errors; handle `lh-error` yourself. */
  hideError?: boolean
  transformContent?: (doc: ActivityDocument) => ActivityDocument
  /** Mount the activity again from scratch (refetches it). */
  reload(): void
  addEventListener<K extends keyof LearnHouseActivityElementEventMap>(
    type: K,
    listener: (this: LearnHouseActivityElement, event: LearnHouseActivityElementEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void
  removeEventListener<K extends keyof LearnHouseActivityElementEventMap>(
    type: K,
    listener: (this: LearnHouseActivityElement, event: LearnHouseActivityElementEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void
}

export declare const TAG_NAME: 'learnhouse-activity'
export declare function defineLearnHouseActivity(tagName?: string): void

declare global {
  interface HTMLElementTagNameMap {
    'learnhouse-activity': LearnHouseActivityElement
  }
}
