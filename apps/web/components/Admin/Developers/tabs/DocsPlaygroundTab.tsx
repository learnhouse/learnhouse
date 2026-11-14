'use client'
import React, { useState } from 'react'
import { Eye, EyeSlash, CodeSimple } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { INPUT, Panel } from '@/design'
import { ENDPOINTS } from '@components/Admin/Developers/catalog'
import EndpointList from '@components/Admin/Developers/playground/EndpointList'
import EndpointDetail from '@components/Admin/Developers/playground/EndpointDetail'

export default function DocsPlaygroundTab({ onGoToTokens }: { onGoToTokens: () => void }) {
  const { t } = useTranslation()
  const [token, setToken] = useState('')
  const [reveal, setReveal] = useState(false)
  const [selectedId, setSelectedId] = useState<string>(ENDPOINTS[0]?.id ?? '')

  const selected = ENDPOINTS.find((e) => e.id === selectedId) ?? ENDPOINTS[0]

  return (
    <div className="flex flex-col gap-4">
      {/* Token bar */}
      <Panel padded>
        <div className="flex items-center gap-2 mb-2">
          <CodeSimple size={15} weight="bold" className="text-neutral-500" />
          <h2 className="text-sm font-semibold text-neutral-900">{t('admin.developers.playground.token_title')}</h2>
        </div>
        <div className="flex items-stretch gap-2">
          <input
            type={reveal ? 'text' : 'password'}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={t('admin.developers.playground.token_placeholder')}
            className={`${INPUT} font-mono`}
            dir="ltr"
          />
          <button
            type="button"
            onClick={() => setReveal((v) => !v)}
            title={reveal ? t('admin.developers.playground.hide') : t('admin.developers.playground.reveal')}
            aria-label={reveal ? t('admin.developers.playground.hide') : t('admin.developers.playground.reveal')}
            className="w-9 shrink-0 inline-flex items-center justify-center rounded-xl ring-1 ring-inset ring-neutral-200 text-neutral-500 hover:text-neutral-900 hover:bg-neutral-50"
          >
            {reveal ? <EyeSlash size={16} /> : <Eye size={16} />}
          </button>
        </div>
        <p className="text-xs text-neutral-500 mt-2">
          {t('admin.developers.playground.token_hint')}{' '}
          <button type="button" onClick={onGoToTokens} className="font-medium text-neutral-900 underline underline-offset-2">
            {t('admin.developers.playground.mint_token')}
          </button>
        </p>
      </Panel>

      {/* Two-column explorer */}
      <div className="grid grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)] gap-4 lg:min-h-[600px]">
        <aside className="bg-white rounded-2xl nice-shadow overflow-hidden max-h-[420px] lg:max-h-[calc(100vh-8rem)] lg:sticky lg:top-6 flex flex-col">
          <EndpointList selectedId={selectedId} onSelect={setSelectedId} />
        </aside>
        <Panel padded className="min-w-0">
          {selected && <EndpointDetail key={selected.id} endpoint={selected} token={token} />}
        </Panel>
      </div>
    </div>
  )
}
