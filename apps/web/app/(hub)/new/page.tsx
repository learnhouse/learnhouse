'use client'

import React, { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle,
  CircleNotch,
  Info,
  PencilSimple,
  SignOut,
  Sparkle,
  Browser,
  FileDashed,
} from '@phosphor-icons/react'

import { useLHSession } from '@components/Contexts/LHSessionContext'
import { signOut } from '@components/Contexts/AuthContext'
import UserAvatar from '@components/Objects/UserAvatar'
import DemoEntryCard from '@components/Objects/Demo/DemoEntryCard'
import PendingInvites from '@components/Onboarding/PendingInvites'
import { INTENTS } from '@components/Dashboard/Onboarding/onboardingCopy'
import { useLHAnalytics } from '@services/analytics/useLHAnalytics'
import { AnalyticsEvent } from '@services/analytics/events'
import {
  getCustomDomainFromContext,
  getLEARNHOUSE_DOMAIN_VAL,
  getUpgradeUrl,
  getUriWithOrg,
} from '@services/config/config'
import { detailMessage } from '@services/utils/ts/requests'
import {
  applyStarter,
  checkSlug,
  createOrgWithOnboarding,
  getHubSummary,
  onboardingKeys,
  recordOnboardingEvent,
  type OnboardingGoal,
  type SlugCheck,
} from '@services/onboarding/onboarding'
import { Button, INPUT } from '@/design'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'

type Step = 'goal' | 'name' | 'start'
const STEPS: Step[] = ['goal', 'name', 'start']

// Template each goal starts from (mirrors services/onboarding/goals.py), for
// the name shown on the "start from a template" card.
const GOAL_TEMPLATE: Record<OnboardingGoal | 'none', string> = {
  sell: 'coach',
  team: 'corporate',
  school: 'university',
  customers: 'partner',
  community: 'membership',
  none: 'academy',
}

const slide = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 24 }),
  center: { opacity: 1, x: 0 },
  exit: (dir: number) => ({ opacity: 0, x: dir * -24 }),
}
const trans = { duration: 0.24, ease: [0.4, 0, 0.2, 1] as any }

function StepDots({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-center gap-1.5" aria-hidden>
      {STEPS.map((_, i) => (
        <motion.span
          key={i}
          className="h-1.5 rounded-full bg-neutral-200"
          initial={false}
          animate={{ width: i === current ? 24 : 7, backgroundColor: i <= current ? '#111827' : '#e5e7eb' }}
          transition={{ duration: 0.3 }}
        />
      ))}
    </div>
  )
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}

/** Where the new org lives, from the apex or from another org's custom domain. */
function orgUrl(slug: string, path: string) {
  return getCustomDomainFromContext()
    ? `${window.location.protocol}//${slug}.${getLEARNHOUSE_DOMAIN_VAL()}${path}`
    : getUriWithOrg(slug, path)
}

// ── Step 1: goal ────────────────────────────────────────────────────────────

function GoalStep({ goal, onPick, onSkip }: { goal: OnboardingGoal | null; onPick: (_g: OnboardingGoal) => void; onSkip: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2" role="radiogroup" aria-label={t('onb2.new.goal_title')}>
        {INTENTS.map((it) => {
          const on = goal === it.id
          return (
            <motion.button
              key={it.id}
              type="button"
              role="radio"
              aria-checked={on}
              data-goal={it.id}
              whileTap={{ scale: 0.985 }}
              onClick={() => onPick(it.id)}
              className={[
                'group relative flex items-start gap-3 rounded-2xl bg-white p-4 text-start transition-all',
                on ? 'ring-2 ring-neutral-900' : 'nice-shadow hover:shadow-md',
              ].join(' ')}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neutral-50 text-neutral-700">
                <it.icon size={20} weight="duotone" />
              </span>
              <span className="min-w-0 pe-5">
                <span className="block text-sm font-semibold text-neutral-900">{t(`onboarding.intent.${it.id}.label`)}</span>
                <span className="mt-0.5 block text-xs leading-snug text-neutral-500">{t(`onboarding.intent.${it.id}.hint`)}</span>
              </span>
              <ArrowRight
                size={14}
                weight="bold"
                className="absolute end-4 top-1/2 -translate-y-1/2 text-neutral-300 transition-colors group-hover:text-neutral-700 rtl:rotate-180"
              />
            </motion.button>
          )
        })}
      </div>
      <button type="button" onClick={onSkip} className="mx-auto text-xs text-neutral-400 underline-offset-2 hover:text-neutral-600 hover:underline">
        {t('onb2.new.goal_skip')}
      </button>
      <DemoEntryCard className="mt-2" />
    </div>
  )
}

