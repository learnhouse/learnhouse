import { useOrg } from '@components/Contexts/OrgContext'
import React from 'react'

interface UseGetAIFeatures {
  feature: 'editor' | 'activity_ask' | 'course_ask' | 'global_ai_ask',
}


function useGetAIFeatures(props: UseGetAIFeatures) {
  const org = useOrg() as any
  const [isEnabled, setisEnabled] = React.useState(false)

  function checkAvailableAIFeaturesOnOrg(feature: string) {
    const config = org?.config?.config?.AIConfig;

    if (!config) {
      console.log("AI or Organization config is not defined.");
      return false;
    }

    if (!config.enabled) {
      console.log("AI is not enabled for this Organization.");
      return false;
    }

    if (!config.features[feature]) {
      console.log(`Feature ${feature} is not enabled for this Organization.`);
      return false;
    }

    return true;
  }

  React.useEffect(() => {
    if (org) { // Check if org is not null or undefined
      let isEnabledStatus = checkAvailableAIFeaturesOnOrg(props.feature)
      setisEnabled(isEnabledStatus)
    }
  }, [org])

  return isEnabled

}

export default useGetAIFeatures