import { useAskAIAvailable, useAISettings } from '@components/Hooks/useAIFeature'

interface UseGetAIFeatures {
  feature: 'editor' | 'activity_ask' | 'course_ask' | 'global_ai_ask'
}

// Older entry points ask by surface name; each maps to its switch in
// Settings > AI (see useAIFeature).
function useGetAIFeatures(props: UseGetAIFeatures) {
  const settings = useAISettings()
  const askAI = useAskAIAvailable()
  if (!settings) return false
  if (props.feature === 'editor') return settings.features.editor_ai
  return askAI
}

export default useGetAIFeatures
