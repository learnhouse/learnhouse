'use client'
import React from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useOnboarding } from '@components/Hooks/useOnboarding'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  BookOpen,
  CheckCircle,
  CaretDown,
  CaretUp,
  RocketLaunch,
  PlusCircle,
  Browsers,
  PlayCircle,
  FileText,
  Backpack,
  MarkdownLogo,
  Globe,
  ArrowsOutSimple,
  ArrowsInSimple,
  ArrowCounterClockwise,
  PencilSimple,
  Lightning,
  SkipForward,
  Lock,
  DotsThree,
  UserPlus,
  Palette,
  Command,
  TextT,
  Image as ImageIcon,
  Video,
  Table,
  Check,
  GraduationCap,
} from '@phosphor-icons/react'
import { FilePenLine } from 'lucide-react'
import { useOrg } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import { usePlan } from '@components/Hooks/usePlan'
import { PlanLevel, planMeetsRequirement } from '@services/plans/plans'
import PlanBadge from '@components/Dashboard/Shared/PlanRestricted/PlanBadge'
import WelcomeGlobe from './WelcomeGlobe'
import { useTranslation } from 'react-i18next'

const ACTIVITY_TYPES = [
  { icon: Browsers, color: 'text-blue-400', label: 'Page' },
  { icon: PlayCircle, color: 'text-violet-400', label: 'Video' },
  { icon: FileText, color: 'text-emerald-400', label: 'Document' },
  { icon: Backpack, color: 'text-amber-400', label: 'Assignment' },
  { icon: MarkdownLogo, color: 'text-rose-400', label: 'Markdown' },
  { icon: Globe, color: 'text-cyan-400', label: 'Embed' },
]

const STEP_CONFIG: Record<
  string,
  {
    icon: React.ElementType
    actionLabel: string
    actionHref: string
    pattern: string
    patternSize?: string
    iconColor: string
  }
> = {
  create_course: {
    icon: BookOpen,
    actionLabel: 'Create a Course',
    actionHref: '/dash/courses?new=true',
    pattern: `radial-gradient(circle, rgba(191,219,254,0.12) 1px, transparent 1px)`,
    patternSize: '14px 14px',
    iconColor: 'text-blue-400',
  },
  add_activities: {
    icon: Browsers,
    actionLabel: 'Go to Content',
    actionHref: '',
    pattern: `repeating-linear-gradient(-45deg, transparent, transparent 8px, rgba(196,181,253,0.1) 8px, rgba(196,181,253,0.1) 9px)`,
    iconColor: 'text-violet-400',
  },
  experience_editor: {
    icon: PencilSimple,
    actionLabel: '',
    actionHref: '',
    pattern: `repeating-linear-gradient(0deg, transparent, transparent 8px, rgba(167,243,208,0.1) 8px, rgba(167,243,208,0.1) 9px), repeating-linear-gradient(90deg, transparent, transparent 8px, rgba(167,243,208,0.1) 8px, rgba(167,243,208,0.1) 9px)`,
    iconColor: 'text-emerald-400',
  },
  try_playgrounds: {
    icon: Lightning,
    actionLabel: 'Try Playgrounds',
    actionHref: '/dash/playgrounds',
    pattern: `radial-gradient(circle, rgba(253,230,138,0.12) 1px, transparent 1px), radial-gradient(circle, rgba(253,186,116,0.08) 1px, transparent 1px)`,
    patternSize: '14px 14px',
    iconColor: 'text-amber-400',
  },
  invite_users: {
    icon: UserPlus,
    actionLabel: 'Invite Users',
    actionHref: '/dash/users/settings/add',
    pattern: `repeating-linear-gradient(45deg, transparent, transparent 8px, rgba(191,219,254,0.08) 8px, rgba(191,219,254,0.08) 9px), repeating-linear-gradient(-45deg, transparent, transparent 8px, rgba(191,219,254,0.08) 8px, rgba(191,219,254,0.08) 9px)`,
    iconColor: 'text-sky-400',
  },
  customize_org: {
    icon: Palette,
    actionLabel: 'Customize',
    actionHref: '/dash/org/settings/general',
    pattern: `radial-gradient(circle, rgba(253,164,175,0.1) 1px, transparent 1px)`,
    patternSize: '14px 14px',
    iconColor: 'text-rose-400',
  },
  teach_the_world: {
    icon: GraduationCap,
    actionLabel: '',
    actionHref: '',
    pattern: '',
    iconColor: 'text-indigo-400',
  },
}

