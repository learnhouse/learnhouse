'use client'
import React, { useState } from 'react'
import { Key, BookOpen } from '@phosphor-icons/react'
import TokensTab from '@components/Admin/Developers/tabs/TokensTab'
import DocsPlaygroundTab from '@components/Admin/Developers/tabs/DocsPlaygroundTab'
import { useTranslation } from 'react-i18next'

type Tab = 'tokens' | 'docs'

interface TabDef {
  key: Tab
  label: string
  icon: React.ReactNode
  description: string
}

export default function DevelopersTabs() {
  const { t } = useTranslation()
  const TABS: TabDef[] = [
    {
      key: 'tokens',
      label: t('admin.developers.tab_tokens'),
      icon: <Key size={14} weight="fill" />,
      description: t('admin.developers.tab_tokens_desc'),
    },
    {
      key: 'docs',
      label: t('admin.developers.tab_docs'),
      icon: <BookOpen size={14} weight="fill" />,
      description: t('admin.developers.tab_docs_desc'),
    },
  ]
  const [active, setActive] = useState<Tab>('tokens')
  const current = TABS.find((tab) => tab.key === active) ?? TABS[0]

  return (
    <div>
      <div className="flex items-center gap-1 mb-2 border-b border-white/[0.08]">
        {TABS.map((tab) => {
          const isActive = active === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => setActive(tab.key)}
              className={
                'inline-flex items-center gap-1.5 px-3.5 py-2.5 text-sm border-b-2 -mb-px transition-colors ' +
                (isActive
                  ? 'border-white text-white'
                  : 'border-transparent text-white/40 hover:text-white/70')
              }
            >
              {tab.icon}
              {tab.label}
            </button>
          )
        })}
      </div>
      <p className="text-xs text-white/40 mb-6">{current.description}</p>

      {active === 'tokens' && <TokensTab />}
      {active === 'docs' && (
        <DocsPlaygroundTab onGoToTokens={() => setActive('tokens')} />
      )}
    </div>
  )
}
