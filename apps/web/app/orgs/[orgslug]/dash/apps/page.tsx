'use client'
import React, { use } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Blocks, Loader2, Settings2 } from 'lucide-react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import FeatureGate from '@components/Dashboard/Shared/FeatureGate/FeatureGate'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { getUriWithOrg } from '@services/config/config'
import { OrgApp, listOrgApps } from '@services/apps/apps'

export type AppsHomeParams = {
  orgslug: string
}

function AppsHomePage(props: { params: Promise<AppsHomeParams> }) {
  const params = use(props.params)
  const { t } = useTranslation()
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const org = useOrg() as any
  const { isAdmin } = useAdminStatus() as any

  const { data: apps, isLoading } = useQuery<OrgApp[]>({
    queryKey: ['org-apps', org?.id],
    queryFn: () => listOrgApps(org.id, accessToken),
    enabled: !!org?.id && !!accessToken,
  })

  const enabledApps = (apps ?? []).filter(
    (app) => app.status === 'installed' && app.enabled
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
              ]}
            />
          </div>
          <div className="my-2 py-2 flex items-end justify-between">
            <div className="w-full flex flex-col space-y-1 min-w-0">
              <div className="pt-3 flex font-bold text-3xl sm:text-4xl tracking-tighter truncate">
                {t('dashboard.apps.title', { defaultValue: 'Apps' })}
              </div>
              <div className="flex font-medium text-gray-400 text-md truncate">
                {t('dashboard.apps.subtitle', {
                  defaultValue: 'Third-party apps installed in your organization',
                })}
              </div>
            </div>
            {isAdmin && (
              <Link
                href={getUriWithOrg(params.orgslug, '') + '/dash/apps/manage'}
                className="flex items-center space-x-2 rounded-lg bg-black text-white text-sm px-3 py-2 hover:bg-gray-800 flex-shrink-0 mb-1"
              >
                <Settings2 size={16} />
                <span>{t('dashboard.apps.manage', { defaultValue: 'Manage apps' })}</span>
              </Link>
            )}
          </div>
        </div>
        <div className="h-6 flex-shrink-0"></div>
        <div className="flex-1 overflow-y-auto px-4 sm:px-10 pb-10">
          {isLoading ? (
            <div className="flex justify-center py-16 text-gray-400">
              <Loader2 size={22} className="animate-spin" />
            </div>
          ) : enabledApps.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400 space-y-2">
              <Blocks size={28} />
              <span className="text-sm">
                {t('dashboard.apps.none_enabled', {
                  defaultValue: 'No apps are enabled for this organization yet.',
                })}
              </span>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {enabledApps.map((app) => (
                <Link
                  key={app.app_uuid}
                  href={getUriWithOrg(params.orgslug, '') + `/dash/apps/${app.slug}`}
                  className="bg-white rounded-xl nice-shadow p-4 hover:scale-[1.01] transition-transform"
                >
                  <div className="flex items-center space-x-3">
                    <div className="rounded-lg bg-gray-100 p-2 text-gray-600">
                      <Blocks size={20} />
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-gray-800 truncate">{app.name}</div>
                      <div className="text-xs text-gray-400 truncate">
                        {app.description || `v${app.version}`}
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </FeatureGate>
  )
}

export default AppsHomePage
