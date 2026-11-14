'use client'
import React, { useState } from 'react'
import { Copy, Check } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
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
      // Clipboard unavailable; silently no-op.
    }
  }

  return (
    <div className="rounded-xl bg-[#1d1d21] ring-1 ring-inset ring-[rgb(255_255_255/0.06)] overflow-hidden">
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-[rgb(255_255_255/0.1)]">
        <div className="flex items-center gap-0.5">
          {(['curl', 'js', 'python'] as Lang[]).map((lang) => {
            const isActive = active === lang
            return (
              <button
                key={lang}
                onClick={() => setActive(lang)}
                className={
                  'px-2.5 py-1 rounded-md text-xs font-medium transition-colors ' +
                  (isActive
                    ? 'bg-[rgb(255_255_255/0.1)] text-[rgb(255_255_255/1)]'
                    : 'text-[rgb(255_255_255/0.4)] hover:text-[rgb(255_255_255/0.7)]')
                }
              >
                {LANG_LABELS[lang]}
              </button>
            )
          })}
        </div>
        <button
          onClick={handleCopy}
          className="text-xs text-[rgb(255_255_255/0.6)] hover:text-[rgb(255_255_255/1)] inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-[rgb(255_255_255/0.1)] transition-colors"
        >
          {copied ? (
            <>
              <Check size={12} weight="bold" className="text-emerald-400" />
              {t('admin.developers.snippets.copied')}
            </>
          ) : (
            <>
              <Copy size={12} weight="fill" />
              {t('admin.developers.snippets.copy')}
            </>
          )}
        </button>
      </div>
      <pre dir="ltr" className="px-3 py-2.5 text-xs font-mono text-[rgb(255_255_255/0.85)] whitespace-pre overflow-x-auto leading-relaxed">
        {code}
      </pre>
    </div>
  )
}
