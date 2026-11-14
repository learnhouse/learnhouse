'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { summarize } from '@/lib/onboarding'
import {
  getOnboardingState,
  onboardingKeys,
  patchOnboardingState,
  recordOnboardingEvent,
  type OnboardingEvent,
  type OnboardingGoal,
  type OnboardingPatch,
  type OnboardingState,
} from '@services/onboarding/onboarding'

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
  skipped?: boolean
}

// What the admin told us they are building. It orders the steps and picks
// the starter template; it never hides a feature.
export type OnboardingIntent = OnboardingGoal

// Client-side presentation of each setup step: where its action goes and its
// walkthrough. Which steps an org gets, in which order, and whether each is
// done all come from the server (GET /onboarding/orgs/{id}).
const STEP_DEFS: Record<string, Omit<OnboardingStep, 'completed' | 'minutes'>> = {
  create_course: { id: 'create_course', title: '', description: '', action: '', href: '/dash/courses?new=true', video: 'ob2' },
  add_content: { id: 'add_content', title: '', description: '', action: '', href: '/dash/courses', video: 'ob3' },
  publish_course: { id: 'publish_course', title: '', description: '', action: '', href: '/dash/courses', video: 'ob2' },
  brand_school: { id: 'brand_school', title: '', description: '', action: '', href: '/dash/org/settings/branding', video: 'ob4' },
  // Done once the homepage is published (the template starter does it).
  share_grow: { id: 'share_grow', title: '', description: '', action: '', href: '/dash/website', video: 'ob5' },
  invite_learners: { id: 'invite_learners', title: '', description: '', action: '', href: '/dash/users/settings/add', video: 'ob6' },
  build_community: { id: 'build_community', title: '', description: '', action: '', href: '/dash/communities', video: 'ob7' },
  create_group: { id: 'create_group', title: '', description: '', action: '', href: '/dash/users/settings/usergroups', video: 'ob6' },
  setup_payments: { id: 'setup_payments', title: '', description: '', action: '', href: '/dash/payments/settings', completeOnClick: true, video: 'ob5' },
}

export const ONBOARDING_STEP_DEFS = Object.values(STEP_DEFS)

// Per-browser view preferences only. The legacy `dismissed` / `welcomeSeen`
// flags from when the whole plan lived here still count as "put away" for
// this browser, so nobody who closed it before gets it back.
const STORAGE_KEY = 'lh_onboarding'
type LocalPrefs = { minimized: boolean; expanded: boolean; showAllSteps: boolean; dismissed: boolean; welcomeSeen: boolean }
const EMPTY_PREFS: LocalPrefs = { minimized: false, expanded: false, showAllSteps: false, dismissed: false, welcomeSeen: false }

function loadPrefs(): LocalPrefs {
  if (typeof window === 'undefined') return EMPTY_PREFS
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return {
      minimized: !!parsed.minimized,
      expanded: !!parsed.expanded,
      showAllSteps: !!parsed.showAllSteps,
      dismissed: !!parsed.dismissed,
      welcomeSeen: !!parsed.welcomeSeen,
    }
  } catch {
    return EMPTY_PREFS
  }
}

function savePrefs(prefs: LocalPrefs) {
  try {
    const prev = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...prev, ...prefs }))
    queueMicrotask(() => window.dispatchEvent(new Event('lh_onboarding_change')))
  } catch {
    /* ignore */
  }
}

export function useOnboardingQuery() {
  const org = useOrg() as any
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const orgId: number | undefined = org?.id
  const query = useQuery({
    queryKey: onboardingKeys.state(orgId),
    queryFn: () => getOnboardingState(token, orgId as number),
    enabled: !!token && !!orgId && !org?.is_demo,
    // Short: a step finished in another tab ticks off when the admin comes back.
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    // A non-admin gets 403: no checklist for them, and no retry storm.
    retry: false,
  })
  return { query, token, orgId }
}

