'use client'
import { useState, useCallback, useEffect } from 'react'

export type OnboardingStep = {
  id: string
  title: string
  description: string
  completed: boolean
  requiredPlan?: string
  skipped?: boolean
}

type OnboardingState = {
  completedSteps: string[]
  skippedSteps: string[]
  minimized: boolean
  expanded: boolean
  showAllSteps: boolean
  dismissed: boolean
  welcomeSeen: boolean
}

const STORAGE_KEY = 'lh_onboarding'

const DEFAULT_STEPS: Omit<OnboardingStep, 'completed'>[] = [
  {
    id: 'create_course',
    title: 'Create your first course',
    description: 'Start by creating a new course for your learners.',
  },
  {
    id: 'add_activities',
    title: 'Add activities to your course',
    description: 'Add content like pages, videos, documents and more.',
  },
  {
    id: 'experience_editor',
    title: 'Experience the editor',
    description: 'Open the editor and learn how to build your course content.',
  },
  {
    id: 'try_playgrounds',
    title: 'Interactive learning with Playgrounds',
    description: 'Build interactive pages for self-paced learning.',
    requiredPlan: 'pro' as const,
  },
  {
    id: 'invite_users',
    title: 'Invite your team & learners',
    description: 'Add instructors or share a link for learners to join.',
  },
  {
    id: 'customize_org',
    title: 'Customize your organization',
    description: 'Add your logo, colors and make it yours.',
  },
  {
    id: 'teach_the_world',
    title: 'Learn & grow',
    description: 'Resources to help you get the most out of LearnHouse.',
  },
]

function loadState(): OnboardingState {
  if (typeof window === 'undefined') {
    return { completedSteps: [], skippedSteps: [], minimized: false, expanded: false, showAllSteps: false, dismissed: false, welcomeSeen: false }
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        completedSteps: parsed.completedSteps || [],
        skippedSteps: parsed.skippedSteps || [],
        minimized: parsed.minimized || false,
        expanded: parsed.expanded || false,
        showAllSteps: parsed.showAllSteps || false,
        dismissed: parsed.dismissed || false,
        welcomeSeen: parsed.welcomeSeen || false,
      }
    }
  } catch {}
  return { completedSteps: [], skippedSteps: [], minimized: false, expanded: false, showAllSteps: false, dismissed: false, welcomeSeen: false }
}

function saveState(state: OnboardingState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    window.dispatchEvent(new Event('lh_onboarding_change'))
  } catch {}
}

export function useOnboarding() {
  const [state, setState] = useState<OnboardingState>(loadState)

  const applyLocalChange = useCallback(
    (updater: (prev: OnboardingState) => OnboardingState) => {
      setState((prev) => {
        const next = updater(prev)
        if (next !== prev) {
          saveState(next)
        }
        return next
      })
    },
    []
  )

  // Listen for changes from other instances of this hook
  useEffect(() => {
    const handler = () => {
      setState((prev) => {
        const loaded = loadState()
        if (JSON.stringify(loaded) === JSON.stringify(prev)) return prev
        return loaded
      })
    }
    window.addEventListener('lh_onboarding_change', handler)
    return () => window.removeEventListener('lh_onboarding_change', handler)
  }, [])

  const steps: OnboardingStep[] = DEFAULT_STEPS.map((s) => ({
    ...s,
    completed: state.completedSteps.includes(s.id) || state.skippedSteps.includes(s.id),
    skipped: state.skippedSteps.includes(s.id),
  }))

  const currentStepIndex = steps.findIndex((s) => !s.completed)
  const currentStep = currentStepIndex >= 0 ? steps[currentStepIndex] : null
  const allCompleted = steps.every((s) => s.completed)
  const progress = steps.length > 0 ? steps.filter((s) => s.completed).length / steps.length : 0

  const completeStep = useCallback((stepId: string) => {
    applyLocalChange((prev) => {
      if (prev.completedSteps.includes(stepId)) return prev
      return { ...prev, completedSteps: [...prev.completedSteps, stepId] }
    })
  }, [applyLocalChange])

  const toggleMinimized = useCallback(() => {
    applyLocalChange((prev) => ({ ...prev, minimized: !prev.minimized }))
  }, [applyLocalChange])

  const toggleExpanded = useCallback(() => {
    applyLocalChange((prev) => ({ ...prev, expanded: !prev.expanded }))
  }, [applyLocalChange])

  const toggleShowAllSteps = useCallback(() => {
    applyLocalChange((prev) => ({ ...prev, showAllSteps: !prev.showAllSteps }))
  }, [applyLocalChange])

  const dismiss = useCallback(() => {
    applyLocalChange((prev) => (prev.dismissed ? prev : { ...prev, dismissed: true }))
  }, [applyLocalChange])

  const markWelcomeSeen = useCallback(() => {
    applyLocalChange((prev) => (prev.welcomeSeen ? prev : { ...prev, welcomeSeen: true }))
  }, [applyLocalChange])

  const skipStep = useCallback((stepId: string) => {
    applyLocalChange((prev) => {
      if (prev.skippedSteps.includes(stepId)) return prev
      return { ...prev, skippedSteps: [...prev.skippedSteps, stepId] }
    })
  }, [applyLocalChange])

  const reset = useCallback(() => {
    applyLocalChange(() => ({ completedSteps: [], skippedSteps: [], minimized: false, expanded: false, showAllSteps: false, dismissed: false, welcomeSeen: false }))
  }, [applyLocalChange])

  return {
    steps,
    currentStep,
    currentStepIndex,
    allCompleted,
    progress,
    minimized: state.minimized,
    expanded: state.expanded,
    showAllSteps: state.showAllSteps,
    dismissed: state.dismissed,
    welcomeSeen: state.welcomeSeen,
    completeStep,
    dismiss,
    markWelcomeSeen,
    toggleMinimized,
    toggleExpanded,
    toggleShowAllSteps,
    skipStep,
    reset,
  }
}
