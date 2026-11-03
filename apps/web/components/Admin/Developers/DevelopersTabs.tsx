'use client'
import React, { useState } from 'react'
import { Key, BookOpen } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import TokensTab from '@components/Admin/Developers/tabs/TokensTab'
import DocsPlaygroundTab from '@components/Admin/Developers/tabs/DocsPlaygroundTab'

type Tab = 'tokens' | 'docs'

interface TabDef {
  key: Tab
  labelKey: string
  icon: React.ReactNode
  descriptionKey: string
}

const TABS: TabDef[] = [
  {
    key: 'tokens',
    labelKey: 'admin.developers.tabs.tokens_label',
    icon: <Key size={14} weight="fill" />,
    descriptionKey: 'admin.developers.tabs.tokens_desc',
  },
  {
    key: 'docs',
    labelKey: 'admin.developers.tabs.docs_label',
    icon: <BookOpen size={14} weight="fill" />,
    descriptionKey: 'admin.developers.tabs.docs_desc',
  },
]

export default function DevelopersTabs() {
  const { t } = useTranslation()
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
              {t(tab.labelKey)}
            </button>
          )
        })}
      </div>
      <p className="text-xs text-white/40 mb-6">{t(current.descriptionKey)}</p>

      {active === 'tokens' && <TokensTab />}
      {active === 'docs' && (
        <DocsPlaygroundTab onGoToTokens={() => setActive('tokens')} />
      )}
    </div>
  )
}
