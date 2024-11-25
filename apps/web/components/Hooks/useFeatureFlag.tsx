import { useOrg } from '@components/Contexts/OrgContext'
import { useEffect, useState } from 'react'

type FeatureType = {
  path: string[]
  defaultValue?: boolean
}

function useFeatureFlag(feature: FeatureType) {
  const org = useOrg() as any
  const [isEnabled, setIsEnabled] = useState<boolean>(!!feature.defaultValue)

  useEffect(() => {
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

      setIsEnabled(!!currentValue)
    } else {
      setIsEnabled(!!feature.defaultValue)
    }
  }, [org, feature])

  return isEnabled
}

export default useFeatureFlag