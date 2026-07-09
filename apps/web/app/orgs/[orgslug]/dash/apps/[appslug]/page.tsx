'use client'
import React, { use } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Loader2, Blocks } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import AppRunner from '@components/Dashboard/Apps/AppRunner'
import FeatureGate from '@components/Dashboard/Shared/FeatureGate/FeatureGate'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { OrgApp, listOrgApps } from '@services/apps/apps'

export type AppRunnerParams = {
  orgslug: string
  appslug: string
}

function AppPage(props: { params: Promise<AppRunnerParams> }) {
  const params = use(props.params)
  const { t } = useTranslation()
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const org = useOrg() as any

  const { data: apps, isLoading } = useQuery<OrgApp[]>({
    queryKey: ['org-apps', org?.id],
    queryFn: () => listOrgApps(org.id, accessToken),
    enabled: !!org?.id && !!accessToken,
  })

  const app = apps?.find(
    (a) => a.slug === params.appslug && a.status === 'installed' && a.enabled
  )

  return (
    <FeatureGate feature="apps" context="dashboard">
      <div className="h-full w-full bg-[#f8f8f8] flex flex-col">
        <div className="pl-4 pr-4 sm:pl-10 sm:pr-10 tracking-tight bg-[#fcfbfc] z-10 nice-shadow flex-shrink-0">
          <div className="pt-6 pb-4">
            <Breadcrumbs
              items={[
                {
                  label: t('dashboard.apps.breadcrumb', { defaultValue: 'Apps' }),
                  href: '/dash/apps',
                  icon: <Blocks size={14} />,
                },
                ...(app ? [{ label: app.name, href: `/dash/apps/${app.slug}` }] : []),
              ]}
            />
          </div>
        </div>
        <div className="flex-1 min-h-0">
          {isLoading || !org?.id ? (
            <div className="flex h-full w-full items-center justify-center text-gray-400">
              <Loader2 size={22} className="animate-spin" />
            </div>
          ) : app ? (
            <AppRunner app={app} orgId={org.id} />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <div className="flex items-center space-x-2 text-gray-500 bg-gray-100 rounded-lg px-4 py-3">
                <AlertTriangle size={18} />
                <span>
                  {t('dashboard.apps.not_found', {
                    defaultValue: 'This app is not installed or is disabled.',
                  })}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </FeatureGate>
  )
}

export default AppPage
