import { useOrg } from '@components/Contexts/OrgContext'
import React from 'react'

interface UseGetAIFeatures {
  feature: 'editor' | 'activity_ask' | 'course_ask' | 'global_ai_ask'
}

function useGetAIFeatures(props: UseGetAIFeatures) {
  const org = useOrg() as any

  return React.useMemo(() => {
    if (!org) return false

    const config = org?.config?.config
    const isV2 = config?.config_version?.startsWith('2')

    if (isV2) {
      // v2: prefer resolved_features, then admin_toggles
      if (config?.resolved_features?.ai) {
        return config.resolved_features.ai.enabled
      }
      return !config?.admin_toggles?.ai?.disabled
    }
    // v1 fallback
    return config?.features?.ai?.enabled ?? false
  }, [org, props.feature])
}

export default useGetAIFeatures
