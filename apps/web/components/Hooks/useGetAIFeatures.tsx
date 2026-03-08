import { useOrg } from '@components/Contexts/OrgContext'
import React from 'react'

interface UseGetAIFeatures {
  feature: 'editor' | 'activity_ask' | 'course_ask' | 'global_ai_ask'
}

function useGetAIFeatures(props: UseGetAIFeatures) {
  const org = useOrg() as any
  const [isEnabled, setisEnabled] = React.useState(false)

  function checkAvailableAIFeaturesOnOrg(feature: string) {
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
    return config?.features?.ai?.enabled
  }

  React.useEffect(() => {
    if (org) {
      // Check if org is not null or undefined
      let isEnabledStatus = checkAvailableAIFeaturesOnOrg(props.feature)
      setisEnabled(isEnabledStatus)
    }
  }, [org])

  return isEnabled
}

export default useGetAIFeatures
