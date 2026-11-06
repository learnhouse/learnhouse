// <learnhouse-activity>: the same <LearnHouseActivity> as a custom element, for
// apps that don't render React themselves (Vue, Svelte, Angular, plain HTML).
// It mounts a React root in its own light DOM, so the package stylesheet,
// scoped under .lh-activity, applies exactly as it does in a React app.
import React from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { LearnHouseActivity } from './LearnHouseActivity'
import { LearnHouseProvider } from './provider'
import type { LearnHouseActivityProps, LearnHouseEvent, LearnHouseProviderProps } from './types'

export const TAG_NAME = 'learnhouse-activity'

// Attribute → property. Everything else (activity, content, client, getToken,
// user, transformContent) is property-only.
const STRING_ATTRS = {
  'activity-id': 'activityId',
  'activity-name': 'activityName',
  'course-id': 'courseId',
  'base-url': 'baseUrl',
  'media-url': 'mediaUrl',
  'site-url': 'siteUrl',
  'org-id': 'orgId',
  token: 'token',
  locale: 'locale',
  dir: 'dir',
  'link-target': 'linkTarget',
} as const
const JSON_ATTRS = { theme: 'theme', messages: 'messages', 'hide-blocks': 'hideBlocks', content: 'content' } as const
const BOOLEAN_ATTRS = {
  'show-title': 'showTitle',
  'track-completion': 'trackCompletion',
  'show-powered-by': 'showPoweredBy',
  unstyled: 'unstyled',
  'hide-error': 'hideError',
} as const

// `dir` stays the native HTMLElement property, which reflects the attribute.
const PROPERTIES = [
  ...Object.values(STRING_ATTRS).filter((name) => name !== 'dir'),
  ...Object.values(JSON_ATTRS),
  ...Object.values(BOOLEAN_ATTRS),
  'activity',
  'client',
  'getToken',
  'user',
  'transformContent',
] as const

type Property = (typeof PROPERTIES)[number]

function parseList(value: string): string[] {
  const trimmed = value.trim()
  if (trimmed.startsWith('[')) return JSON.parse(trimmed)
  return trimmed.split(',').map((s) => s.trim()).filter(Boolean)
}

// `HTMLElement` doesn't exist during SSR; importing this module there is a no-op.
const Base: typeof HTMLElement = typeof HTMLElement === 'undefined' ? (class {} as any) : HTMLElement

export class LearnHouseActivityElement extends Base {
  static observedAttributes = [...Object.keys(STRING_ATTRS), ...Object.keys(JSON_ATTRS), ...Object.keys(BOOLEAN_ATTRS)]

  private values: Partial<Record<Property, any>> = {}
  private root: Root | null = null
  private scheduled = false
  private generation = 0

  constructor() {
    super()
    // Properties set before the element was defined (frameworks often do)
    // sit on the instance and would shadow the accessors below.
    for (const name of PROPERTIES) {
      if (Object.prototype.hasOwnProperty.call(this, name)) {
        const value = (this as any)[name]
        delete (this as any)[name]
        this.values[name] = value
      }
    }
  }

  connectedCallback() {
    if (!this.root) this.root = createRoot(this)
    this.schedule()
  }

  disconnectedCallback() {
    // A move (keyed lists, portals) disconnects and reconnects in one task.
    queueMicrotask(() => {
      if (this.isConnected || !this.root) return
      this.root.unmount()
      this.root = null
    })
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null) {
    if (name in STRING_ATTRS) {
      this.values[STRING_ATTRS[name as keyof typeof STRING_ATTRS]] = value ?? undefined
    } else if (name in BOOLEAN_ATTRS) {
      this.values[BOOLEAN_ATTRS[name as keyof typeof BOOLEAN_ATTRS]] = value !== null && value !== 'false'
    } else if (name in JSON_ATTRS) {
      const prop = JSON_ATTRS[name as keyof typeof JSON_ATTRS]
      try {
        this.values[prop] = value === null ? undefined : prop === 'hideBlocks' ? parseList(value) : JSON.parse(value)
      } catch (error) {
        console.error(`<${TAG_NAME}>: the ${name} attribute is not valid JSON`, error)
      }
    }
    this.schedule()
  }

  /** Mount the activity again from scratch (refetches it). */
  reload() {
    this.generation += 1
    this.schedule()
  }

  // Several properties are usually set in one go; render once after them.
  private schedule() {
    if (this.scheduled) return
    this.scheduled = true
    queueMicrotask(() => {
      this.scheduled = false
      this.render()
    })
  }

  private dispatch(event: LearnHouseEvent) {
    this.dispatchEvent(new CustomEvent('lh-event', { detail: event, bubbles: true, composed: true }))
    // Link clicks are dispatched by onLinkClick below, where they can be cancelled.
    if (event.type === 'link_click') return
    this.dispatchEvent(new CustomEvent(`lh-${event.type.replace('_', '-')}`, { detail: event, bubbles: true, composed: true }))
  }

  private render() {
    if (!this.root) return
    const v = this.values
    const props: LearnHouseActivityProps = {
      activityId: v.activityId,
      activityName: v.activityName,
      courseId: v.courseId,
      activity: v.activity,
      content: v.content,
      orgId: v.orgId,
      siteUrl: v.siteUrl,
      theme: v.theme,
      locale: v.locale,
      messages: v.messages,
      dir: v.dir,
      hideBlocks: v.hideBlocks,
      linkTarget: v.linkTarget,
      trackCompletion: v.trackCompletion,
      showTitle: v.showTitle,
      showPoweredBy: v.showPoweredBy,
      unstyled: v.unstyled,
      transformContent: v.transformContent,
      // The host renders its own error UI from the lh-error event.
      errorFallback: v.hideError ? () => null : undefined,
      onEvent: (event) => this.dispatch(event),
      onLinkClick: (href, event) => {
        let external = true
        try {
          external = new URL(href, window.location.href).origin !== window.location.origin
        } catch {}
        const detail = { type: 'link_click' as const, href, external, originalEvent: event }
        const allowed = this.dispatchEvent(
          new CustomEvent('lh-link-click', { detail, bubbles: true, composed: true, cancelable: true }),
        )
        return allowed ? undefined : false
      },
    }
    // A new key remounts the activity, which refetches it.
    const activity = <LearnHouseActivity key={this.generation} {...props} />
    if (!v.baseUrl) {
      this.root.render(activity)
      return
    }
    const provider: Omit<LearnHouseProviderProps, 'children'> = {
      baseUrl: v.baseUrl,
      mediaUrl: v.mediaUrl,
      siteUrl: v.siteUrl,
      client: v.client,
      token: v.token,
      getToken: v.getToken,
      user: v.user,
    }
    this.root.render(<LearnHouseProvider {...provider}>{activity}</LearnHouseProvider>)
  }
}

for (const name of PROPERTIES) {
  Object.defineProperty(LearnHouseActivityElement.prototype, name, {
    configurable: true,
    enumerable: true,
    get(this: any) {
      return this.values[name]
    },
    set(this: any, value: unknown) {
      this.values[name] = value
      this.schedule()
    },
  })
}

/** Registers <learnhouse-activity> (once; safe to call again). */
export function defineLearnHouseActivity(tagName: string = TAG_NAME) {
  if (typeof customElements === 'undefined' || customElements.get(tagName)) return
  // A subclass per extra name: one constructor can't be registered twice.
  customElements.define(tagName, tagName === TAG_NAME ? LearnHouseActivityElement : class extends LearnHouseActivityElement {})
}

defineLearnHouseActivity()
