'use client'
import React from 'react'
import { Blocks } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import FeatureGate from '@components/Dashboard/Shared/FeatureGate/FeatureGate'
import OrgAppsManage from '@components/Dashboard/Apps/OrgAppsManage'

function AppsManagePage() {
  const { t } = useTranslation()

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
                {
                  label: t('dashboard.apps.manage', { defaultValue: 'Manage apps' }),
                  href: '/dash/apps/manage',
                },
              ]}
            />
          </div>
          <div className="my-2 py-2">
            <div className="w-full flex flex-col space-y-1 min-w-0">
              <div className="pt-3 flex font-bold text-3xl sm:text-4xl tracking-tighter truncate">
                {t('dashboard.apps.manage_title', { defaultValue: 'Manage Apps' })}
              </div>
              <div className="flex font-medium text-gray-400 text-md truncate">
                {t('dashboard.apps.manage_subtitle', {
                  defaultValue: 'Install packaged apps and control their permissions',
                })}
              </div>
            </div>
          </div>
        </div>
        <div className="h-6 flex-shrink-0"></div>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.1, type: 'spring', stiffness: 80 }}
          className="flex-1 overflow-y-auto"
        >
          <OrgAppsManage />
        </motion.div>
      </div>
    </FeatureGate>
  )
}

export default AppsManagePage