export function useOnboarding() {
  const { query, token, orgId } = useOnboardingQuery()
  const queryClient = useQueryClient()
  const [prefs, setPrefs] = useState<LocalPrefs>(loadPrefs)
  const data: OnboardingState | undefined = query.data

  useEffect(() => {
    const handler = () => setPrefs(loadPrefs())
    window.addEventListener('lh_onboarding_change', handler)
    return () => window.removeEventListener('lh_onboarding_change', handler)
  }, [])

  const updatePrefs = useCallback((change: Partial<LocalPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...change }
      savePrefs(next)
      return next
    })
  }, [])

  const key = onboardingKeys.state(orgId)

  // Optimistic: the change shows at once, the server's answer replaces it.
  const patch = useCallback(
    async (body: OnboardingPatch, optimistic?: (_s: OnboardingState) => OnboardingState) => {
      if (!orgId) return
      if (optimistic) queryClient.setQueryData<OnboardingState>(key, (s) => (s ? optimistic(s) : s))
      try {
        const next = await patchOnboardingState(token, orgId, body)
        queryClient.setQueryData(key, next)
      } catch {
        queryClient.invalidateQueries({ queryKey: key })
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orgId, token, queryClient],
  )

  const record = useCallback(
    async (event: OnboardingEvent) => {
      if (!orgId) return
      try {
        await recordOnboardingEvent(token, orgId, event)
      } finally {
        queryClient.invalidateQueries({ queryKey: key })
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orgId, token, queryClient],
  )

  const steps: OnboardingStep[] = useMemo(
    () =>
      (data?.steps ?? []).map((s) => ({
        ...(STEP_DEFS[s.id] ?? { id: s.id, title: '', description: '', action: '', href: '/dash', video: 'ob1' }),
        minutes: s.minutes,
        completed: s.done || s.skipped,
        skipped: s.skipped,
      })),
    [data?.steps],
  )

  const { currentStepIndex, allCompleted, progress, minutesLeft } = summarize(steps)
  const currentStep = steps.find((s) => s.id === data?.next_step) ?? (currentStepIndex >= 0 ? steps[currentStepIndex] : null)
  const loaded = !!data

  // Until the server answers, treat the plan as put away so nothing flashes.
  const dismissed = !loaded || data.dismissed || prefs.dismissed
  const welcomeSeen = !loaded || data.welcome_seen || prefs.welcomeSeen

  const completeStep = useCallback(
    (stepId: string) => {
      if (STEP_DEFS[stepId]?.completeOnClick) record(stepId as OnboardingEvent)
    },
    [record],
  )

  // Completion comes from the server's view of the org's data: just refresh.
  const completeSteps = useCallback(
    (_ids: string[]) => {
      queryClient.invalidateQueries({ queryKey: key })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient, orgId],
  )

  const markCelebrated = useCallback(
    (ids: string[]) => {
      if (!ids.length) return
      patch({ celebrated: ids }, (s) => ({ ...s, celebrate: s.celebrate.filter((id) => !ids.includes(id)) }))
    },
    [patch],
  )

  const dismiss = useCallback(() => {
    patch({ dismissed: true }, (s) => ({ ...s, dismissed: true }))
  }, [patch])

  const resume = useCallback(() => {
    updatePrefs({ dismissed: false })
    patch({ dismissed: false }, (s) => ({ ...s, dismissed: false }))
  }, [patch, updatePrefs])

  const markWelcomeSeen = useCallback(() => {
    updatePrefs({ welcomeSeen: true })
    patch({ welcome_seen: true }, (s) => ({ ...s, welcome_seen: true }))
  }, [patch, updatePrefs])

  const setIntent = useCallback(
    (intent: OnboardingIntent) => {
      patch({ goal: intent }, (s) => ({ ...s, goal: intent }))
    },
    [patch],
  )

  const skipStep = useCallback(
    (stepId: string) => {
      patch({ skip: stepId }, (s) => ({ ...s, steps: s.steps.map((x) => (x.id === stepId ? { ...x, skipped: true } : x)) }))
    },
    [patch],
  )

  const unskipStep = useCallback(
    (stepId: string) => {
      patch({ unskip: stepId }, (s) => ({ ...s, steps: s.steps.map((x) => (x.id === stepId ? { ...x, skipped: false } : x)) }))
    },
    [patch],
  )

  const toggleMinimized = useCallback(() => updatePrefs({ minimized: !prefs.minimized }), [prefs.minimized, updatePrefs])
  const toggleExpanded = useCallback(() => updatePrefs({ expanded: !prefs.expanded }), [prefs.expanded, updatePrefs])
  const toggleShowAllSteps = useCallback(() => updatePrefs({ showAllSteps: !prefs.showAllSteps }), [prefs.showAllSteps, updatePrefs])

  const reset = useCallback(() => {
    updatePrefs(EMPTY_PREFS)
    patch({ dismissed: false, welcome_seen: false })
  }, [patch, updatePrefs])

  return {
    loaded,
    state: data,
    steps,
    currentStep,
    currentStepIndex,
    allCompleted: loaded && allCompleted,
    progress,
    minutesLeft,
    uncelebrated: data?.celebrate ?? [],
    intent: (data?.goal ?? null) as OnboardingIntent | null,
    plan: data?.plan ?? null,
    mode: data?.mode ?? null,
    recommendedPlan: data?.recommended_plan ?? null,
    invitesGate: data?.invites ?? { gated: false, unlocks_at: null },
    minimized: prefs.minimized,
    expanded: prefs.expanded,
    showAllSteps: prefs.showAllSteps,
    dismissed,
    welcomeSeen,
    completeStep,
    completeSteps,
    markCelebrated,
    recordEvent: record,
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
