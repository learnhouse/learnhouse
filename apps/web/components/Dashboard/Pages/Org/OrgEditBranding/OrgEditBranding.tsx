'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Icon as PhosphorIcon, Images, PaintBrush, ShareNetwork, Shapes, SignIn } from '@phosphor-icons/react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@components/ui/tabs'
import LogosTab from './LogosTab'
import ThemeTab from './ThemeTab'
import AuthBrandingTab from './AuthBrandingTab'
import SocialTab from './SocialTab'
import PreviewsTab from './PreviewsTab'

type TabKey = 'logos' | 'theme' | 'auth' | 'social' | 'previews'

const TABS: { key: TabKey; icon: PhosphorIcon; Component: React.ComponentType }[] = [
  { key: 'logos', icon: Shapes, Component: LogosTab },
  { key: 'theme', icon: PaintBrush, Component: ThemeTab },
  { key: 'auth', icon: SignIn, Component: AuthBrandingTab },
  { key: 'social', icon: ShareNetwork, Component: SocialTab },
  { key: 'previews', icon: Images, Component: PreviewsTab },
]

/**
 * Organization branding. Every tab pairs its controls with miniatures of the
 * surfaces the setting changes, drawn with the org's real assets, so an admin
 * sees the result before they save.
 */
export default function OrgEditBranding() {
  const { t } = useTranslation()

  return (
    <div className="sm:mx-10 mx-0 bg-white rounded-xl nice-shadow sm:mb-0 mb-16">
      <Tabs defaultValue="logos" className="w-full">
        <div className="flex flex-col gap-4 px-5 pt-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="-space-y-0.5">
            <h1 className="text-xl font-bold text-gray-800">{t('dashboard.organization.branding.title')}</h1>
            <h2 className="text-md text-gray-500">{t('dashboard.organization.branding.subtitle')}</h2>
          </div>
          <TabsList className="flex h-auto gap-0.5 self-start overflow-x-auto rounded-lg bg-gray-100 p-1 sm:self-auto">
            {TABS.map(({ key, icon: Icon }) => (
              <TabsTrigger
                key={key}
                value={key}
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-gray-600 transition-all data-[state=active]:bg-white data-[state=active]:text-gray-900 data-[state=active]:shadow-xs"
              >
                <Icon size={14} weight="bold" />
                <span className="hidden sm:inline whitespace-nowrap">{t(`dashboard.organization.branding.tabs.${key}`)}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div className="mt-4 border-t border-gray-100">
          {TABS.map(({ key, Component }) => (
            <TabsContent key={key} value={key} className="mt-0">
              <Component />
            </TabsContent>
          ))}
        </div>
      </Tabs>
    </div>
  )
}
