'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IdentificationCard, SquaresFour } from '@phosphor-icons/react'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import { AccountNav, type AccountSection } from '@components/Objects/Account/AccountNav'
import { AccountSectionHeader } from '@components/Objects/Account/AccountSection'
import AccountGeneral from '@components/Objects/Account/subpages/AccountGeneral'
import AccountSecurity from '@components/Objects/Account/subpages/AccountSecurity'
import AccountNotes from '@components/Objects/Account/subpages/AccountNotes'
import UserProfileBuilder from '@components/Dashboard/Pages/UserAccount/UserProfile/UserProfileBuilder'
import AccountPurchases from '@ee/components/Payments/AccountPurchases'
import OrgEditMCP from '@components/Dashboard/Pages/Org/OrgEditMCP/OrgEditMCP'
import { Panel, SubTabPanel, SubTabs, useSubTab } from '@/design'
import { ThemeChoice } from '@components/Objects/Theme/ThemeSwitch'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import dynamic from 'next/dynamic'

// Notification settings load with their section only.
const NotificationSettings = dynamic(() => import('@components/Notifications/NotificationSettings'), { ssr: false })

interface AccountClientProps {
  orgslug: string
  org_id: number
  subpage: string
}

const PROFILE_TABS = ['personal', 'public'] as const

// Profile = what used to be "General" (identity, avatar, email) and "Profile"
// (the public profile builder), as two sub-tabs of one section.
function ProfileSection({ onWideChange }: { onWideChange?: (_wide: boolean) => void }) {
  const { t } = useTranslation()
  const [tab, setTab] = useSubTab('personal', PROFILE_TABS, { rememberAs: 'account:profile' })
  // The builder shows a live preview beside the editor: give it the width.
  useEffect(() => {
    onWideChange?.(tab === 'public')
    return () => onWideChange?.(false)
  }, [tab, onWideChange])
  const [personalDirty, setPersonalDirty] = useState(false)
  const [publicDirty, setPublicDirty] = useState(false)

  return (
    <>
      <AccountSectionHeader
        title={t('account.profile')}
        description={t('account.profile_subtitle', {
          defaultValue: 'Your name, photo and email, and the public profile other people see.',
        })}
      />
      <SubTabs
        ariaLabel={t('account.profile')}
        idPrefix="account-profile"
        value={tab}
        onChange={setTab}
        items={[
          {
            key: 'personal',
            label: t('account.personal_info', { defaultValue: 'Personal info' }),
            icon: <IdentificationCard size={15} />,
            dirty: personalDirty,
          },
          {
            key: 'public',
            label: t('account.public_profile', { defaultValue: 'Public profile' }),
            icon: <SquaresFour size={15} />,
            dirty: publicDirty,
          },
        ]}
      >
        <SubTabPanel tab="personal">
          <AccountGeneral onDirtyChange={setPersonalDirty} />
        </SubTabPanel>
        <SubTabPanel tab="public">
          <UserProfileBuilder onDirtyChange={setPublicDirty} />
        </SubTabPanel>
      </SubTabs>
    </>
  )
}

const AccountClient = ({ orgslug, org_id, subpage }: AccountClientProps) => {
  const { t } = useTranslation()
  const { track } = useLHAnalytics('learner')
  const [wide, setWide] = useState(false)

  // Fire one impression per distinct subpage (component stays mounted across
  // subpage changes, so guard on the value rather than relying on remount).
  const lastSubpageRef = useRef<string | null>(null)
  useEffect(() => {
    if (lastSubpageRef.current === subpage) return
    lastSubpageRef.current = subpage
    track(AnalyticsEvent.AccountSubpageViewed, { subpage })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subpage])

  const section: AccountSection =
    subpage === 'security' || subpage === 'notifications' || subpage === 'appearance' || subpage === 'notes' || subpage === 'purchases' || subpage === 'ai-apps' ? subpage : 'general'

  const renderSection = () => {
    switch (section) {
      case 'security':
        return (
          <>
            <AccountSectionHeader
              title={t('account.security')}
              description={t('account.security_subtitle', {
                defaultValue: 'Password, two-factor authentication, your session and account deletion.',
              })}
            />
            <AccountSecurity />
          </>
        )
      case 'notifications':
        return (
          <>
            <AccountSectionHeader
              title={t('notifications.title')}
              description={t('notifications.settings_subtitle')}
            />
            <NotificationSettings />
          </>
        )
      case 'appearance':
        return (
          <>
            <AccountSectionHeader
              title={t('account.appearance')}
              description={t('account.appearance_subtitle')}
            />
            <Panel padded>
              <p className="text-sm font-semibold text-neutral-900">{t('common.theme')}</p>
              <p className="mt-0.5 mb-4 text-sm text-neutral-500">{t('account.appearance_theme_hint')}</p>
              <ThemeChoice />
            </Panel>
          </>
        )
      case 'notes':
        // Private notes: renders its own section header.
        return <AccountNotes />
      case 'purchases':
        // Renders its own section header (with the store link).
        return <AccountPurchases orgId={org_id} orgslug={orgslug} />
      case 'ai-apps':
        return (
          <>
            <AccountSectionHeader
              title={t('account.ai_apps')}
              description={t('account.ai_apps_subtitle', {
                defaultValue: 'AI assistants you connected to your account, and how to connect one.',
              })}
            />
            <OrgEditMCP scope="mine" />
          </>
        )
      default:
        return <ProfileSection onWideChange={setWide} />
    }
  }

  return (
    <GeneralWrapperStyled>
      <div className="flex flex-col md:flex-row gap-5 md:gap-10 pt-1 md:pt-4 pb-10">
        <aside className="md:w-56 lg:w-60 shrink-0">
          <div className="md:sticky md:top-[calc(6rem+var(--lh-company-bar-h,0px))]">
            <AccountNav orgslug={orgslug} current={section} />
          </div>
        </aside>
        <div className={`flex-1 min-w-0 ${wide ? 'max-w-[90rem]' : 'max-w-4xl'}`}>{renderSection()}</div>
      </div>
    </GeneralWrapperStyled>
  )
}

export default AccountClient
