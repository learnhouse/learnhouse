'use client'
import React, { useState } from 'react'
import { Copy, Check } from '@phosphor-icons/react'
import type { SnippetBundle } from '@components/Admin/Developers/snippets'

type Lang = 'curl' | 'js' | 'python'

const LANG_LABELS: Record<Lang, string> = {
  curl: 'curl',
  js: 'JavaScript',
  python: 'Python',
}

export default function CodeSnippetTabs({
  snippets,
  initial = 'curl',
}: {
  snippets: SnippetBundle
  initial?: Lang
}) {
  const [active, setActive] = useState<Lang>(initial)
  const [copied, setCopied] = useState(false)

  const code =
    active === 'curl' ? snippets.curl : active === 'js' ? snippets.js : snippets.python

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard unavailable — silently no-op.
    }
  }

  return (
    <div className="rounded-lg border border-white/[0.08] bg-black/30 overflow-hidden">
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-white/[0.06] bg-white/[0.02]">
        <div className="flex items-center gap-0.5">
          {(['curl', 'js', 'python'] as Lang[]).map((lang) => {
            const isActive = active === lang
            return (
              <button
                key={lang}
                onClick={() => setActive(lang)}
                className={
                  'px-2.5 py-1 rounded text-xs transition-colors ' +
                  (isActive
                    ? 'bg-white/10 text-white'
                    : 'text-white/40 hover:text-white/70')
                }
              >
                {LANG_LABELS[lang]}
              </button>
            )
          })}
        </div>
        <button
          onClick={handleCopy}
          className="text-xs text-white/60 hover:text-white inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-white/[0.04] transition-colors"
        >
          {copied ? (
            <>
              <Check size={12} weight="bold" className="text-emerald-300" />
              Copied
            </>
          ) : (
            <>
              <Copy size={12} weight="fill" />
              Copy
            </>
          )}
        </button>
      </div>
      <pre className="px-3 py-2.5 text-xs font-mono text-white/80 whitespace-pre overflow-x-auto leading-relaxed">
        {code}
      </pre>
    </div>
  )
}