// Shared easing — the same curve used across all onboarding animations
const ease = [0.25, 0.1, 0.25, 1] as const

export default function OnboardingBar() {
  const {
    steps,
    currentStepIndex,
    allCompleted,
    progress,
    minimized,
    expanded,
    completeStep,
    dismiss,
    dismissed,
    skipStep,
    toggleMinimized,
    toggleExpanded,
    toggleShowAllSteps,
    showAllSteps,
    welcomeSeen,
    reset,
  } = useOnboarding()

  const { t } = useTranslation()
  const [showFarewell, setShowFarewell] = useState(false)
  const isDev = process.env.NODE_ENV === 'development'
  const currentPlan = usePlan()

  const pathname = usePathname()
  const router = useRouter()
  const org = useOrg() as any

  useEffect(() => {
    if (!pathname) return
    if (/\/dash\/courses\/course\/[^/]+\/general/.test(pathname)) {
      completeStep('create_course')
    }
    if (/\/dash\/courses\/course\/[^/]+\/content/.test(pathname)) {
      completeStep('add_activities')
    }
    // experience_editor is completed manually via the acknowledge tick

    if (/\/editor\/playground\/[^/]+\/edit/.test(pathname)) {
      completeStep('try_playgrounds')
    }
    if (/\/dash\/users\/settings\/add/.test(pathname)) {
      completeStep('invite_users')
    }
    if (/\/dash\/org\/settings\/(general|branding)/.test(pathname)) {
      completeStep('customize_org')
    }
  }, [pathname, completeStep])

  const firstTwoCompleted = steps.length >= 2 && steps[0].completed && steps[1].completed
  useEffect(() => {
    if (firstTwoCompleted && !showAllSteps) {
      toggleShowAllSteps()
    }
  }, [firstTwoCompleted])

  const isOnContentPage = pathname
    ? /\/dash\/courses\/course\/[^/]+\/content/.test(pathname)
    : false

  const isInEditor = pathname
    ? /\/course\/[^/]+\/activity\/[^/]+\/edit/.test(pathname) || /\/editor\/playground\/[^/]+\/edit/.test(pathname)
    : false

  const orgSlug = org?.slug || ''

  if (dismissed || !welcomeSeen) return null

  const getActionHref = (stepId: string) => {
    if (stepId === 'add_activities' && pathname) {
      const match = pathname.match(/\/dash\/courses\/course\/([^/]+)/)
      if (match) {
        return `/dash/courses/course/${match[1]}/content`
      }
    }
    return STEP_CONFIG[stepId]?.actionHref || ''
  }

  const VISIBLE_COUNT = 2
  const displayedSteps = showAllSteps ? steps : steps.slice(0, VISIBLE_COUNT)
  const hiddenCount = steps.length - VISIBLE_COUNT

  const navigateTo = (href: string) => {
    const fullPath = getUriWithOrg(orgSlug, href)
    if (isInEditor) {
      // Full page navigation from editor since it's outside the dash router
      window.location.href = fullPath
    } else {
      router.push(fullPath)
    }
  }

  // Use fixed positioning in editor, absolute in dashboard
  const position = isInEditor ? 'fixed' : 'absolute'

  return (
    <>
      {/* Frosted blur backdrop */}
      <AnimatePresence>
        {!minimized && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className={`${position} bottom-0 end-0 z-40 backdrop-blur-md pointer-events-none`}
            style={{
              width: '50%',
              height: '200px',
              maskImage: 'radial-gradient(ellipse at bottom right, black 0%, transparent 70%)',
              WebkitMaskImage: 'radial-gradient(ellipse at bottom right, black 0%, transparent 70%)',
            }}
          />
        )}
      </AnimatePresence>

      <div className={`${position} bottom-0 start-0 end-0 z-50 flex justify-end pointer-events-none`}>
        <AnimatePresence mode="wait">
          {minimized ? (
            <motion.button
              key="minimized"
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              transition={{ duration: 0.15, ease }}
              onClick={toggleMinimized}
              className="pointer-events-auto mb-6 me-4 flex items-center gap-3 px-4 py-2.5 bg-white/85 backdrop-blur-lg text-gray-900 rounded-xl nice-shadow cursor-pointer hover:bg-white transition-colors"
            >
              <RocketLaunch size={18} weight="duotone" className="text-gray-700" />
              <div className="flex flex-col items-start">
                <span className="text-xs font-bold">{t('onboarding.getting_started')}</span>
                <div className="flex items-center gap-2 mt-1">
                  <div className="h-1.5 w-24 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-black rounded-full transition-all duration-300"
                      style={{ width: `${progress * 100}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-gray-400 font-medium">
                    {steps.filter((s) => s.completed).length}/{steps.length}
                  </span>
                </div>
              </div>
              <CaretUp size={14} weight="bold" className="text-gray-400" />
            </motion.button>
          ) : (
            <motion.div
              key="expanded"
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              transition={{ duration: 0.15, ease }}
              className={`pointer-events-auto mb-6 mx-4 w-full transition-[max-width] duration-200 ${
                expanded ? 'max-w-3xl' : 'max-w-xl'
              }`}
            >
              <div className="bg-white/85 backdrop-blur-lg rounded-xl nice-shadow overflow-hidden">
                <AnimatePresence mode="wait">
                {showFarewell ? (
                  <motion.div
                    key="farewell"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, y: 20, scale: 0.95 }}
                    transition={{ duration: 0.3, ease }}
                    className="p-8 text-center"
                  >
                    <div className="flex justify-center -mb-8">
                      <div className="w-[180px]">
                        <WelcomeGlobe />
                      </div>
                    </div>
                    <h3 className="text-lg font-bold text-gray-900 mt-2">
                      {t('onboarding.farewell.title')}
                    </h3>
                    <p className="text-sm text-gray-400 mt-1">
                      {t('onboarding.farewell.description')}
                    </p>
                    <motion.button
                      onClick={() => {
                        setShowFarewell(false)
                        dismiss()
                      }}
                      className="mt-4 px-6 py-2.5 text-xs font-semibold text-white bg-black rounded-lg hover:bg-gray-800 transition-colors"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.3, duration: 0.3, ease }}
                    >
                      {t('onboarding.farewell.button')}
                    </motion.button>
                  </motion.div>
                ) : (
                <motion.div key="onboarding-content" exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <RocketLaunch
                      size={20}
                      weight="duotone"
                      className="text-gray-700"
                    />
                    <span className="text-sm font-bold text-gray-900">
                      {t('onboarding.getting_started')}
                    </span>
                    <span className="text-[11px] text-gray-400 font-medium">
                      {allCompleted
                        ? t('onboarding.all_done')
                        : `${currentStepIndex + 1}/${steps.length}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {isDev && (
                      <button
                        onClick={reset}
                        className="p-1 text-gray-400 hover:text-red-500 rounded-lg transition-colors"
                        title="Reset onboarding (dev only)"
                      >
                        <ArrowCounterClockwise size={16} weight="bold" />
                      </button>
                    )}
                    <button
                      onClick={toggleExpanded}
                      className="p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors"
                    >
                      {expanded ? (
                        <ArrowsInSimple size={16} weight="bold" />
                      ) : (
                        <ArrowsOutSimple size={16} weight="bold" />
                      )}
                    </button>
                    <button
                      onClick={toggleMinimized}
                      className="p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors"
                    >
                      <CaretDown size={16} weight="bold" />
                    </button>
                  </div>
                </div>

                {/* Progress */}
                <div className="mx-4 h-1 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-black rounded-full transition-all duration-300"
                    style={{ width: `${progress * 100}%` }}
                  />
                </div>

                {/* Steps */}
                <div className="relative">
                  <div
                    className={`overflow-y-auto p-3 rounded-b-xl ${
                      expanded ? 'max-h-[80vh]' : 'max-h-[50vh]'
                    }`}
                  >
                    {allCompleted ? (
                      <div className="relative flex items-center gap-3 p-4 rounded-xl nice-shadow overflow-hidden">
                        <div
                          className="absolute inset-0"
                          style={{
                            backgroundImage: `radial-gradient(circle, rgba(167,243,208,0.12) 1px, transparent 1px)`,
                            backgroundSize: '14px 14px',
                          }}
                        />
                        <CheckCircle
                          size={28}
                          weight="duotone"
                          className="relative text-emerald-400"
                        />
                        <div className="relative">
                          <p className="text-sm font-semibold text-gray-900">
                            {t('onboarding.all_set')}
                          </p>
                          <p className="text-xs text-gray-400">
                            {t('onboarding.all_set_desc')}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <AnimatePresence initial={false}>
                          {displayedSteps.map((step) => {
                            const config = STEP_CONFIG[step.id]
                            const Icon = config?.icon || BookOpen
                            const actionHref = getActionHref(step.id)
                            const requiredPlan = step.requiredPlan as PlanLevel | undefined
                            const isLocked = requiredPlan && !planMeetsRequirement(currentPlan, requiredPlan)

                            return (
                              <motion.div
                                key={step.id}
                                layout
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.15, ease }}
                              >
                                <div
                                  className={`relative rounded-xl overflow-hidden ${
                                    !step.completed ? 'nice-shadow' : ''
                                  }`}
                                >
                                  {/* Background pattern */}
                                  {!step.completed && config && (
                                    <div
                                      className="absolute inset-0"
                                      style={{
                                        backgroundImage: config.pattern,
                                        backgroundSize:
                                          config.patternSize || 'auto',
                                      }}
                                    />
                                  )}

                                  <div className="relative flex items-center justify-between p-3 gap-3">
                                    <div className="flex items-center gap-3 min-w-0">
                                      {step.completed ? (
                                        step.skipped ? (
                                          <SkipForward
                                            size={24}
                                            weight="duotone"
                                            className="text-gray-400 shrink-0"
                                          />
                                        ) : (
                                          <CheckCircle
                                            size={24}
                                            weight="duotone"
                                            className="text-emerald-400 shrink-0"
                                          />
                                        )
                                      ) : isLocked ? (
                                        <Lock
                                          size={24}
                                          weight="duotone"
                                          className="text-amber-400 shrink-0"
                                        />
                                      ) : (
                                        <Icon
                                          size={24}
                                          weight="duotone"
                                          className={`shrink-0 ${
                                            config?.iconColor || 'text-gray-400'
                                          }`}
                                        />
                                      )}
                                      <div className="min-w-0">
                                        <div className="flex items-center gap-1.5">
                                          <p
                                            className={`text-sm font-medium ${
                                              step.completed
                                                ? 'text-gray-400 line-through'
                                                : 'text-gray-700'
                                            }`}
                                          >
                                            {t(`onboarding.steps.${step.id}.title`)}
                                          </p>
                                          {requiredPlan && (
                                            <PlanBadge
                                              currentPlan={currentPlan}
                                              requiredPlan={requiredPlan}
                                              size="sm"
                                              noMargin
                                            />
                                          )}
                                        </div>
                                        {!step.completed && (
                                          <p className="text-xs text-gray-400 mt-0.5">
                                            {t(`onboarding.steps.${step.id}.description`)}
                                          </p>
                                        )}
                                      </div>
                                    </div>

                                    <div className="flex items-center gap-2">
                                      {!step.completed && isLocked && (
                                        <button
                                          onClick={() => skipStep(step.id)}
                                          className="relative flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-500 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors shrink-0"
                                        >
                                          <SkipForward size={14} weight="bold" />
                                          {t('onboarding.skip')}
                                        </button>
                                      )}

                                      {!step.completed && !isLocked && actionHref && (
                                        <button
                                          onClick={() => navigateTo(actionHref)}
                                          className="relative flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-black rounded-lg hover:bg-gray-800 transition-colors shrink-0"
                                        >
                                          <PlusCircle size={14} weight="bold" />
                                          {t(`onboarding.steps.${step.id}.action`)}
                                        </button>
                                      )}
                                    </div>
                                  </div>

                                  {/* Activity types showcase */}
                                  {step.id === 'add_activities' &&
                                    !step.completed && (
                                      <div className="relative px-3 pb-3">
                                        <div className="flex gap-2">
                                          {ACTIVITY_TYPES.map((activity) => (
                                            <div
                                              key={activity.label}
                                              className="flex flex-col items-center gap-1.5 flex-1 py-2 rounded-lg bg-white nice-shadow"
                                            >
                                              <activity.icon
                                                size={20}
                                                weight="duotone"
                                                className={activity.color}
                                              />
                                              <span className="text-[10px] font-medium text-gray-500">
                                                {activity.label}
                                              </span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}

                                  {/* Editor step visual guide */}
                                  {step.id === 'experience_editor' &&
                                    !step.completed &&
                                    isOnContentPage && (
                                      <div className="relative px-3 pb-3">
                                        <div className="flex items-center gap-2">
                                          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white nice-shadow flex-1">
                                            <div className="flex items-center justify-center w-5 h-5 rounded-full bg-gray-900 text-white text-[10px] font-bold shrink-0">
                                              1
                                            </div>
                                            <PlusCircle
                                              size={16}
                                              weight="duotone"
                                              className="text-gray-500 shrink-0"
                                            />
                                            <span className="text-[11px] font-medium text-gray-600">
                                              {t('onboarding.steps.experience_editor.add_activity')}
                                            </span>
                                          </div>

                                          <span className="text-gray-300 shrink-0">→</span>

                                          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white nice-shadow flex-1">
                                            <div className="flex items-center justify-center w-5 h-5 rounded-full bg-gray-900 text-white text-[10px] font-bold shrink-0">
                                              2
                                            </div>
                                            <Browsers
                                              size={16}
                                              weight="duotone"
                                              className="text-blue-400 shrink-0"
                                            />
                                            <span className="text-[11px] font-medium text-gray-600">
                                              {t('onboarding.steps.experience_editor.dynamic_page')}
                                            </span>
                                          </div>

                                          <span className="text-gray-300 shrink-0">→</span>

                                          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white nice-shadow flex-1">
                                            <div className="flex items-center justify-center w-5 h-5 rounded-full bg-gray-900 text-white text-[10px] font-bold shrink-0">
                                              3
                                            </div>
                                            <FilePenLine
                                              size={16}
                                              className="text-emerald-400 shrink-0"
                                            />
                                            <span className="text-[11px] font-medium text-gray-600">
                                              {t('onboarding.steps.experience_editor.click_edit')}
                                            </span>
                                          </div>
                                        </div>
                                      </div>
                                    )}

                                  {/* Editor features guide — shown when user is in the editor */}
                                  {step.id === 'experience_editor' &&
                                    !step.completed &&
                                    isInEditor && (
                                      <div className="relative px-3 pb-3 space-y-2">
                                        <p className="text-[11px] font-semibold text-gray-500 px-1">
                                          {t('onboarding.steps.experience_editor.editor_features')}
                                        </p>
                                        <div className="grid grid-cols-2 gap-2">
                                          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white nice-shadow">
                                            <Command size={16} weight="duotone" className="text-gray-500 shrink-0" />
                                            <span className="text-[11px] font-medium text-gray-600">
                                              {t('onboarding.steps.experience_editor.slash_commands')}
                                            </span>
                                          </div>
                                          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white nice-shadow">
                                            <TextT size={16} weight="duotone" className="text-blue-400 shrink-0" />
                                            <span className="text-[11px] font-medium text-gray-600">
                                              {t('onboarding.steps.experience_editor.headings_lists')}
                                            </span>
                                          </div>
                                          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white nice-shadow">
                                            <ImageIcon size={16} weight="duotone" className="text-violet-400 shrink-0" />
                                            <span className="text-[11px] font-medium text-gray-600">
                                              {t('onboarding.steps.experience_editor.images_media')}
                                            </span>
                                          </div>
                                          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white nice-shadow">
                                            <Video size={16} weight="duotone" className="text-rose-400 shrink-0" />
                                            <span className="text-[11px] font-medium text-gray-600">
                                              {t('onboarding.steps.experience_editor.video_embeds')}
                                            </span>
                                          </div>
                                          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white nice-shadow">
                                            <Table size={16} weight="duotone" className="text-amber-400 shrink-0" />
                                            <span className="text-[11px] font-medium text-gray-600">
                                              {t('onboarding.steps.experience_editor.tables_callouts')}
                                            </span>
                                          </div>
                                          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white nice-shadow">
                                            <Lightning size={16} weight="duotone" className="text-emerald-400 shrink-0" />
                                            <span className="text-[11px] font-medium text-gray-600">
                                              {t('onboarding.steps.experience_editor.interactive_blocks')}
                                            </span>
                                          </div>
                                        </div>
                                        <button
                                          onClick={() => completeStep('experience_editor')}
                                          className="w-full flex items-center justify-center gap-2 py-2 mt-1 text-xs font-medium text-gray-600 bg-white nice-shadow rounded-lg hover:bg-gray-50 transition-colors"
                                        >
                                          <Check size={14} weight="bold" />
                                          {t('onboarding.got_it')}
                                        </button>
                                      </div>
                                    )}

                                  {/* Teach the world — LearnHouse University link */}
                                  {step.id === 'teach_the_world' &&
                                    !step.completed && (
                                      <div className="relative px-3 pb-3 space-y-2">
                                        <a
                                          href="https://university.learnhouse.io"
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          onClick={() => completeStep('teach_the_world')}
                                          className="flex items-center gap-3 px-4 py-3 rounded-lg bg-white nice-shadow hover:bg-gray-50 transition-colors"
                                        >
                                          <img
                                            src="/UNI_LOGO.png"
                                            alt="LearnHouse University"
                                            className="h-9 w-auto shrink-0 rounded"
                                          />
                                          <div className="min-w-0">
                                            <p className="text-xs font-semibold text-gray-700">
                                              {t('onboarding.steps.teach_the_world.university')}
                                            </p>
                                            <p className="text-[11px] text-gray-400">
                                              {t('onboarding.steps.teach_the_world.university_desc')}
                                            </p>
                                          </div>
                                          <span className="text-gray-300 shrink-0 ms-auto">→</span>
                                        </a>
                                        <a
                                          href="https://classroom.learnhouse.io"
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          onClick={() => completeStep('teach_the_world')}
                                          className="flex items-center gap-3 px-4 py-3 rounded-lg bg-white nice-shadow hover:bg-gray-50 transition-colors"
                                        >
                                          <img
                                            src="/theclassroom.png"
                                            alt="The Classroom"
                                            className="h-9 w-auto shrink-0 rounded"
                                          />
                                          <div className="min-w-0">
                                            <p className="text-xs font-semibold text-gray-700">
                                              {t('onboarding.steps.teach_the_world.classroom')}
                                            </p>
                                            <p className="text-[11px] text-gray-400">
                                              {t('onboarding.steps.teach_the_world.classroom_desc')}
                                            </p>
                                          </div>
                                          <span className="text-gray-300 shrink-0 ms-auto">→</span>
                                        </a>
                                        <button
                                          onClick={() => {
                                            completeStep('teach_the_world')
                                            setShowFarewell(true)
                                          }}
                                          className="w-full flex items-center justify-center gap-2 py-2.5 mt-1 text-xs font-semibold text-white bg-black nice-shadow rounded-lg hover:bg-gray-800 transition-colors"
                                        >
                                          <Check size={14} weight="bold" />
                                          {t('onboarding.done')}
                                        </button>
                                      </div>
                                    )}
                                </div>
                              </motion.div>
                            )
                          })}
                        </AnimatePresence>

                        {/* "More steps" / "Show less" button */}
                        {hiddenCount > 0 && (
                          <div>
                            <button
                              onClick={toggleShowAllSteps}
                              className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors rounded-lg hover:bg-gray-50"
                            >
                              <DotsThree size={18} weight="bold" />
                              {showAllSteps
                                ? t('onboarding.show_less')
                                : t('onboarding.more_steps', { count: hiddenCount })}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
              )}
              </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  )
}
