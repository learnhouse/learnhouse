'use client'

import AtlasChat from '@components/Dashboard/Atlas/AtlasChat'
import PlanRestrictedFeature from '@components/Dashboard/Shared/PlanRestricted/PlanRestrictedFeature'
import { usePlan } from '@components/Hooks/usePlan'
import { GlobeStand } from '@phosphor-icons/react'
import React from 'react'

export default function AtlasPage() {
  const plan = usePlan()
  return (
    <PlanRestrictedFeature
      currentPlan={plan}
      requiredPlan="pro"
      customIcon={<GlobeStand size={32} weight="duotone" className="text-sky-600" />}
      titleKey="dashboard.atlas.pro_title"
      descriptionKey="dashboard.atlas.pro_description"
    >
      <AtlasChat />
    </PlanRestrictedFeature>
  )
}
