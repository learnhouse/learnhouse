'use client'
import { useState, useCallback, useEffect } from 'react'

export type OnboardingStep = {
  id: string
  title: string
  description: string
  // CTA label + where it goes. `hrefType: 'root'` targets the org's public site
  // (the shareable school), everything else is a /dash/* path.
  action: string
  href: string
  hrefType?: 'org' | 'root'
  // Steps with no data signal complete when their CTA is clicked.
  completeOnClick?: boolean
  // Walkthrough video (see onboardingMedia.ts) and how long the step takes.
  video: string
  minutes: number
  completed: boolean
  requiredPlan?: string
  skipped?: boolean
}

// What the admin told us they are building. Tailors the copy, never the steps.
export type OnboardingIntent = 'customers' | 'team' | 'sell' | 'school'

type OnboardingState = {
  completedSteps: string[]
  skippedSteps: string[]
  minimized: boolean
  expanded: boolean
  showAllSteps: boolean
  dismissed: boolean
  welcomeSeen: boolean
  intent: OnboardingIntent | null
  // Steps whose completion has been celebrated, so a reload never replays it.
  celebrated: string[]
  // True once the org's existing data has been read the first time.
  seeded: boolean
}

const STORAGE_KEY = 'lh_onboarding'

// Outcome-framed onboarding: 6 milestones that ladder toward the north-star,
// your first enrolled learner, then retention. Each title is the WIN; the
// action is just the means. Every step delivers value on the free plan.
// Completion comes from the org's real data (useOnboardingSignals), so a step
// is done when the thing exists, not when its page was visited.
const DEFAULT_STEPS: Omit<OnboardingStep, 'completed'>[] = [
  {
    id: 'create_course',
    title: 'Your first course is live',
    description: 'Publish a course so there’s something real for learners to enroll in.',
    action: 'Create a course',
    href: '/dash/courses?new=true',
    video: 'ob2',
    minutes: 2,
  },
  {
    id: 'add_content',
    title: 'A lesson worth showing up for',
    description: 'Add a video, page or quiz to give learners a real reason to enroll.',
    action: 'Add content',
    href: '/dash/courses',
    video: 'ob3',
    minutes: 5,
  },
  {
    id: 'brand_school',
    title: 'A school learners trust',
    description: 'Add your logo and colors so it looks like a credible, professional school.',
    action: 'Brand it',
    href: '/dash/org/settings/branding',
    video: 'ob4',
    minutes: 2,
  },
  {
    id: 'share_grow',
    title: 'Your school’s front door',
    description: 'Go live and grab your shareable link, the place you’ll send every learner.',
    action: 'Open my school',
    href: '/',
    hrefType: 'root',
    completeOnClick: true,
    video: 'ob5',
    minutes: 1,
  },
  {
    id: 'invite_learners',
    title: 'Welcome your first learner',
    description: 'Share your join link or invite people to get that first learner through the door.',
    action: 'Invite learners',
    href: '/dash/users/settings/add',
    video: 'ob6',
    minutes: 2,
  },
  {
    id: 'build_community',
    title: 'Keep learners coming back',
    description: 'Open a community space so your learners stay active and bring their friends.',
    action: 'Open community',
    href: '/dash/communities',
    video: 'ob7',
    minutes: 2,
  },
]

export const ONBOARDING_STEP_DEFS = DEFAULT_STEPS

const EMPTY: OnboardingState = {
  completedSteps: [],
  skippedSteps: [],
  minimized: false,
  expanded: false,
  showAllSteps: false,
  dismissed: false,
  welcomeSeen: false,
  intent: null,
  celebrated: [],
  seeded: false,
}

function loadState(): OnboardingState {
  if (typeof window === 'undefined') return EMPTY
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
        intent: parsed.intent || null,
        celebrated: parsed.celebrated || [],
        seeded: parsed.seeded || false,
      }
    }
  } catch {
    /* ignore */
  }
  return EMPTY
}

