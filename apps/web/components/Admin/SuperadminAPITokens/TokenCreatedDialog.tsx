'use client'
import React, { useState } from 'react'
import { Copy, Check, Warning } from '@phosphor-icons/react'

export interface CreatedToken {
  token: string
  token_uuid: string
  name: string
  description: string | null
  token_prefix: string
  created_by_user_id: number
  creation_date: string
  expires_at: string | null
}

export default function TokenCreatedDialog({
  token,
  onClose,
}: {
  token: CreatedToken | null
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)

  if (!token) return null

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(token.token)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API failed (e.g. insecure context) — fall through silently.
    }
  }

  return (
    <div
      // Intentionally NO click-outside-to-close: the secret cannot be retrieved
      // later; closing must be a deliberate action.
      className="fixed inset-0 z-[1001] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-lg bg-[#141415] border border-white/[0.08] rounded-2xl shadow-2xl">
        <div className="px-6 py-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-2.5">
            <Warning size={18} weight="fill" className="text-amber-300" />
            <h2 className="text-base font-semibold text-white">Save this token now</h2>
          </div>
        </div>

        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-white/70">
            This is the only time the full token <strong>{token.name}</strong> will be shown.
            Store it somewhere secure — you cannot retrieve it later. If you lose it, revoke this token and create a new one.
          </p>

          <div className="rounded-lg bg-black/40 border border-white/[0.1] overflow-hidden">
            <div className="flex items-stretch">
              <code className="flex-1 px-3 py-2.5 font-mono text-xs text-white break-all overflow-x-auto">
                {token.token}
              </code>
              <button
                onClick={handleCopy}
                className="px-3 border-l border-white/[0.08] hover:bg-white/[0.04] transition-colors flex items-center gap-1.5 text-xs text-white/70 hover:text-white"
              >
                {copied ? (
                  <>
                    <Check size={14} weight="bold" className="text-emerald-300" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy size={14} weight="fill" />
                    Copy
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="rounded-lg bg-white/[0.03] border border-white/[0.08] px-3 py-2.5 text-xs text-white/60 font-mono">
            curl -H "Authorization: Bearer &lt;token&gt;" \<br />
            &nbsp;&nbsp;{getApiBase()}/ee/superadmin/organizations
          </div>
        </div>

        <div className="flex items-center justify-end px-6 py-4 border-t border-white/[0.06]">
          <button
            onClick={onClose}
            className="px-3.5 py-2 bg-white/10 hover:bg-white/15 text-white text-sm rounded-lg transition-colors"
          >
            I've saved the token
          </button>
        </div>
      </div>
    </div>
  )
}

function getApiBase(): string {
  // Best-effort hint for the example curl. The user is expected to know
  // their own deployment's base URL; this is just a copy-paste convenience.
  if (typeof window === 'undefined') return 'https://your-api'
  return `${window.location.protocol}//api.${window.location.host.replace(/^www\./, '')}/api/v1`
}
