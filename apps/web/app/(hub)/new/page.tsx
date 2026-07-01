'use client'

import React, { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { useFormik } from 'formik'
import * as Form from '@radix-ui/react-form'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  ArrowRight,
  ArrowLeft,
  Check,
  Info,
  CircleNotch as Loader,
  User,
  Users,
  Buildings as Building2,
  GraduationCap,
  Laptop,
  Code,
  Palette,
  MusicNotes as Music,
  Robot as Bot,
  BookOpen,
  Atom,
  TrendUp as TrendingUp,
  Heart,
  Camera,
  Pencil,
  Translate as Languages,
  GameController as Gamepad2,
  Briefcase,
  ShoppingBag,
  Megaphone,
  Globe,
  Storefront as Store,
  SignOut as LogOut,
} from '@phosphor-icons/react'

import { useLHSession } from '@components/Contexts/LHSessionContext'
import { signOut } from '@components/Contexts/AuthContext'
import UserAvatar from '@components/Objects/UserAvatar'
import { createNewOrganization } from '@services/organizations/orgs'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import { apiFetch } from '@services/utils/ts/requests'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'

import {
  findPlan,
  isPaidPlan,
  type Billing,
  type PlanId,
  type PricesResponse,
} from '../_billing/plans'
import { fetchPrices } from '../billing/_lib/billingClient'
import PricingCards from './_components/PricingCards'
import PlanSummaryCard from './_components/PlanSummaryCard'

// ── Constants ───────────────────────────────────────────────────────────────

type UseType = 'personal' | 'organization' | null
type Step = 'use-type' | 'usage' | 'choose-plan' | 'create-org' | 'success'

const RESERVED_SLUGS = ['learnhouse', 'graphicmade', 'sweave', 'cname']
const RESTRICTED_WORDS = ['sex', 'test']

const STEP_NUMBER: Record<Step, number> = {
  'use-type': 1,
  usage: 2,
  'choose-plan': 3,
  'create-org': 4,
  success: 4,
}
const TOTAL_STEPS = 4

// ── Animation ─────────────────────────────────────────────────────────────────

const slide = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 24, filter: 'blur(3px)' }),
  center: { opacity: 1, x: 0, filter: 'blur(0px)' },
  exit: (dir: number) => ({ opacity: 0, x: dir * -24, filter: 'blur(3px)' }),
}
const trans = { duration: 0.26, ease: [0.4, 0, 0.2, 1] as any }

// Map a backend error to a human-readable message, never leaking the raw
// FastAPI validation payload (e.g. `[{"type":"missing","loc":["body","email"]}]`)
// into the UI. `errorHandling` JSON.stringifies non-string `detail`, so guard
// against both stringified-JSON messages and structured `detail` arrays/objects.
function friendlyCreateError(e: any, fallback: string): string {
  const detail = e?.detail
  // FastAPI 422: detail is an array of {loc, msg, type}
  if (Array.isArray(detail)) {
    const first = detail[0]
    const field = Array.isArray(first?.loc) ? first.loc[first.loc.length - 1] : undefined
    if (field && first?.msg) return `${String(field)}: ${first.msg}`
    return fallback
  }
  if (detail && typeof detail === 'object') {
    if (typeof detail.message === 'string') return detail.message
    return fallback
  }
  const msg = typeof e?.message === 'string' ? e.message.trim() : ''
  // A JSON-stringified payload leaked through as the message — don't show it raw.
  if (!msg || msg.startsWith('[') || msg.startsWith('{')) return fallback
  return msg
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 20)
}

// ── Small UI atoms ────────────────────────────────────────────────────────────

function StepPills({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
        <motion.div
          key={i}
          className="h-1.5 rounded-full"
          initial={false}
          animate={{
            width: i + 1 === current ? 24 : 7,
            backgroundColor: i + 1 <= current ? '#111827' : '#e5e7eb',
          }}
          transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
        />
      ))}
      <span className="ml-1 text-xs text-gray-400 tabular-nums">
        {current}/{TOTAL_STEPS}
      </span>
    </div>
  )
}

