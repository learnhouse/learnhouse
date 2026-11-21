import React from 'react'
import { useOrg } from '@components/Contexts/OrgContext'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { askAIAvailable, readAISettings, type AIFeatureKey, type AISettings } from '@/lib/ai/aiFeatures'

export type { AIFeatureKey, AISettings } from '@/lib/ai/aiFeatures'

/** The org's AI settings (Settings > AI), or null while the org loads. */
export function useAISettings(): AISettings | null {
  const org = useOrg() as any
  // An editor surface can turn AI off for its blocks (the learner page's
  // light editor: a learner's suggestion must not spend the org's credits).
  const editorOptions = useEditorProvider() as { allowAI?: boolean } | null
  const blocked = editorOptions?.allowAI === false
  return React.useMemo(() => {
    if (!org) return null
    const settings = readAISettings(org?.config?.config)
    if (!blocked) return settings
    const off = Object.fromEntries(Object.keys(settings.features).map((k) => [k, false])) as AISettings['features']
    return { ...settings, enabled: false, available: false, features: off }
  }, [org, blocked])
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
