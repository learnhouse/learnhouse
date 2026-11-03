'use client'
import React, { useState } from 'react'
import { Eye, EyeSlash, CodeSimple } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { ENDPOINTS } from '@components/Admin/Developers/catalog'
import EndpointList from '@components/Admin/Developers/playground/EndpointList'
import EndpointDetail from '@components/Admin/Developers/playground/EndpointDetail'

export default function DocsPlaygroundTab({
  onGoToTokens,
}: {
  onGoToTokens: () => void
}) {
  const { t } = useTranslation()
  const [token, setToken] = useState('')
  const [reveal, setReveal] = useState(false)
  const [selectedId, setSelectedId] = useState<string>(ENDPOINTS[0]?.id ?? '')

  const selected = ENDPOINTS.find((e) => e.id === selectedId) ?? ENDPOINTS[0]

  return (
    <div className="space-y-4">
      {/* Token bar */}
      <div className="rounded-xl border border-white/[0.08] bg-[#111112] p-4">
        <div className="flex items-center gap-2 mb-2">
          <CodeSimple size={14} weight="bold" className="text-white/60" />
          <h2 className="text-sm font-semibold text-white">{t('admin.developers.playground.token_title')}</h2>
        </div>
        <div className="flex items-stretch gap-2">
          <input
            type={reveal ? 'text' : 'password'}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={t('admin.developers.playground.token_placeholder')}
            className="flex-1 bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/30 font-mono"
          />
          <button
            onClick={() => setReveal((v) => !v)}
            title={reveal ? t('admin.developers.playground.hide') : t('admin.developers.playground.reveal')}
            className="px-3 rounded-lg border border-white/[0.1] text-white/60 hover:text-white hover:bg-white/[0.04] transition-colors"
          >
            {reveal ? <EyeSlash size={16} weight="fill" /> : <Eye size={16} weight="fill" />}
          </button>
        </div>
        <p className="text-[11px] text-white/40 mt-1.5">
          {t('admin.developers.playground.token_hint')}{' '}
          <button
            onClick={onGoToTokens}
            className="text-sky-300 hover:text-sky-200 underline underline-offset-2"
          >
            {t('admin.developers.playground.mint_token')}
          </button>
        </p>
      </div>

      {/* Two-column explorer */}
      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4 min-h-[600px]">
        <aside className="rounded-xl border border-white/[0.08] bg-[#0d0d0e] overflow-hidden lg:sticky lg:top-20 lg:max-h-[calc(100vh-8rem)]">
          <EndpointList selectedId={selectedId} onSelect={setSelectedId} />
        </aside>

        <main className="rounded-xl border border-white/[0.08] bg-[#111112] p-5">
          {selected && <EndpointDetail key={selected.id} endpoint={selected} token={token} />}
        </main>
      </div>
    </div>
  )
}