function OptionChip({
  selected,
  onClick,
  Icon,
  label,
}: {
  selected: boolean
  onClick: () => void
  Icon: React.ElementType
  label: string
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.96 }}
      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 cursor-pointer
        ${selected ? 'bg-gray-900 text-white shadow-md shadow-gray-900/10' : 'bg-white nice-shadow text-gray-700 hover:shadow-md'}`}
    >
      <Icon size={15} weight="duotone" className={selected ? 'text-white' : 'text-gray-400'} />
      {label}
      {selected && (
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="w-4 h-4 rounded-full bg-white/20 flex items-center justify-center"
        >
          <Check size={9} className="text-white" />
        </motion.span>
      )}
    </motion.button>
  )
}

function TeamCard({
  selected,
  onClick,
  Icon,
  label,
}: {
  selected: boolean
  onClick: () => void
  Icon: React.ElementType
  label: string
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.96 }}
      className={`flex-1 flex flex-col items-center gap-2 py-4 rounded-xl text-sm font-medium transition-all duration-150 cursor-pointer
        ${selected ? 'bg-gray-900 text-white shadow-md shadow-gray-900/10' : 'bg-white nice-shadow text-gray-600 hover:shadow-md'}`}
    >
      <Icon size={18} weight="duotone" className={selected ? 'text-white' : 'text-gray-400'} />
      <span className={`text-xs font-semibold whitespace-nowrap ${selected ? 'text-white' : 'text-gray-700'}`}>
        {label}
      </span>
    </motion.button>
  )
}

// ── Step 1: use-type ──────────────────────────────────────────────────────────

function StepUseType({
  useType,
  onSelect,
  t,
}: {
  useType: UseType
  onSelect: (_ut: UseType) => void
  t: any
}) {
  const options = [
    {
      id: 'personal' as UseType,
      label: t('hub_new.useType.personal.label', { defaultValue: 'Personal' }),
      subtitle: t('hub_new.useType.personal.subtitle', {
        defaultValue: 'Learn and build your own space.',
      }),
      Icon: User,
      badge: t('hub_new.useType.personal.badge', { defaultValue: 'New' }),
      cases: [
        {
          Icon: GraduationCap,
          title: t('hub_new.useCases.personal.title', { defaultValue: 'Self learning' }),
          description: t('hub_new.useCases.personal.description', {
            defaultValue: 'Organize courses for yourself.',
          }),
        },
      ],
    },
    {
      id: 'organization' as UseType,
      label: t('hub_new.useType.organization.label', { defaultValue: 'Organization' }),
      subtitle: t('hub_new.useType.organization.subtitle', {
        defaultValue: 'Teach a team, school or audience.',
      }),
      Icon: Building2,
      badge: null as string | null,
      cases: [
        {
          Icon: Store,
          title: t('hub_new.useCases.creators.title', { defaultValue: 'Creators' }),
          description: t('hub_new.useCases.creators.description', {
            defaultValue: 'Sell courses to your audience.',
          }),
        },
        {
          Icon: Briefcase,
          title: t('hub_new.useCases.business.title', { defaultValue: 'Business' }),
          description: t('hub_new.useCases.business.description', {
            defaultValue: 'Train your employees.',
          }),
        },
      ],
    },
  ]
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-stretch">
      {options.map((opt) => {
        const selected = useType === opt.id
        return (
          <motion.button
            key={opt.id}
            type="button"
            onClick={() => onSelect(opt.id)}
            whileTap={{ scale: 0.985 }}
            className={`w-full h-full text-left px-6 py-6 rounded-2xl transition-all duration-200 cursor-pointer flex flex-col
              ${selected ? 'bg-gray-900 ring-2 ring-gray-900 shadow-lg shadow-gray-900/20' : 'bg-white nice-shadow hover:shadow-lg hover:shadow-gray-200/60'}`}
          >
            <div className="flex items-start justify-between mb-5">
              <div className={`p-2.5 rounded-xl ${selected ? 'bg-white/10' : 'bg-gray-50'}`}>
                <opt.Icon size={22} weight="duotone" className={selected ? 'text-white' : 'text-gray-500'} />
              </div>
              <motion.div
                initial={false}
                animate={selected ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                className="w-6 h-6 rounded-full bg-white flex items-center justify-center shadow-sm"
              >
                <Check size={11} className="text-gray-900" />
              </motion.div>
            </div>
            <div
              className={`font-black text-lg tracking-tight leading-tight mb-1 flex items-baseline gap-2 ${selected ? 'text-white' : 'text-gray-900'}`}
            >
              {opt.label}
              {opt.badge && (
                <span
                  className={`px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide rounded-md border relative -top-px ${selected ? 'border-white/25 text-white/50' : 'border-black/25 text-black/40'}`}
                >
                  {opt.badge}
                </span>
              )}
            </div>
            <p className={`text-xs leading-relaxed mb-5 ${selected ? 'text-white/50' : 'text-gray-400'}`}>
              {opt.subtitle}
            </p>
            <div className="flex flex-col gap-1 mt-auto">
              {opt.cases.map((c, idx) => (
                <div key={idx} className="flex items-start gap-2 px-1 py-0.5">
                  <c.Icon
                    size={13}
                    weight="duotone"
                    className={`flex-shrink-0 mt-0.5 ${selected ? 'text-white/50' : 'text-gray-400'}`}
                  />
                  <div className="flex flex-col gap-0">
                    <span
                      className={`text-[12px] font-semibold leading-tight block ${selected ? 'text-white/90' : 'text-gray-700'}`}
                    >
                      {c.title}
                    </span>
                    <span
                      className={`text-[11px] leading-snug mt-0.5 block ${selected ? 'text-white/40' : 'text-gray-400'}`}
                    >
                      {c.description}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </motion.button>
        )
      })}
    </div>
  )
}

// ── Step 2: usage questionnaire (local-only, gates Continue) ───────────────────

function StepUsagePersonal({
  goals,
  onChange,
  t,
}: {
  goals: string[]
  onChange: (_g: string[]) => void
  t: any
}) {
  const PERSONAL_GOALS = [
    { id: 'learn_skills', label: t('hub_new.personalGoals.learnSkills', { defaultValue: 'Learn skills' }), Icon: GraduationCap },
    { id: 'teach_others', label: t('hub_new.personalGoals.teachOthers', { defaultValue: 'Teach others' }), Icon: Laptop },
    { id: 'coding', label: t('hub_new.personalGoals.coding', { defaultValue: 'Coding' }), Icon: Code },
    { id: 'creative', label: t('hub_new.personalGoals.creative', { defaultValue: 'Creative' }), Icon: Palette },
    { id: 'music', label: t('hub_new.personalGoals.music', { defaultValue: 'Music' }), Icon: Music },
    { id: 'ai', label: t('hub_new.personalGoals.ai', { defaultValue: 'AI' }), Icon: Bot },
    { id: 'literature', label: t('hub_new.personalGoals.literature', { defaultValue: 'Literature' }), Icon: BookOpen },
    { id: 'science', label: t('hub_new.personalGoals.science', { defaultValue: 'Science' }), Icon: Atom },
    { id: 'business', label: t('hub_new.personalGoals.business', { defaultValue: 'Business' }), Icon: TrendingUp },
    { id: 'health', label: t('hub_new.personalGoals.health', { defaultValue: 'Health' }), Icon: Heart },
    { id: 'photography', label: t('hub_new.personalGoals.photography', { defaultValue: 'Photography' }), Icon: Camera },
    { id: 'writing', label: t('hub_new.personalGoals.writing', { defaultValue: 'Writing' }), Icon: Pencil },
    { id: 'languages', label: t('hub_new.personalGoals.languages', { defaultValue: 'Languages' }), Icon: Languages },
    { id: 'gaming', label: t('hub_new.personalGoals.gaming', { defaultValue: 'Gaming' }), Icon: Gamepad2 },
  ]
  const toggle = (id: string) => {
    onChange(goals.includes(id) ? goals.filter((g) => g !== id) : [...goals, id])
  }
  return (
    <div className="bg-white nice-shadow rounded-2xl p-6">
      <p className="text-sm font-semibold text-gray-800 mb-1">
        {t('hub_new.personalUsage.title', { defaultValue: 'What would you like to learn?' })}
      </p>
      <p className="text-xs text-gray-400 mb-4">
        {t('hub_new.personalUsage.subtitle', { defaultValue: 'Pick all that apply.' })}
      </p>
      <div className="flex flex-wrap gap-2">
        {PERSONAL_GOALS.map((g) => (
          <OptionChip key={g.id} selected={goals.includes(g.id)} onClick={() => toggle(g.id)} Icon={g.Icon} label={g.label} />
        ))}
      </div>
    </div>
  )
}

function StepUsageOrg({
  data,
  onChange,
  t,
}: {
  data: { teamSize: string; useCase: string }
  onChange: (_d: { teamSize: string; useCase: string }) => void
  t: any
}) {
  const TEAM_SIZES = [
    { id: 'solo', label: t('hub_new.teamSizes.solo', { defaultValue: 'Solo' }), Icon: User },
    { id: '2-10', label: t('hub_new.teamSizes.2-10', { defaultValue: '2–10' }), Icon: Users },
    { id: '11-50', label: t('hub_new.teamSizes.11-50', { defaultValue: '11–50' }), Icon: Users },
    { id: '51-200', label: t('hub_new.teamSizes.51-200', { defaultValue: '51–200' }), Icon: Users },
    { id: '200+', label: t('hub_new.teamSizes.200plus', { defaultValue: '200+' }), Icon: Building2 },
  ]
  const ORG_USE_CASES = [
    { id: 'employee_training', label: t('hub_new.orgUseCases.employeeTraining', { defaultValue: 'Employee training' }), Icon: Briefcase },
    { id: 'online_courses', label: t('hub_new.orgUseCases.onlineCourses', { defaultValue: 'Online courses' }), Icon: ShoppingBag },
    { id: 'customer_education', label: t('hub_new.orgUseCases.customerEducation', { defaultValue: 'Customer education' }), Icon: Megaphone },
    { id: 'academic_programs', label: t('hub_new.orgUseCases.academicPrograms', { defaultValue: 'Academic programs' }), Icon: GraduationCap },
    { id: 'developer_docs', label: t('hub_new.orgUseCases.developerDocs', { defaultValue: 'Developer docs' }), Icon: Code },
    { id: 'community_learning', label: t('hub_new.orgUseCases.communityLearning', { defaultValue: 'Community learning' }), Icon: Globe },
  ]
  return (
    <div className="space-y-4">
      <div className="bg-white nice-shadow rounded-2xl p-6">
        <p className="text-sm font-semibold text-gray-800 mb-4">
          {t('hub_new.orgUsage.teamSizeTitle', { defaultValue: 'How big is your team?' })}
        </p>
        <div className="flex gap-2">
          {TEAM_SIZES.map((s) => (
            <TeamCard
              key={s.id}
              selected={data.teamSize === s.id}
              onClick={() => onChange({ ...data, teamSize: s.id })}
              Icon={s.Icon}
              label={s.label}
            />
          ))}
        </div>
      </div>
      <div className="bg-white nice-shadow rounded-2xl p-6">
        <p className="text-sm font-semibold text-gray-800 mb-4">
          {t('hub_new.orgUsage.useCaseTitle', { defaultValue: 'What will you use it for?' })}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {ORG_USE_CASES.map((c) => (
            <OptionChip
              key={c.id}
              selected={data.useCase === c.id}
              onClick={() => onChange({ ...data, useCase: c.id })}
              Icon={c.Icon}
              label={c.label}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Step 4: create org form + plan summary ────────────────────────────────────

const FormLabelAndMessage = ({ label, message }: { label: string; message?: string }) => (
  <div className="flex items-center justify-between mb-2">
    <Form.Label className="text-[13px] font-semibold text-black/50">{label}</Form.Label>
    {message && (
      <div className="flex items-center gap-1 text-red-500/80 text-[11px] font-medium">
        <Info size={9} />
        <span>{message}</span>
      </div>
    )}
  </div>
)

function TestHint({ t }: { t: any }) {
  return (
    <div className="mt-2.5 flex items-start gap-2.5 bg-amber-50 border border-amber-100 rounded-xl px-3.5 py-3">
      <Info size={13} className="text-amber-500 flex-shrink-0 mt-0.5" />
      <div className="text-[12px] leading-relaxed text-amber-800">
        <span className="font-semibold">{t('hub_new.createOrg.testHint.title', { defaultValue: 'Looking to test?' })}</span>{' '}
        <span className="text-amber-700">
          {t('hub_new.createOrg.testHint.body', { defaultValue: 'Head to the' })}{' '}
          <a href="/developers" className="font-semibold underline underline-offset-2 hover:text-amber-900">
            {t('hub_new.createOrg.testHint.link', { defaultValue: 'Developers page' })}
          </a>{' '}
          {t('hub_new.createOrg.testHint.suffix', { defaultValue: 'to try LearnHouse instead.' })}
        </span>
      </div>
    </div>
  )
}

function CreateOrgForm({
  planId,
  billing,
  prices,
  submitting,
  error,
  onSubmit,
  t,
}: {
  planId: PlanId | null
  billing: Billing
  prices?: PricesResponse | null
  submitting: boolean
  error: string
  onSubmit: (_values: { name: string; description: string; slug: string }) => void
  t: any
}) {
  const slugEdited = useRef(false)

  const validate = (values: any) => {
    const errors: any = {}
    if (!values.name) errors.name = t('hub_new.createOrg.validation.required', { defaultValue: 'Required' })
    else if (/test/i.test(values.name)) errors.name = 'test_hint'
    if (!values.slug) errors.slug = t('hub_new.createOrg.validation.required', { defaultValue: 'Required' })
    else if (values.slug !== values.slug.toLowerCase())
      errors.slug = t('hub_new.createOrg.validation.lowercase', { defaultValue: 'Lowercase only' })
    else if (values.slug.match(/[^a-z0-9-]/))
      errors.slug = t('hub_new.createOrg.validation.noSpecialChars', { defaultValue: 'Letters, numbers, dashes only' })
    else if (values.slug.includes('test')) errors.slug = 'test_hint'
    else if (RESERVED_SLUGS.includes(values.slug))
      errors.slug = t('hub_new.createOrg.validation.reserved', { defaultValue: 'This slug is reserved' })
    else if (RESTRICTED_WORDS.some((w) => values.slug.includes(w)))
      errors.slug = t('hub_new.createOrg.validation.reserved', { defaultValue: 'This slug is reserved' })
    else if (values.slug.length > 20)
      errors.slug = t('hub_new.createOrg.validation.maxLength', { defaultValue: 'Max 20 characters' })
    return errors
  }

  const formik = useFormik({
    initialValues: { name: '', description: '', slug: '' },
    validate,
    onSubmit: (values) => onSubmit({ name: values.name, description: values.description, slug: values.slug }),
  })

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    formik.handleChange(e)
    if (!slugEdited.current) {
      formik.setFieldValue('slug', slugify(e.target.value))
    }
  }

  const handleSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    slugEdited.current = true
    formik.handleChange(e)
  }

  const inputCls =
    'w-full bg-white nice-shadow text-[14px] text-black/80 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-black/[0.06] transition-all placeholder:text-black/20'
  const hasErrors = Object.keys(formik.errors).length > 0
  const needsPayment = planId ? isPaidPlan(planId) && planId !== 'enterprise' : false

  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_280px] gap-5 items-start">
      <div className="bg-white nice-shadow rounded-2xl p-7">
        {error && (
          <div className="flex items-center gap-2.5 bg-red-50 rounded-xl px-4 py-3 mb-5 text-red-600 border border-red-100">
            <Info size={14} className="flex-shrink-0" />
            <span className="text-[13px] font-medium">{error}</span>
          </div>
        )}
        <Form.Root onSubmit={formik.handleSubmit} className="space-y-5">
          <Form.Field name="name">
            <FormLabelAndMessage
              label={t('hub_new.createOrg.fields.name', { defaultValue: 'Organization name' })}
              message={formik.errors.name === 'test_hint' ? undefined : (formik.errors.name as string)}
            />
            <Form.Control asChild>
              <input
                className={inputCls}
                onChange={handleNameChange}
                value={formik.values.name}
                type="text"
                placeholder={t('hub_new.createOrg.placeholders.name', { defaultValue: 'Acme Academy' })}
                required
              />
            </Form.Control>
            {formik.errors.name === 'test_hint' && <TestHint t={t} />}
          </Form.Field>

          <Form.Field name="description">
            <FormLabelAndMessage
              label={t('hub_new.createOrg.fields.description', { defaultValue: 'Description (optional)' })}
            />
            <Form.Control asChild>
              <input
                className={inputCls}
                onChange={formik.handleChange}
                value={formik.values.description}
                type="text"
                placeholder={t('hub_new.createOrg.placeholders.description', {
                  defaultValue: 'What is your organization about?',
                })}
              />
            </Form.Control>
          </Form.Field>

          <Form.Field name="slug">
            <FormLabelAndMessage
              label={t('hub_new.createOrg.fields.slug', { defaultValue: 'Address' })}
              message={formik.errors.slug === 'test_hint' ? undefined : (formik.errors.slug as string)}
            />
            <div className="flex items-center rounded-xl overflow-hidden nice-shadow focus-within:ring-2 focus-within:ring-black/[0.06] transition-all">
              <Form.Control asChild>
                <input
                  className="flex-1 bg-white text-[14px] text-black/80 px-4 py-3 focus:outline-none placeholder:text-black/20"
                  onChange={handleSlugChange}
                  value={formik.values.slug}
                  placeholder="your-org"
                  type="text"
                  required
                />
              </Form.Control>
              <span className="px-4 py-3 bg-gray-50 text-black/25 border-l border-gray-100 shrink-0 text-[13px] font-medium select-none">
                .learnhouse.io
              </span>
            </div>
            {formik.errors.slug === 'test_hint' && <TestHint t={t} />}
          </Form.Field>

          <Form.Submit asChild>
            <motion.button
              disabled={hasErrors || submitting}
              whileTap={hasErrors || submitting ? {} : { scale: 0.98 }}
              className={`w-full flex items-center justify-center gap-2 text-[14px] font-semibold py-3 rounded-xl transition-colors mt-1 ${
                hasErrors || submitting
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-gray-900 hover:bg-gray-800 text-white cursor-pointer'
              }`}
            >
              {submitting ? (
                <>
                  <Loader size={15} className="animate-spin" />
                  {t('hub_new.createOrg.submitting', { defaultValue: 'Creating…' })}
                </>
              ) : (
                <>
                  {needsPayment
                    ? t('hub_new.createOrg.submitPaid', { defaultValue: 'Create & continue to payment' })
                    : t('hub_new.createOrg.submit', { defaultValue: 'Create organization' })}
                  <ArrowRight size={15} />
                </>
              )}
            </motion.button>
          </Form.Submit>
        </Form.Root>
      </div>
      {planId && (
        <PlanSummaryCard
          planId={planId}
          billing={billing}
          priceOverrides={prices?.plans}
          planLimits={prices?.limits}
        />
      )}
    </div>
  )
}

// ── Success (cross-domain handoff into the new org app) ────────────────────────

function CreateOrgSuccess({ slug, t }: { slug: string; t: any }) {
  const [going, setGoing] = useState(false)

  const handleGoToOrg = async (e: React.MouseEvent) => {
    e.preventDefault()
    if (going) return
    setGoing(true)
    // Single-domain (.io) consolidation: the apex and the org subdomain share
    // the .{top_domain}-scoped session cookie, so the session already covers the
    // subdomain — no cross-domain code-mint/token-exchange handoff is needed.
    // Refresh once to mint a fresh access token, then land on the new org's
    // onboarding (the first page for a brand-new org).
    try {
      await fetch('/api/auth/refresh', { credentials: 'include' })
    } catch {
      /* non-fatal — the existing session cookie still carries over */
    }
    window.location.href = getUriWithOrg(slug, '/dash/onboarding')
  }

  return (
    <div className="flex flex-col items-center py-10 text-center">
      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mb-4"
      >
        <Check size={32} className="text-emerald-600" />
      </motion.div>
      <h2 className="text-xl font-bold text-gray-900 mb-2">
        {t('hub_new.success.title', { defaultValue: 'Your organization is ready' })}
      </h2>
      <p className="text-sm text-gray-500 mb-6">
        {t('hub_new.success.description', { defaultValue: 'Jump in and start building your courses.' })}
      </p>
      <div className="flex items-center gap-3">
        <button
          onClick={handleGoToOrg}
          disabled={going}
          className="inline-flex items-center gap-2 bg-gray-900 hover:bg-gray-800 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
        >
          {going ? (
            <>
              <Loader size={15} className="animate-spin" />
              {t('hub_new.success.goToOrg', { defaultValue: 'Go to organization' })}
            </>
          ) : (
            <>
              {t('hub_new.success.goToOrg', { defaultValue: 'Go to organization' })}
              <ArrowRight size={15} />
            </>
          )}
        </button>
        <Link
          href="/home"
          className="inline-flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-gray-700 px-4 py-2.5 rounded-xl hover:bg-gray-100 transition-colors"
        >
          {t('hub_new.success.cta', { defaultValue: 'Back to organizations' })}
        </Link>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CreateNewOrgPage() {
  const { t } = useTranslation()
  const router = useRouter()
  const queryClient = useQueryClient()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const isAuthenticated = session?.status === 'authenticated'
  const isLoading = session?.status === 'loading'

  const [step, setStep] = useState<Step>('use-type')
  const [dir, setDir] = useState<1 | -1>(1)
  const [useType, setUseType] = useState<UseType>(null)
  const [personalGoals, setPersonalGoals] = useState<string[]>([])
  const [orgUsage, setOrgUsage] = useState({ teamSize: '', useCase: '' })
  const [selectedPlan, setSelectedPlan] = useState<PlanId | null>(null)
  const [billing, setBilling] = useState<Billing>('monthly')
  const [createdSlug, setCreatedSlug] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Redirect unauthenticated users (same effect as app/home/home.tsx).
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/login')
    }
  }, [isLoading, isAuthenticated, router])

  // Load the user's existing orgs to detect whether they already have a free org
  // (which makes the free plan unavailable, mirroring the platform's 1-free-org cap).
  const { data: orgs } = useQuery({
    queryKey: ['orgs', 'user'],
    queryFn: () => apiFetch(`${getAPIUrl()}orgs/user/page/1/limit/50`, access_token),
    enabled: isAuthenticated,
    staleTime: 60_000,
  })
  const hasFreeOrg = Array.isArray(orgs)
    ? orgs.some((o: any) => {
        const plan = o.config?.config?.plan ?? o.config?.config?.cloud?.plan ?? 'free'
        return plan === 'free'
      })
    : false

  // Live Stripe prices/limits overlay (same source as the billing hub). Falls
  // back to the static canonical catalog when the endpoint is unavailable.
  const { data: prices, isLoading: pricesLoading } = useQuery({
    queryKey: ['billing', 'prices'],
    queryFn: () => fetchPrices(),
    staleTime: 5 * 60_000,
  })

  const canAdvanceUsage =
    useType === 'personal'
      ? personalGoals.length > 0
      : orgUsage.teamSize !== '' && orgUsage.useCase !== ''

  const handleSelectPlan = (planId: PlanId, b: Billing) => {
    setSelectedPlan(planId)
    setBilling(b)
    setDir(1)
    setStep('create-org')
  }

  const handleCreate = async (values: { name: string; description: string; slug: string }) => {
    if (submitting) return
    setSubmitting(true)
    setError('')
    const toastId = toast.loading(t('hub_new.toast.creating', { defaultValue: 'Creating organization…' }))
    try {
      const newOrg = await createNewOrganization(
        {
          name: values.name,
          description: values.description,
          slug: values.slug,
          email: session?.data?.user?.email ?? '',
          logo_image: '',
        },
        access_token
      )
      const newSlug = newOrg?.slug ?? values.slug
      // Refresh session and invalidate the cached org list so the new org appears.
      try {
        await session?.update?.(true)
      } catch {
        /* no-op */
      }
      queryClient.invalidateQueries({ queryKey: ['orgs', 'user'] })
      toast.dismiss(toastId)
      toast.success(t('hub_new.toast.created', { defaultValue: 'Organization created!' }))

      const plan = findPlan(selectedPlan ?? '')
      const needsCheckout = plan && isPaidPlan(plan.id) && plan.id !== 'enterprise'
      if (needsCheckout) {
        try {
          const res = await fetch('/api/billing/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              plan: selectedPlan,
              billing,
              orgId: newOrg.id,
              orgSlug: newSlug,
            }),
            credentials: 'include',
          })
          const data = await res.json().catch(() => null)
          if (res.ok && data?.url) {
            window.location.href = data.url
            return
          }
          toast.error(
            t('hub_new.toast.checkoutFailed', {
              defaultValue: 'Organization created — you can upgrade from Plan & Usage.',
            })
          )
        } catch {
          toast.error(
            t('hub_new.toast.checkoutFailed', {
              defaultValue: 'Organization created — you can upgrade from Plan & Usage.',
            })
          )
        }
      }
      setCreatedSlug(newSlug)
      setDir(1)
      setStep('success')
    } catch (e: any) {
      toast.dismiss(toastId)
      const fallback = t('hub_new.toast.failed', { defaultValue: 'Failed to create organization' })
      const msg = friendlyCreateError(e, fallback)
      toast.error(msg)
      setError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  // Navigation helpers
  const goBack = () => {
    setDir(-1)
    if (step === 'usage') setStep('use-type')
    else if (step === 'choose-plan') setStep('usage')
    else if (step === 'create-org') setStep('choose-plan')
  }
  const advance = () => {
    setDir(1)
    if (step === 'use-type' && useType) setStep('usage')
    else if (step === 'usage' && canAdvanceUsage) setStep('choose-plan')
  }
  const skip = () => {
    setDir(1)
    setStep('choose-plan')
  }

  const stepNumber = STEP_NUMBER[step]
  const isWide = step === 'choose-plan' || step === 'create-org'
  const showSkip = step === 'use-type' || step === 'usage'
  const showNav = step === 'use-type' || step === 'usage'
  const showBack = step !== 'use-type' && step !== 'success'
  const canContinue = step === 'use-type' ? useType !== null : canAdvanceUsage

  const META: Record<Step, { title: string; subtitle: string }> = {
    'use-type': {
      title: t('hub_new.steps.useType.title', { defaultValue: 'What are you creating?' }),
      subtitle: t('hub_new.steps.useType.subtitle', { defaultValue: 'This helps us tailor your space.' }),
    },
    usage: {
      title: t('hub_new.steps.usage.title', { defaultValue: 'Tell us a bit more' }),
      subtitle: t('hub_new.steps.usage.subtitle', { defaultValue: 'So we can recommend the right setup.' }),
    },
    'choose-plan': {
      title: t('hub_new.steps.choosePlan.title', { defaultValue: 'Choose a plan' }),
      subtitle: t('hub_new.steps.choosePlan.subtitle', { defaultValue: 'You can change this anytime.' }),
    },
    'create-org': {
      title: t('hub_new.steps.createOrg.title', { defaultValue: 'Name your organization' }),
      subtitle: t('hub_new.steps.createOrg.subtitle', { defaultValue: 'Pick a name and a web address.' }),
    },
    success: {
      title: t('hub_new.steps.success.title', { defaultValue: 'All set' }),
      subtitle: '',
    },
  }
  const meta = META[step]

  const showLoader = isLoading || (isAuthenticated && !session?.data)

  return (
    <div className="fixed inset-0 z-[100] bg-white overflow-y-auto">
      <div className="relative min-h-screen">
        {/* Blueprint grid — fades in from bottom */}
        <div
          className="absolute inset-0 pointer-events-none z-0"
          style={{
            backgroundImage: `
              linear-gradient(rgba(0,0,0,0.035) 1px, transparent 1px),
              linear-gradient(90deg, rgba(0,0,0,0.035) 1px, transparent 1px),
              linear-gradient(rgba(0,0,0,0.018) 1px, transparent 1px),
              linear-gradient(90deg, rgba(0,0,0,0.018) 1px, transparent 1px)
            `,
            backgroundSize: '80px 80px, 80px 80px, 16px 16px, 16px 16px',
            maskImage: 'linear-gradient(to top, black 0%, transparent 60%)',
            WebkitMaskImage: 'linear-gradient(to top, black 0%, transparent 60%)',
          }}
        />

        <div className="relative z-10 min-h-screen flex flex-col items-center py-8 px-4">
          {/* Top bar */}
          <div className="w-full max-w-5xl mb-10 grid grid-cols-3 items-center">
            <Link
              href="/home"
              className="flex items-center gap-1.5 text-sm font-semibold text-black/35 hover:text-black transition-colors w-fit"
            >
              <ArrowLeft size={14} />
              {t('hub_new.topBar.back', { defaultValue: 'Organizations' })}
            </Link>
            <div className="flex justify-center">
              <Link href="/home">
                { }
                <img src="/lrn.svg" alt="LearnHouse" width={40} height={40} className="opacity-90" />
              </Link>
            </div>
            <div className="flex justify-end">
              {isAuthenticated && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button aria-label="User menu" className="rounded-full">
                      <UserAvatar border="border-2" rounded="rounded-full" width={34} />
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
                      className="flex items-center space-x-2 text-red-600 focus:text-red-600"
                    >
                      <LogOut size={16} />
                      <span>{t('user.sign_out', { defaultValue: 'Sign out' })}</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>

          <div className={`w-full transition-all duration-300 ${isWide ? 'max-w-5xl' : 'max-w-xl'}`}>
            {showLoader ? (
              <div className="space-y-3">
                <div className="h-40 w-full rounded-2xl bg-black/[0.03] animate-pulse" />
                <div className="h-40 w-full rounded-2xl bg-black/[0.03] animate-pulse" />
              </div>
            ) : (
              <>
                {/* Header */}
                <AnimatePresence mode="wait" custom={dir}>
                  <motion.div
                    key={`hdr-${step}`}
                    custom={dir}
                    variants={slide}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={trans}
                    className="text-center mb-8"
                  >
                    <div className="flex justify-center mb-5">
                      <StepPills current={stepNumber} />
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900 tracking-tight mb-2">{meta.title}</h1>
                    {meta.subtitle && (
                      <p className="text-sm text-gray-500 max-w-sm mx-auto leading-relaxed">{meta.subtitle}</p>
                    )}
                  </motion.div>
                </AnimatePresence>

                {/* Body */}
                <AnimatePresence mode="wait" custom={dir}>
                  <motion.div
                    key={`body-${step}`}
                    custom={dir}
                    variants={slide}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={trans}
                  >
                    {step === 'use-type' && <StepUseType useType={useType} onSelect={setUseType} t={t} />}
                    {step === 'usage' && useType === 'personal' && (
                      <StepUsagePersonal goals={personalGoals} onChange={setPersonalGoals} t={t} />
                    )}
                    {step === 'usage' && useType === 'organization' && (
                      <StepUsageOrg data={orgUsage} onChange={setOrgUsage} t={t} />
                    )}
                    {step === 'choose-plan' && (
                      <PricingCards
                        defaultPlanType={useType === 'personal' ? 'personal' : 'general'}
                        defaultBilling="annual"
                        showEnterprise
                        priceOverrides={prices?.plans}
                        planLimits={prices?.limits}
                        pricesLoading={pricesLoading}
                        onSelect={handleSelectPlan}
                        renderCta={
                          hasFreeOrg
                            ? (plan) =>
                                plan.id === 'free' ? (
                                  <span className="block w-full text-center px-5 py-2.5 rounded-lg text-[14px] font-bold bg-black/[0.04] text-black/30 cursor-not-allowed">
                                    {t('hub_new.freeLimit', { defaultValue: '1 free org limit reached' })}
                                  </span>
                                ) : null
                            : undefined
                        }
                      />
                    )}
                    {step === 'create-org' && (
                      <CreateOrgForm
                        planId={selectedPlan}
                        billing={billing}
                        prices={prices}
                        submitting={submitting}
                        error={error}
                        onSubmit={handleCreate}
                        t={t}
                      />
                    )}
                    {step === 'success' && createdSlug && <CreateOrgSuccess slug={createdSlug} t={t} />}
                  </motion.div>
                </AnimatePresence>

                {/* Navigation */}
                {(showNav || (showBack && step === 'create-org')) && (
                  <div className={`flex items-center mt-6 ${showBack ? 'justify-between' : 'justify-end'}`}>
                    {showBack && (
                      <button
                        onClick={goBack}
                        className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 rounded-xl hover:bg-gray-100 transition-colors cursor-pointer"
                      >
                        <ArrowLeft size={14} />
                        {t('hub_new.navigation.back', { defaultValue: 'Back' })}
                      </button>
                    )}
                    {showNav && (
                      <motion.button
                        onClick={advance}
                        disabled={!canContinue}
                        whileTap={canContinue ? { scale: 0.97 } : {}}
                        className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
                          canContinue
                            ? 'bg-gray-900 text-white hover:bg-gray-800 nice-shadow cursor-pointer'
                            : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        }`}
                      >
                        {t('hub_new.navigation.continue', { defaultValue: 'Continue' })}
                        <ArrowRight size={15} />
                      </motion.button>
                    )}
                  </div>
                )}

                {/* Back-only row for choose-plan (cards carry their own CTA) */}
                {step === 'choose-plan' && (
                  <div className="flex items-center mt-6 justify-start">
                    <button
                      onClick={goBack}
                      className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 rounded-xl hover:bg-gray-100 transition-colors cursor-pointer"
                    >
                      <ArrowLeft size={14} />
                      {t('hub_new.navigation.back', { defaultValue: 'Back' })}
                    </button>
                  </div>
                )}

                {/* Skip */}
                {showSkip && (
                  <p className="text-center mt-3">
                    <button
                      onClick={skip}
                      className="text-xs text-gray-400 hover:text-gray-500 transition-colors hover:underline underline-offset-2 cursor-pointer"
                    >
                      {t('hub_new.navigation.skip', { defaultValue: 'Skip' })}
                    </button>
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