function saveState(state: OnboardingState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    // Called from inside a state updater, which React may run while rendering:
    // tell the other instances after this render, not during it.
    queueMicrotask(() => window.dispatchEvent(new Event('lh_onboarding_change')))
  } catch {
    /* ignore */
  }
}

export function useOnboarding() {
  const [state, setState] = useState<OnboardingState>(loadState)

  const applyLocalChange = useCallback(
    (updater: (_prev: OnboardingState) => OnboardingState) => {
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
  const minutesLeft = steps.filter((s) => !s.completed).reduce((n, s) => n + s.minutes, 0)
  // Done by the user (not skipped) but not celebrated yet.
  const uncelebrated = state.completedSteps.filter(
    (id) => !state.celebrated.includes(id) && !state.skippedSteps.includes(id)
  )

  const completeStep = useCallback((stepId: string) => {
    applyLocalChange((prev) => {
      if (prev.completedSteps.includes(stepId)) return prev
      return { ...prev, completedSteps: [...prev.completedSteps, stepId] }
    })
  }, [applyLocalChange])

  // Batch completion from data signals. The first read seeds: whatever the org
  // already had (courses made before onboarding existed) completes silently,
  // and only later completions get a celebration.
  const completeSteps = useCallback((stepIds: string[]) => {
    applyLocalChange((prev) => {
      const fresh = stepIds.filter((id) => !prev.completedSteps.includes(id))
      if (!fresh.length && prev.seeded) return prev
      return {
        ...prev,
        seeded: true,
        completedSteps: [...prev.completedSteps, ...fresh],
        celebrated: prev.seeded ? prev.celebrated : [...prev.celebrated, ...fresh],
      }
    })
  }, [applyLocalChange])

  const markCelebrated = useCallback((stepIds: string[]) => {
    applyLocalChange((prev) => {
      const fresh = stepIds.filter((id) => !prev.celebrated.includes(id))
      if (!fresh.length) return prev
      return { ...prev, celebrated: [...prev.celebrated, ...fresh] }
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

  const resume = useCallback(() => {
    applyLocalChange((prev) => (prev.dismissed ? { ...prev, dismissed: false } : prev))
  }, [applyLocalChange])

  const markWelcomeSeen = useCallback(() => {
    applyLocalChange((prev) => (prev.welcomeSeen ? prev : { ...prev, welcomeSeen: true }))
  }, [applyLocalChange])

  const setIntent = useCallback((intent: OnboardingIntent) => {
    applyLocalChange((prev) => (prev.intent === intent ? prev : { ...prev, intent }))
  }, [applyLocalChange])

  const skipStep = useCallback((stepId: string) => {
    applyLocalChange((prev) => {
      if (prev.skippedSteps.includes(stepId)) return prev
      return { ...prev, skippedSteps: [...prev.skippedSteps, stepId] }
    })
  }, [applyLocalChange])

  const unskipStep = useCallback((stepId: string) => {
    applyLocalChange((prev) => {
      if (!prev.skippedSteps.includes(stepId)) return prev
      return { ...prev, skippedSteps: prev.skippedSteps.filter((id) => id !== stepId) }
    })
  }, [applyLocalChange])

  const reset = useCallback(() => {
    applyLocalChange(() => EMPTY)
  }, [applyLocalChange])

  return {
    steps,
    currentStep,
    currentStepIndex,
    allCompleted,
    progress,
    minutesLeft,
    uncelebrated,
    intent: state.intent,
    minimized: state.minimized,
    expanded: state.expanded,
    showAllSteps: state.showAllSteps,
    dismissed: state.dismissed,
    welcomeSeen: state.welcomeSeen,
    completeStep,
    completeSteps,
    markCelebrated,
    dismiss,
    resume,
    markWelcomeSeen,
    setIntent,
    toggleMinimized,
    toggleExpanded,
    toggleShowAllSteps,
    skipStep,
    unskipStep,
    reset,
  }
}
