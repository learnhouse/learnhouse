import type { HttpCore } from '../core/http'
import type { BaseRequestOptions } from '../core/types'
import type { EmbedSession } from '../models'

export interface CreateEmbedSessionInput {
  /** Slug of the organization the API token belongs to. */
  orgSlug: string
  /** The learner the session acts as. Must belong to this organization only. */
  userId: number
  /** Lifetime in seconds, 60 to 3600. Defaults to 900 (15 minutes). */
  ttlSeconds?: number
}

function inBrowser(): boolean {
  return typeof (globalThis as { document?: unknown }).document !== 'undefined'
}

/**
 * Embed sessions: short-lived learner sessions for the embed components
 * (`@learnhouse/react`, `@learnhouse/vue`).
 */
export function createEmbedResource(http: HttpCore) {
  return {
    /**
     * Mint a session for one learner, on your server, with an org API token
     * that has the `users` update permission. Send only `access_token` (and
     * `expires_at`) to the browser.
     *
     * The session lasts 15 minutes by default, has no refresh token, works
     * only inside this organization and only on the routes the embed
     * components use. Admins, maintainers and accounts that belong to other
     * organizations are refused.
     *
     * `POST /api/v1/admin/{org_slug}/auth/embed-session`
     */
    createSession(input: CreateEmbedSessionInput, options?: BaseRequestOptions): Promise<EmbedSession> {
      if (inBrowser()) {
        // Minting needs the org API token, which must never reach a browser.
        return Promise.reject(
          new Error('@learnhouse/sdk: embed.createSession() runs on your server, never in the browser'),
        )
      }
      const body: Record<string, unknown> = { user_id: input.userId }
      if (input.ttlSeconds !== undefined) body.ttl_seconds = input.ttlSeconds
      return http.request<EmbedSession>('POST', '/api/v1/admin/{org_slug}/auth/embed-session', {
        ...options,
        params: { path: { org_slug: input.orgSlug } },
        body,
      })
    },
  }
}

export type EmbedResource = ReturnType<typeof createEmbedResource>
