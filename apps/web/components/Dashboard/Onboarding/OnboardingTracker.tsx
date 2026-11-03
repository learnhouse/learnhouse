'use client'
import { useEffect } from 'react'
import { useOnboarding } from '@components/Hooks/useOnboarding'
import { useOnboardingSignals } from '@components/Hooks/useOnboardingSignals'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'

/**
 * Headless tracker, mounted across the dashboard. Ticks onboarding steps off
 * from the org's real data (see useOnboardingSignals) while setup is running.
 */
export default function OnboardingTracker() {
  const { completeSteps, steps, dismissed, allCompleted } = useOnboarding()
  const { ready, done } = useOnboardingSignals(!dismissed && !allCompleted)
  const { track } = useLHAnalytics('dashboard')
  const key = done.join(',')

  useEffect(() => {
    if (!ready) return
    for (const id of done) {
      if (!steps.find((s) => s.id === id)?.completed) {
        track(AnalyticsEvent.OnboardingStepCompleted, { step_id: id })
      }
    }
    completeSteps(done)
    // `key` stands in for `done`, a new array every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, key, completeSteps])

  return null
}
