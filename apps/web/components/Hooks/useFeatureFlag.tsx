import { useOrg } from '@components/Contexts/OrgContext'
import { useMemo } from 'react'

type FeatureType = {
  path: string[]
  defaultValue?: boolean
}

function useFeatureFlag(feature: FeatureType) {
  const org = useOrg() as any

  // Derived directly from org config — computing during render avoids the
  // extra "stale then corrected" render cycle the old effect+setState caused.
  return useMemo(() => {
    if (org?.config?.config) {
      let currentValue = org.config.config

      // Traverse the path to get the feature flag value
      for (const key of feature.path) {
        if (currentValue && typeof currentValue === 'object') {
          currentValue = currentValue[key]
        } else {
          currentValue = feature.defaultValue || false
          break
        }
      }

      return !!currentValue
    }
    return !!feature.defaultValue
  }, [org, feature])
}

export default useFeatureFlag
