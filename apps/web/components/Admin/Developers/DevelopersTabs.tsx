'use client'
import React, { useState } from 'react'
import { Key, BookOpen } from '@phosphor-icons/react'
import TokensTab from '@components/Admin/Developers/tabs/TokensTab'
import DocsPlaygroundTab from '@components/Admin/Developers/tabs/DocsPlaygroundTab'

type Tab = 'tokens' | 'docs'

interface TabDef {
  key: Tab
  label: string
  icon: React.ReactNode
  description: string
}

const TABS: TabDef[] = [
  {
    key: 'tokens',
    label: 'API Tokens',
    icon: <Key size={14} weight="fill" />,
    description: 'Mint, list, and revoke cross-org superadmin API tokens.',
  },
  {
    key: 'docs',
    label: 'Documentation & Playground',
    icon: <BookOpen size={14} weight="fill" />,
    description: 'Browse the superadmin API, then call it live with your token.',
  },
]

export default function DevelopersTabs() {
  const [active, setActive] = useState<Tab>('tokens')
  const current = TABS.find((t) => t.key === active) ?? TABS[0]

  return (
    <div>
      <div className="flex items-center gap-1 mb-2 border-b border-white/[0.08]">
        {TABS.map((t) => {
          const isActive = active === t.key
          return (
            <button
              key={t.key}
              onClick={() => setActive(t.key)}
              className={
                'inline-flex items-center gap-1.5 px-3.5 py-2.5 text-sm border-b-2 -mb-px transition-colors ' +
                (isActive
                  ? 'border-white text-white'
                  : 'border-transparent text-white/40 hover:text-white/70')
              }
            >
              {t.icon}
              {t.label}
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
