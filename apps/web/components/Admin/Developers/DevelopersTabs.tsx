'use client'
import React from 'react'
import { BookOpen, Key, Robot } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { DashPage, SubTabs, SubTabPanel, useSubTab } from '@/design'
import { usePlatformMe } from '@components/Admin/hooks'
import { AdminHeader, NoAccess } from '@components/Admin/Shared/AdminKit'
import TokensTab from '@components/Admin/Developers/tabs/TokensTab'
import McpTab from '@components/Admin/Developers/tabs/McpTab'
import DocsPlaygroundTab from '@components/Admin/Developers/tabs/DocsPlaygroundTab'

const SECTIONS = ['tokens', 'mcp', 'docs'] as const

export default function DevelopersTabs() {
  const { t } = useTranslation()
  const me = usePlatformMe()
  const [section, setSection] = useSubTab('tokens', SECTIONS)

  if (!me.isLoading && !me.can('tokens.manage')) {
    return (
      <DashPage>
        <AdminHeader title={t('admin.pages.developers')} />
        <NoAccess />
      </DashPage>
    )
  }

  return (
    <DashPage bottom="lg">
      <AdminHeader title={t('admin.pages.developers')} subtitle={t('admin.pages.developers_desc')} />
      <SubTabs
        ariaLabel={t('admin.pages.developers')}
        value={section}
        onChange={setSection}
        items={[
          { key: 'tokens', label: t('admin.developers.tabs.tokens_label'), icon: <Key size={15} /> },
          { key: 'mcp', label: t('admin.mcp.tab'), icon: <Robot size={15} /> },
          { key: 'docs', label: t('admin.developers.tabs.docs_label'), icon: <BookOpen size={15} /> },
        ]}
      >
        <SubTabPanel tab="tokens">
          <p className="text-sm text-neutral-500">{t('admin.developers.tabs.tokens_desc')}</p>
          <TokensTab />
        </SubTabPanel>
        <SubTabPanel tab="mcp">
          <McpTab onGoToTokens={() => setSection('tokens')} />
        </SubTabPanel>
        <SubTabPanel tab="docs">
          <p className="text-sm text-neutral-500">{t('admin.developers.tabs.docs_desc')}</p>
          <DocsPlaygroundTab onGoToTokens={() => setSection('tokens')} />
        </SubTabPanel>
      </SubTabs>
    </DashPage>
  )
}
