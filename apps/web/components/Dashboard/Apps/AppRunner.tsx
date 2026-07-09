'use client'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { getAPIUrl } from '@services/config/config'
import { OrgApp, createAppSession } from '@services/apps/apps'

/**
 * Runs a third-party app inside a sandboxed iframe and bridges its API calls.
 *
 * Security model (each layer is load-bearing — do not relax):
 * - sandbox WITHOUT allow-same-origin → the app gets an opaque origin: no
 *   cookies, no storage, no parent DOM, even though assets are same-origin.
 * - The app-session token stays in this component's memory. App code never
 *   sees a credential; it asks the host to call the API via postMessage and
 *   the host attaches the token. The token's rights are already capped
 *   server-side to (approved scopes ∩ acting user's rights).
 * - Bridge trusts only messages whose source is this iframe's contentWindow
 *   and whose origin is "null" (opaque). Replies target that window directly.
 */

// Versioned message envelope: { lh: 1, id, type, payload }
const BRIDGE_VERSION = 1
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
// Relative API paths only — no scheme, no host, no traversal.
const API_PATH_RE = /^[A-Za-z0-9][A-Za-z0-9_\-./]*(\?[A-Za-z0-9_\-.=&%+]*)?$/
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024
const RATE_LIMIT_PER_MINUTE = 60
// Re-mint before the 15-minute token expires.
const SESSION_REFRESH_MS = 12 * 60 * 1000

interface AppRunnerProps {
  app: OrgApp
  orgId: number
}

function AppRunner({ app, orgId }: AppRunnerProps) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const org = useOrg() as any
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const appTokenRef = useRef<string | null>(null)
  const callTimestampsRef = useRef<number[]>([])
  const [iframeUrl, setIframeUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const mintSession = useCallback(async () => {
    const res = await createAppSession(orgId, app.app_uuid, accessToken)
    appTokenRef.current = res.token
    // Only (re)load the iframe when the URL actually changed — the asset
    // signature lives much longer than the API token precisely so token
    // refreshes don't reload the app.
    setIframeUrl((prev) => (prev === res.iframe_url ? prev : res.iframe_url))
  }, [orgId, app.app_uuid, accessToken])

  useEffect(() => {
    if (!accessToken) return
    let cancelled = false
    mintSession().catch((e) => {
      if (!cancelled) setError(e?.message ?? 'Failed to start app session')
    })
    const interval = setInterval(() => {
      mintSession().catch(() => {
        // Keep the current token; per-call 401s surface to the app itself.
      })
    }, SESSION_REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [accessToken, mintSession])

  const postToApp = useCallback((message: Record<string, any>) => {
    // targetOrigin must be '*': an opaque origin can never match a concrete
    // one. Safe — delivery is pinned to this specific iframe's window.
    iframeRef.current?.contentWindow?.postMessage({ lh: BRIDGE_VERSION, ...message }, '*')
  }, [])

  const handleApiCall = useCallback(
    async (id: any, payload: any) => {
      const fail = (status: number, detail: string) =>
        postToApp({ id, type: 'api:result', payload: { ok: false, status, data: { detail } } })

      const method = typeof payload?.method === 'string' ? payload.method.toUpperCase() : 'GET'
      const path = payload?.path
      if (!ALLOWED_METHODS.has(method)) return fail(400, 'Method not allowed')
      if (
        typeof path !== 'string' ||
        path.length > 2048 ||
        !API_PATH_RE.test(path) ||
        path.split('?')[0].split('/').includes('..')
      ) {
        return fail(400, 'Invalid API path')
      }

      // Client-side rate limit (the API also rate limits server-side).
      const now = Date.now()
      callTimestampsRef.current = callTimestampsRef.current.filter((t) => now - t < 60_000)
      if (callTimestampsRef.current.length >= RATE_LIMIT_PER_MINUTE) {
        return fail(429, 'Rate limit exceeded')
      }
      callTimestampsRef.current.push(now)

      const token = appTokenRef.current
      if (!token) return fail(401, 'App session not ready')

      try {
        const response = await fetch(`${getAPIUrl()}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(payload?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          body: payload?.body !== undefined ? JSON.stringify(payload.body) : undefined,
          cache: 'no-store',
        })
        const text = await response.text()
        if (text.length > MAX_RESPONSE_BYTES) return fail(502, 'Response too large')
        let data: any = null
        try {
          data = text ? JSON.parse(text) : null
        } catch (_e) {
          data = text
        }
        postToApp({
          id,
          type: 'api:result',
          payload: { ok: response.ok, status: response.status, data },
        })
      } catch (_e) {
        fail(502, 'Request failed')
      }
    },
    [postToApp]
  )

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // Only the sandboxed (opaque-origin) iframe we rendered may talk to us.
      if (event.origin !== 'null') return
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return
      const msg = event.data
      if (!msg || msg.lh !== BRIDGE_VERSION || typeof msg.type !== 'string') return

      if (msg.type === 'ready') {
        postToApp({
          type: 'init',
          payload: {
            app: { slug: app.slug, name: app.name, version: app.version },
            org: { id: org?.id, slug: org?.slug, name: org?.name },
            user: { username: session?.data?.user?.username },
            locale: typeof navigator !== 'undefined' ? navigator.language : 'en',
          },
        })
      } else if (msg.type === 'api') {
        handleApiCall(msg.id, msg.payload)
      } else if (msg.type === 'resize') {
        const height = Number(msg.payload?.height)
        if (iframeRef.current && Number.isFinite(height) && height > 0 && height <= 20000) {
          iframeRef.current.style.minHeight = `${Math.ceil(height)}px`
        }
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [app, org, session, postToApp, handleApiCall])

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="flex items-center space-x-2 text-red-600 bg-red-50 rounded-lg px-4 py-3">
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      </div>
    )
  }

  if (!iframeUrl) {
    return (
      <div className="flex h-full w-full items-center justify-center text-gray-400">
        <Loader2 size={22} className="animate-spin" />
      </div>
    )
  }

  return (
    <iframe
      ref={iframeRef}
      src={iframeUrl}
      title={app.name}
      // No allow-same-origin: the app must run with an opaque origin.
      sandbox="allow-scripts allow-forms allow-downloads"
      className="h-full w-full border-0 bg-white"
    />
  )
}

export default AppRunner