// ── Step 2: name (the address follows) ──────────────────────────────────────

function NameStep({
  token,
  submitting,
  error,
  onBack,
  onSubmit,
}: {
  token?: string
  submitting: boolean
  error: { message: string; capReached?: boolean } | null
  onBack: () => void
  onSubmit: (_v: { name: string; slug: string }) => void
}) {
  const { t } = useTranslation()
  const { track } = useLHAnalytics('hub')
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [editing, setEditing] = useState(false)
  const slugEdited = useRef(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const debouncedName = useDebounced(name.trim(), 300)
  const debouncedSlug = useDebounced(slug.trim().toLowerCase(), 300)
  const domain = getLEARNHOUSE_DOMAIN_VAL()

  useEffect(() => nameRef.current?.focus(), [])

  const check = useQuery<SlugCheck>({
    queryKey: ['onboarding', 'slug', debouncedName, slugEdited.current ? debouncedSlug : ''],
    queryFn: () => checkSlug(token, debouncedName || 'academy', slugEdited.current ? debouncedSlug : undefined),
    enabled: !!token && (!!debouncedName || (slugEdited.current && !!debouncedSlug)),
    staleTime: 10_000,
  })

  // Until the admin types their own, the address is the free one nearest the name.
  useEffect(() => {
    if (!slugEdited.current && check.data?.suggestion) setSlug(check.data.suggestion)
  }, [check.data?.suggestion])

  const checking = check.isFetching || debouncedName !== name.trim() || (slugEdited.current && debouncedSlug !== slug.trim().toLowerCase())
  const problem = slugEdited.current && check.data && !check.data.available ? check.data.reason : null
  const canSubmit = !!name.trim() && !!slug && !problem && !checking && !submitting

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (canSubmit) onSubmit({ name: name.trim(), slug })
      }}
    >
      <div className="rounded-2xl bg-white p-5 nice-shadow sm:p-6">
        {error && (
          <div className="mb-4 flex items-start gap-2.5 rounded-xl bg-rose-50 px-3.5 py-3 text-sm text-rose-700" role="alert">
            <Info size={15} className="mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p>{error.message}</p>
              {error.capReached && (
                <Link href="/home" className="mt-1 inline-block font-semibold underline underline-offset-2">
                  {t('onb2.new.cap_manage')}
                </Link>
              )}
            </div>
          </div>
        )}
        <label htmlFor="org-name" className="mb-1.5 block text-sm font-semibold text-neutral-800">
          {t('onb2.new.name_label')}
        </label>
        <input
          id="org-name"
          ref={nameRef}
          name="name"
          value={name}
          maxLength={100}
          autoComplete="organization"
          onChange={(e) => setName(e.target.value)}
          placeholder={t('onb2.new.name_placeholder')}
          className={`${INPUT} h-11 text-[15px]`}
        />

        <div className="mt-3 min-h-[28px] text-sm" aria-live="polite">
          {!editing ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-neutral-500">
              <span>{t('onb2.new.address')}</span>
              <span className="font-medium text-neutral-900" data-testid="org-address" dir="ltr">
                {slug || 'your-academy'}.{domain}
              </span>
              {name.trim() &&
                (checking ? (
                  <CircleNotch size={13} className="animate-spin text-neutral-400" />
                ) : slug ? (
                  <CheckCircle size={14} weight="fill" className="text-emerald-600" aria-label={t('onb2.new.available')} />
                ) : null)}
              <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1 text-xs font-semibold text-neutral-500 hover:text-neutral-900">
                <PencilSimple size={12} />
                {t('onb2.new.change')}
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center overflow-hidden rounded-xl ring-1 ring-inset ring-neutral-200 focus-within:ring-2 focus-within:ring-neutral-900/15" dir="ltr">
                <input
                  name="slug"
                  value={slug}
                  maxLength={40}
                  onChange={(e) => {
                    slugEdited.current = true
                    track(AnalyticsEvent.OnboardingSlugEdited, {})
                    setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
                  }}
                  className="h-9 min-w-0 flex-1 bg-white px-3 text-sm focus:outline-none"
                  aria-label={t('onb2.new.address')}
                />
                <span className="shrink-0 border-s border-neutral-100 bg-neutral-50 px-3 py-2 text-xs text-neutral-400">.{domain}</span>
              </div>
              {problem ? (
                <p className="text-xs text-rose-600">
                  {t(`onb2.new.slug_${problem}`)}{' '}
                  {check.data?.suggestion && (
                    <button
                      type="button"
                      className="font-semibold underline underline-offset-2"
                      onClick={() => {
                        setSlug(check.data!.suggestion)
                      }}
                    >
                      {t('onb2.new.use_suggestion', { slug: check.data.suggestion })}
                    </button>
                  )}
                </p>
              ) : (
                <p className="text-xs text-neutral-400">{t('onb2.new.slug_hint')}</p>
              )}
            </div>
          )}
        </div>

        <Button type="submit" variant="primary" size="lg" className="mt-5 w-full justify-center" loading={submitting} disabled={!canSubmit}>
          {submitting ? t('onb2.new.creating') : t('onb2.new.create')}
          {!submitting && <ArrowRight size={15} weight="bold" className="rtl:rotate-180" />}
        </Button>
        <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-neutral-400">
          <Check size={12} weight="bold" className="text-emerald-600" />
          {t('onb2.new.free_note')}
        </p>
      </div>
      <button type="button" onClick={onBack} className="inline-flex w-fit items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800">
        <ArrowLeft size={14} className="rtl:rotate-180" />
        {t('hub_new.navigation.back')}
      </button>
    </form>
  )
}

