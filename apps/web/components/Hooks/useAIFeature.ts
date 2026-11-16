import React from 'react'
import { useOrg } from '@components/Contexts/OrgContext'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { askAIAvailable, readAISettings, type AIFeatureKey, type AISettings } from '@/lib/ai/aiFeatures'

export type { AIFeatureKey, AISettings } from '@/lib/ai/aiFeatures'

/** The org's AI settings (Settings > AI), or null while the org loads. */
export function useAISettings(): AISettings | null {
  const org = useOrg() as any
  return React.useMemo(() => (org ? readAISettings(org?.config?.config) : null), [org])
}

/** Whether an AI surface is on for this org (master switch included). False while the org loads. */
export default function useAIFeature(key: AIFeatureKey): boolean {
  const settings = useAISettings()
  return Boolean(settings?.features[key])
}

/** Learner Ask AI for the current member (honours "course staff only"). */
export function useAskAIAvailable(): boolean {
  const settings = useAISettings()
  const { isAdmin } = useAdminStatus()
  return askAIAvailable(settings, isAdmin)
}
