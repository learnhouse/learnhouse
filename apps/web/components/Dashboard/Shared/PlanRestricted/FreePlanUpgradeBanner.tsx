'use client'

import React, { useState } from 'react'
import { StarFour } from '@phosphor-icons/react'
import { usePlan } from '@components/Hooks/usePlan'
import { useOrg } from '@components/Contexts/OrgContext'
import { getUpgradeUrl } from '@services/config/config'
import { useTranslation } from 'react-i18next'
import UpgradeModal from './UpgradeModal'

export default function FreePlanUpgradeBanner() {
  const { t } = useTranslation()
  const plan = usePlan()
  const org = useOrg() as any
  const upgradeUrl = getUpgradeUrl(org?.slug || 'default')
  const [modalOpen, setModalOpen] = useState(false)

  if (plan !== 'free' || !upgradeUrl) return null

  return (
    <>
      <div
        className="sticky top-0 z-10 w-full overflow-hidden bg-sky-100 border-b border-sky-200 px-4 py-1.5 flex items-center justify-center gap-3"
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `repeating-linear-gradient(-45deg, transparent, transparent 8px, rgba(14,165,233,0.08) 8px, rgba(14,165,233,0.08) 9px)`,
          }}
        />
        <StarFour size={14} weight="duotone" className="relative text-sky-600 flex-shrink-0" />
        <p className="relative text-xs font-medium text-sky-800">
          {t('banner.free_plan_upgrade')}
        </p>
        <button
          onClick={() => setModalOpen(true)}
          className="relative text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 px-3 py-1 rounded-md flex-shrink-0 transition-colors cursor-pointer"
        >
          {t('banner.free_plan_upgrade_button')}
        </button>
      </div>
      <UpgradeModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  )
}
