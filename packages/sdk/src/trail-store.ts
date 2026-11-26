// A shared, subscribable copy of the signed-in learner's trail per org.
//
// Several parts of a page show progress (a course header, a lesson's "Mark as
// complete", a sidebar). With one store they read one copy, load it once, and
// every change made through the store (enroll, complete...) reaches all of
// them at once, from the trail the API returns, without another request.
// @learnhouse/react and @learnhouse/vue keep one per provider.

import type { TrailResource } from './resources/trail'
import type { Trail } from './models'

export interface TrailStoreState {
  /** `undefined` until loaded; `null` when it could not be loaded (signed out, not a member). */
  trail: Trail | null | undefined
  loading: boolean
  error: Error | null
}

type Client = { trail: Pick<TrailResource, 'getForOrg' | 'startCourse' | 'leaveCourse' | 'completeActivity' | 'uncompleteActivity'> }

const EMPTY: TrailStoreState = Object.freeze({ trail: undefined, loading: false, error: null }) as TrailStoreState

export class TrailStore {
  private readonly states = new Map<number, TrailStoreState>()
  private readonly inflight = new Map<number, Promise<Trail | null>>()
  private readonly listeners = new Set<(orgId: number) => void>()

  constructor(private readonly client: Client) {}

  /** The current state for an org. Stable object identity until it changes. */
  get(orgId: number): TrailStoreState {
    return this.states.get(orgId) ?? EMPTY
  }

  /** Called with the org id whenever that org's state changes. Returns the unsubscribe. */
  subscribe(listener: (orgId: number) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Replace an org's trail (e.g. with one your own call returned). */
  set(orgId: number, trail: Trail | null): void {
    this.update(orgId, { trail, loading: false, error: null })
  }

  /**
   * Load the trail, once: concurrent callers share the request, and a loaded
   * trail is returned as-is unless `force`. A failure resolves to `null` and
   * is kept in `error` (the learner is signed out, or not in this org).
   */
  load(orgId: number, options: { force?: boolean } = {}): Promise<Trail | null> {
    const current = this.get(orgId)
    if (!options.force && current.trail !== undefined) return Promise.resolve(current.trail)
    const running = this.inflight.get(orgId)
    if (running) return running
    this.update(orgId, { ...current, loading: true })
    const request = this.client.trail
      .getForOrg(orgId)
      .then(
        (trail) => {
          this.update(orgId, { trail, loading: false, error: null })
          return trail
        },
        (err: unknown) => {
          this.update(orgId, { trail: null, loading: false, error: err instanceof Error ? err : new Error(String(err)) })
          return null
        },
      )
      .finally(() => this.inflight.delete(orgId))
    this.inflight.set(orgId, request)
    return request
  }

  /** `trail.startCourse()`, then share the returned trail. */
  enroll(orgId: number, courseUuid: string): Promise<Trail> {
    return this.apply(orgId, this.client.trail.startCourse(courseUuid))
  }

  /** `trail.leaveCourse()`, then share the returned trail. */
  leave(orgId: number, courseUuid: string): Promise<Trail> {
    return this.apply(orgId, this.client.trail.leaveCourse(courseUuid))
  }

  /** `trail.completeActivity()`, then share the returned trail. */
  complete(orgId: number, activityUuid: string): Promise<Trail> {
    return this.apply(orgId, this.client.trail.completeActivity(activityUuid))
  }

  /** `trail.uncompleteActivity()`, then share the returned trail. */
  uncomplete(orgId: number, activityUuid: string): Promise<Trail> {
    return this.apply(orgId, this.client.trail.uncompleteActivity(activityUuid))
  }

  /** Forget every org (e.g. after sign-out). */
  clear(): void {
    const orgs = [...this.states.keys()]
    this.states.clear()
    for (const orgId of orgs) this.emit(orgId)
  }

  private async apply(orgId: number, request: Promise<Trail>): Promise<Trail> {
    const trail = await request
    // Some responses (older instances) omit runs; reload rather than store a partial trail.
    if (trail && Array.isArray(trail.runs)) this.set(orgId, trail)
    else await this.load(orgId, { force: true })
    return trail
  }

  private update(orgId: number, state: TrailStoreState): void {
    this.states.set(orgId, state)
    this.emit(orgId)
  }

  private emit(orgId: number): void {
    for (const listener of [...this.listeners]) listener(orgId)
  }
}
