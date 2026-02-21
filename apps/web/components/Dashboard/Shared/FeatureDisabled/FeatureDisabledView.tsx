'use client'

import React from 'react'
import { useTranslation } from 'react-i18next'
import { LucideIcon, Ban, Settings, AlertTriangle } from 'lucide-react'
import { useOrg } from '@components/Contexts/OrgContext'
import Link from 'next/link'
import { getUriWithOrg } from '@services/config/config'

interface FeatureDisabledViewProps {
  /** The feature name to check (e.g., 'courses', 'collections', 'communities') */
  featureName: string
  /** The org slug for linking to settings (required for dashboard context) */
  orgslug: string
  /** Lucide icon to display in the disabled screen */
  icon?: LucideIcon
  /** Context: 'public' shows full disabled screen, 'dashboard' shows banner with content */
  context: 'public' | 'dashboard'
  /** Content to render if feature is enabled (or below banner in dashboard) */
  children: React.ReactNode
}

/**
 * Inline banner component for dashboard pages.
 * Place this inside the page content where you want the banner to appear.
 * Styled to match the auth pages error banner.
 */
export const FeatureDisabledBanner: React.FC<{
  featureName: string
  orgslug: string
}> = ({ featureName, orgslug }) => {
  const { t } = useTranslation()
  const org = useOrg() as any

  const featureConfig = org?.config?.config?.features?.[featureName]
  const isFeatureEnabled = featureConfig?.enabled !== false

  if (isFeatureEnabled) {
    return null
  }

  const featureDisplayName = t(`common.features.disabled.names.${featureName}`, featureName)

  return (
    <div className="w-full px-4 py-3 mb-4 flex items-center justify-between gap-3 bg-amber-500 text-white rounded-lg animate-in slide-in-from-top duration-200">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <AlertTriangle size={18} className="shrink-0" />
        <span className="text-sm font-medium">
          {t('common.features.disabled.dashboard.title', { feature: featureDisplayName })} · {t('common.features.disabled.dashboard.description')}
        </span>
      </div>
      <Link
        href={getUriWithOrg(orgslug, '/dash/org/settings/features')}
        className="flex items-center gap-2 px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-medium transition-colors shrink-0"
      >
        <Settings size={16} />
        {t('common.features.disabled.enable_feature')}
      </Link>
    </div>
  )
}

/**
 * Unified component for feature-disabled state.
 *
 * - Public context: Shows full-screen disabled message, hides children
 * - Dashboard context: Just renders children (use FeatureDisabledBanner separately)
 */
const FeatureDisabledView: React.FC<FeatureDisabledViewProps> = ({
  featureName,
  orgslug,
  icon: Icon,
  context,
  children,
}) => {
  const { t } = useTranslation()
  const org = useOrg() as any

  // Check if the feature is enabled
  // Default to true if not explicitly set to false (for backward compatibility)
  const featureConfig = org?.config?.config?.features?.[featureName]
  const isFeatureEnabled = featureConfig?.enabled !== false

  if (isFeatureEnabled) {
    return <>{children}</>
  }

  const featureDisplayName = t(`common.features.disabled.names.${featureName}`, featureName)

  // Dashboard: Show full-screen disabled view with settings link
  if (context === 'dashboard') {
    return (
      <div className="flex items-center justify-center min-h-[60vh] w-full p-6 bg-[#f8f8f8]">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-xl nice-shadow overflow-hidden">
            <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
              <div className="bg-gray-50 p-4 rounded-xl nice-shadow mb-6">
                {Icon ? (
                  <Icon className="w-10 h-10 text-gray-400" strokeWidth={1.5} />
                ) : (
                  <Ban className="w-10 h-10 text-gray-400" strokeWidth={1.5} />
                )}
              </div>

              <h2 className="text-xl font-bold text-gray-800 mb-2">
                {t('common.features.disabled.dashboard.title', { feature: featureDisplayName })}
              </h2>

              <p className="text-gray-500 text-sm mb-6 max-w-sm">
                {t('common.features.disabled.dashboard.description')}
              </p>

              <Link
                href={getUriWithOrg(orgslug, '/dash/org/settings/features')}
                className="flex items-center gap-2 px-4 py-2 bg-black text-white rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
              >
                <Settings size={16} />
                {t('common.features.disabled.enable_feature')}
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Public: Show full-screen disabled view
  return (
    <div className="flex items-center justify-center min-h-[60vh] w-full p-6 bg-[#f8f8f8]">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-xl nice-shadow overflow-hidden">
          <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
            <div className="bg-gray-50 p-4 rounded-xl nice-shadow mb-6">
              {Icon ? (
                <Icon className="w-10 h-10 text-gray-400" strokeWidth={1.5} />
              ) : (
                <Ban className="w-10 h-10 text-gray-400" strokeWidth={1.5} />
              )}
            </div>

            <h2 className="text-xl font-bold text-gray-800 mb-2">
              {t('common.features.disabled.public.title', { feature: featureDisplayName })}
            </h2>

            <p className="text-gray-500 text-sm mb-6 max-w-sm">
              {t('common.features.disabled.public.description')}
            </p>

            <div className="bg-gray-100 text-gray-600 px-4 py-2 rounded-lg text-sm font-medium">
              {t('common.features.disabled.status')}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default FeatureDisabledView
