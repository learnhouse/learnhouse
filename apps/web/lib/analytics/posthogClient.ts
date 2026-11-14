'use client'
import { createContext, useContext } from 'react'
import type { PostHog } from 'posthog-js'

// The PostHog SDK (~100 KB) used to be in every page's first download, even
// with no key configured. It now loads after the page (lib/analytics/
// posthogInit.ts); until then this facade queues calls, then replays them in
// order, so events fired while the page boots are not lost.

type Method = 'capture' | 'identify' | 'group' | 'reset' | 'opt_out_capturing' | 'opt_in_capturing'
const MAX_QUEUE = 200

export class PostHogFacade {
  private instance: PostHog | null = null
  private queue: [Method, unknown[]][] = []

  attach(instance: PostHog) {
    this.instance = instance
    const pending = this.queue
    this.queue = []
    for (const [method, args] of pending) (instance as any)[method](...args)
  }

  get ready() {
    return this.instance !== null
  }

  private call(method: Method, args: unknown[]) {
    if (this.instance) return (this.instance as any)[method](...args)
    if (this.queue.length < MAX_QUEUE) this.queue.push([method, args])
  }

  capture(event: string, properties?: Record<string, unknown>) {
    this.call('capture', [event, properties])
  }
  identify(distinctId: string, properties?: Record<string, unknown>) {
    this.call('identify', [distinctId, properties])
  }
  group(type: string, key: string, properties?: Record<string, unknown>) {
    this.call('group', [type, key, properties])
  }
  reset() {
    this.call('reset', [])
  }
  opt_out_capturing() {
    this.call('opt_out_capturing', [])
  }
  opt_in_capturing() {
    this.call('opt_in_capturing', [])
  }
  // Unknown until the SDK (and its persisted consent) has loaded.
  has_opted_out_capturing(): boolean {
    return this.instance ? this.instance.has_opted_out_capturing() : false
  }
}

export type PostHogClientState = { client: PostHogFacade | null; ready: boolean }

export const PostHogClientContext = createContext<PostHogClientState>({ client: null, ready: false })

/** The PostHog client, or null when PostHog is off (no key configured). */
export function usePostHogClient(): PostHogFacade | null {
  return useContext(PostHogClientContext).client
}

/** True once the SDK has loaded (its persisted state is readable). */
export function usePostHogReady(): boolean {
  return useContext(PostHogClientContext).ready
}
