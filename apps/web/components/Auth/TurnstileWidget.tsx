'use client'
import { getConfig, getDeploymentMode } from '@services/config/config'
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile'
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

// Client-side Cloudflare Turnstile widget. Reads the PUBLIC site key from the
// runtime config (getConfig — this is a prebuilt image, so process.env.NEXT_PUBLIC_*
// isn't reliable at runtime). Turnstile is active ONLY when BOTH the site key is
// set AND the deployment is SaaS (LH_mode cookie) — never on OSS/self-hosted.
// When inactive the widget renders NOTHING and forms treat a null token as
// "allowed". The server enforces the same SaaS + TURNSTILE_SECRET_KEY gate.

/** Read the public site key at runtime. Empty string ⇒ Turnstile disabled. */
export function getTurnstileSiteKey(): string {
  return getConfig('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '')
}

/**
 * True when Turnstile should be active on the client: a site key is present AND
 * we're on the SaaS deployment. NOTE: `getDeploymentMode()` reads the LH_mode
 * cookie, which isn't available during SSR — call this only after mount (see
 * `useTurnstileRequired`) to avoid hydration mismatches.
 */
export function isTurnstileConfigured(): boolean {
  return getTurnstileSiteKey().length > 0 && getDeploymentMode() === 'saas'
}

/**
 * Mount-safe variant for gating form submit buttons. Returns false during SSR
 * and the first client render, then the real value after mount — so the button's
 * disabled state never mismatches between server and client.
 *
 * The public site key comes from `window.__RUNTIME_CONFIG__`, injected by an
 * external `/runtime-config.js` script that can execute AFTER React hydrates.
 * A one-shot check on mount therefore races that script and can permanently
 * capture an empty key. We poll briefly until the config is available (or a
 * short timeout) so the widget reliably appears once the key loads.
 */
export function useTurnstileRequired(): boolean {
  const [required, setRequired] = useState(false)
  useEffect(() => {
    if (isTurnstileConfigured()) {
      setRequired(true)
      return
    }
    let tries = 0
    const id = setInterval(() => {
      if (isTurnstileConfigured()) {
        setRequired(true)
        clearInterval(id)
      } else if (++tries >= 40) {
        // ~6s: runtime-config.js should have loaded by now; give up quietly.
        clearInterval(id)
      }
    }, 150)
    return () => clearInterval(id)
  }, [])
  return required
}

/**
 * Verify a token via the server route (used by forms that call the backend
 * directly: login/forgot/reset). Resolves true when Turnstile is disabled or
 * the token checks out; false only on a positive verification failure. Network
 * errors resolve true (fail-open) to match the server's behavior.
 */
export async function verifyTurnstileToken(token: string | null): Promise<boolean> {
  if (!isTurnstileConfigured()) return true
  try {
    const res = await fetch('/api/turnstile/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    const data = await res.json().catch(() => ({ ok: true }))
    return Boolean(data.ok)
  } catch {
    return true
  }
}

export interface TurnstileWidgetHandle {
  reset: () => void
}

interface TurnstileWidgetProps {
  /** Called with the token on success, and with null on expire/error. */
  onToken: (_token: string | null) => void
  className?: string
}

/**
 * Renders the Turnstile challenge and streams the token up via `onToken`.
 * Parent forms keep the token in state and send it with the request; on a
 * failed submit they call `ref.reset()` to fetch a fresh token.
 */
const TurnstileWidget = forwardRef<TurnstileWidgetHandle, TurnstileWidgetProps>(
  function TurnstileWidget({ onToken, className }, ref) {
    const innerRef = useRef<TurnstileInstance>(null)
    const siteKey = getTurnstileSiteKey()
    // Only decide after mount: getDeploymentMode() reads a cookie unavailable
    // during SSR, so rendering the widget SSR-side would hydration-mismatch.
    const active = useTurnstileRequired()

    useImperativeHandle(ref, () => ({
      reset: () => {
        innerRef.current?.reset()
        onToken(null)
      },
    }))

    // Inactive (no site key, or not SaaS, or pre-mount) → render nothing.
    if (!active || !siteKey) return null

    return (
      <div className={className}>
        <Turnstile
          ref={innerRef}
          siteKey={siteKey}
          onSuccess={(token) => onToken(token)}
          onExpire={() => onToken(null)}
          onError={() => onToken(null)}
          options={{ theme: 'auto', size: 'flexible' }}
        />
      </div>
    )
  },
)

export default TurnstileWidget