// ── Step 3: how to start ────────────────────────────────────────────────────

function StartStep({
  goal,
  busy,
  onTemplate,
  onBlank,
}: {
  goal: OnboardingGoal | null
  busy: 'template' | 'blank' | null
  onTemplate: () => void
  onBlank: () => void
}) {
  const { t } = useTranslation()
  const template = GOAL_TEMPLATE[goal ?? 'none']
  const card =
    'relative flex w-full items-start gap-4 rounded-2xl bg-white p-5 text-start nice-shadow transition-all hover:shadow-md disabled:opacity-60'
  return (
    <div className="flex flex-col gap-3">
      <button type="button" className={`${card} ring-2 ring-neutral-900`} onClick={onTemplate} disabled={!!busy} data-start="template">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-neutral-900 text-white">
          {busy === 'template' ? <CircleNotch size={20} className="animate-spin" /> : <Browser size={20} weight="duotone" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-neutral-900">{t('onb2.new.start_template')}</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-neutral-900 px-2 py-0.5 text-[10px] font-semibold text-white">
              <Sparkle size={9} weight="fill" />
              {t('onb2.plans.recommended')}
            </span>
          </span>
          <span className="mt-1 block text-xs leading-relaxed text-neutral-500">
            {t('onb2.new.start_template_desc', { template: t(`landingBuilder.templates.${template}.name`) })}
          </span>
        </span>
      </button>
      <button type="button" className={card} onClick={onBlank} disabled={!!busy} data-start="blank">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-600">
          {busy === 'blank' ? <CircleNotch size={20} className="animate-spin" /> : <FileDashed size={20} weight="duotone" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-neutral-900">{t('onb2.new.start_blank')}</span>
          <span className="mt-1 block text-xs leading-relaxed text-neutral-500">{t('onb2.new.start_blank_desc')}</span>
        </span>
      </button>
    </div>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function CreateNewOrgPage() {
  const { t } = useTranslation()
  const router = useRouter()
  const queryClient = useQueryClient()
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const isAuthenticated = session?.status === 'authenticated'
  const isLoading = session?.status === 'loading'
  const { track } = useLHAnalytics('hub')

  const [step, setStep] = useState<Step>('goal')
  const [dir, setDir] = useState(1)
  const [goal, setGoal] = useState<OnboardingGoal | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<{ message: string; capReached?: boolean } | null>(null)
  const [created, setCreated] = useState<{ id: number; slug: string } | null>(null)
  const [starting, setStarting] = useState<'template' | 'blank' | null>(null)
  // A plan picked on the pricing page before signing up (?plan=standard).
  const [planIntent, setPlanIntent] = useState<string | null>(null)

  useEffect(() => {
    setPlanIntent(new URLSearchParams(window.location.search).get('plan'))
    track(AnalyticsEvent.OnboardingStarted, { version: 2 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace('/login')
  }, [isLoading, isAuthenticated, router])

  const hub = useQuery({
    queryKey: onboardingKeys.hub(),
    queryFn: () => getHubSummary(token),
    enabled: isAuthenticated && !!token,
    staleTime: 30_000,
  })
  const invites = hub.data?.invites ?? []

  const go = (next: Step, direction = 1) => {
    setDir(direction)
    setStep(next)
  }

  const pickGoal = (g: OnboardingGoal | null) => {
    setGoal(g)
    track(AnalyticsEvent.OnboardingGoalSelected, { goal: g ?? 'none' })
    go('name')
  }

  const create = async ({ name, slug }: { name: string; slug: string }) => {
    setSubmitting(true)
    setError(null)
    track(AnalyticsEvent.OrgCreateSubmitted, { goal: goal ?? 'none', version: 2 })
    try {
      const res = await createOrgWithOnboarding(token, { name, slug, goal })
      const org = res.org
      track(AnalyticsEvent.OrgCreated, { goal: goal ?? 'none', slug: org.slug, version: 2 })
      // Marketing audience (Loops), as before: SaaS-gated server-side, email from the session.
      void fetch('/api/loops/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ orgSlug: org.slug, onboarding: { use_cases: goal || undefined, onboarding_completed: true } }),
      }).catch(() => {})
      try {
        await session?.update?.(true)
      } catch {
        /* no-op */
      }
      queryClient.invalidateQueries({ queryKey: ['orgs', 'user'] })
      queryClient.invalidateQueries({ queryKey: onboardingKeys.hub() })
      setCreated({ id: org.id, slug: org.slug })
      go('start')
    } catch (e: any) {
      const detail = e?.detail
      const fallback = t('hub_new.toast.failed')
      if (e?.status === 409 && detail?.suggestion) {
        setError({ message: t('onb2.new.slug_taken_retry', { slug: detail.suggestion }) })
      } else if (e?.status === 403) {
        setError({ message: detailMessage(detail, fallback), capReached: true })
      } else {
        setError({ message: detailMessage(detail, fallback) })
      }
      track(AnalyticsEvent.OrgCreateFailed, { goal: goal ?? 'none', status: e?.status ?? 0 })
    } finally {
      setSubmitting(false)
    }
  }

  const enterOrg = async () => {
    if (!created) return
    // The dashboard opens on the welcome tour, then the launch plan.
    try {
      await fetch('/api/auth/refresh', { credentials: 'include' })
    } catch {
      /* the shared session cookie still carries over */
    }
    const paid = planIntent && planIntent !== 'free' ? getUpgradeUrl(created.slug, planIntent) : null
    window.location.href = paid || orgUrl(created.slug, '/dash')
  }

  const start = async (kind: 'template' | 'blank') => {
    if (!created || starting) return
    setStarting(kind)
    track(AnalyticsEvent.OnboardingStarterChosen, { kind, goal: goal ?? 'none' })
    if (kind === 'template') {
      await applyStarter(token, created.id).catch(() => null)
    } else {
      await recordOnboardingEvent(token, created.id, 'starter_skipped').catch(() => {})
    }
    await enterOrg()
  }

  const index = STEPS.indexOf(step)
  const meta: Record<Step, { title: string; subtitle: string }> = {
    goal: { title: t('onb2.new.goal_title'), subtitle: t('onb2.new.goal_subtitle') },
    name: { title: t('onb2.new.name_title'), subtitle: t('onb2.new.name_subtitle') },
    start: { title: t('onb2.new.start_title'), subtitle: t('onb2.new.start_subtitle') },
  }
  const showLoader = isLoading || (isAuthenticated && !session?.data)

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-white">
      <div className="relative min-h-screen">
        <div
          className="pointer-events-none absolute inset-0 z-0"
          style={{
            backgroundImage: `linear-gradient(rgba(0,0,0,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.035) 1px, transparent 1px)`,
            backgroundSize: '80px 80px',
            maskImage: 'linear-gradient(to top, black 0%, transparent 60%)',
            WebkitMaskImage: 'linear-gradient(to top, black 0%, transparent 60%)',
          }}
        />
        <div className="relative z-10 flex min-h-screen flex-col items-center px-4 py-6 sm:py-8">
          <div className="mb-8 grid w-full max-w-3xl grid-cols-3 items-center sm:mb-10">
            <Link href="/home" className="flex w-fit items-center gap-1.5 text-sm font-semibold text-black/35 transition-colors hover:text-black">
              <ArrowLeft size={14} className="rtl:rotate-180" />
              <span className="hidden sm:inline">{t('hub_new.topBar.back')}</span>
            </Link>
            <div className="flex justify-center">
              <img src="/lrn.svg" alt="LearnHouse" width={36} height={36} className="opacity-90 lh-dark-invert" />
            </div>
            <div className="flex justify-end">
              {isAuthenticated && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button aria-label={t('hub_new.user_menu')} className="rounded-full">
                      <UserAvatar border="border-2" rounded="rounded-full" width={32} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-56" align="end">
                    <DropdownMenuLabel>
                      <div className="flex flex-col">
                        <p className="text-sm font-medium">
                          {session?.data?.user?.first_name} {session?.data?.user?.last_name}
                        </p>
                        <p className="text-xs text-gray-500">{session?.data?.user?.email}</p>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => signOut({ redirect: true, callbackUrl: '/login' })}
                      className="flex items-center gap-2 text-red-600 focus:text-red-600"
                    >
                      <SignOut size={16} />
                      <span>{t('user.sign_out')}</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>

          <div className="w-full max-w-xl">
            {showLoader ? (
              <div className="space-y-3">
                <div className="h-24 w-full animate-pulse rounded-2xl bg-black/[0.03]" />
                <div className="h-40 w-full animate-pulse rounded-2xl bg-black/[0.03]" />
              </div>
            ) : (
              <>
                {step !== 'start' && <PendingInvites invites={invites} unverified={hub.data?.email_verified === false} className="mb-6" />}
                <AnimatePresence mode="wait" custom={dir}>
                  <motion.div key={`hdr-${step}`} custom={dir} variants={slide} initial="enter" animate="center" exit="exit" transition={trans} className="mb-6 text-center">
                    <StepDots current={index} />
                    <h1 className="mt-5 text-2xl font-bold tracking-tight text-neutral-900">{meta[step].title}</h1>
                    <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-neutral-500">{meta[step].subtitle}</p>
                  </motion.div>
                </AnimatePresence>
                <AnimatePresence mode="wait" custom={dir}>
                  <motion.div key={`body-${step}`} custom={dir} variants={slide} initial="enter" animate="center" exit="exit" transition={trans}>
                    {step === 'goal' && <GoalStep goal={goal} onPick={pickGoal} onSkip={() => pickGoal(null)} />}
                    {step === 'name' && (
                      <NameStep token={token} submitting={submitting} error={error} onBack={() => go('goal', -1)} onSubmit={create} />
                    )}
                    {step === 'start' && (
                      <StartStep goal={goal} busy={starting} onTemplate={() => start('template')} onBlank={() => start('blank')} />
                    )}
                  </motion.div>
                </AnimatePresence>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
