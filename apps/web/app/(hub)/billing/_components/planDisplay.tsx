'use client'
// Display data for the upgrade flow, mirroring the marketing V2 pricing page
// (platform: app/(i18n)/[locale]/(Landing)/pricing/pricing.tsx): the per-plan
// look (badge, card pattern, icon tint, button), the short highlight list on
// each card, and the "compare all features" table. Prices and limits still
// come from the catalog in _billing/plans.ts, overridden by Stripe/plans.py.
import React from 'react'
import {
  BookOpen,
  Buildings,
  CalendarCheck,
  ChalkboardSimple,
  ChartBar,
  ChartLineUp,
  ChatsCircle,
  Circuitry,
  ClockCounterClockwise,
  ClosedCaptioning,
  Code,
  CurrencyCircleDollar,
  DeviceMobile,
  Devices,
  EnvelopeSimple,
  Files,
  FlowArrow,
  Garage,
  Globe,
  GlobeStand,
  HandCoins,
  HardDrives,
  Headset,
  Infinity as InfinityIcon,
  Key,
  Lifebuoy,
  Lightning,
  LinkSimple,
  LockKey,
  Medal,
  Package,
  SealCheck,
  ShieldCheck,
  Sparkle,
  SquaresFour,
  Ticket,
  Translate,
  TreeStructure,
  UserGear,
  Users,
  UsersFour,
  VideoCamera,
  ArrowSquareIn,
  type Icon,
} from '@phosphor-icons/react'
import { formatCurrency } from '@/lib/format'
import { findPlan, type PlanLimits, type PriceOverrides } from '../_lib/plans'

type TFn = (..._args: any[]) => any

/** Plans shown as cards, in order. Free sits in its own strip under them. */
export const CARD_PLANS = ['standard', 'pro', 'business', 'enterprise'] as const
export type CardPlanId = (typeof CARD_PLANS)[number]

export type AccentKey = 'free' | 'standard' | 'pro' | 'business' | 'enterprise' | 'enterpriseLight'

type Pat = { kind: 'dots' | 'plus' | 'hatch' | 'grid' | 'rings'; color: string; alpha: number }

/** Per-plan look, same values as the marketing pricing page. */
export const ACCENT: Record<AccentKey, { badge: string; pat: Pat; icon: string; cta: string; ring: string; soft: string }> = {
  free: {
    badge: 'bg-gradient-to-br from-gray-100 to-gray-200 text-gray-700 border-gray-200 shadow-gray-200/50',
    pat: { kind: 'dots', color: '#525252', alpha: 0.3 },
    icon: 'text-gray-500',
    cta: 'bg-neutral-900 hover:bg-neutral-800 text-white',
    ring: 'ring-neutral-900/70',
    soft: 'bg-neutral-50',
  },
  standard: {
    badge: 'bg-gradient-to-br from-blue-100 to-blue-200 text-blue-800 border-blue-200 shadow-blue-200/50',
    pat: { kind: 'dots', color: '#2563eb', alpha: 0.38 },
    icon: 'text-blue-600',
    cta: 'bg-blue-600 hover:bg-blue-700 text-white',
    ring: 'ring-blue-500',
    soft: 'bg-blue-50/60',
  },
  pro: {
    badge: 'bg-gradient-to-br from-purple-100 to-purple-200 text-purple-800 border-purple-200 shadow-purple-200/50',
    pat: { kind: 'plus', color: '#9333ea', alpha: 0.26 },
    icon: 'text-purple-600',
    cta: 'bg-purple-600 hover:bg-purple-700 text-white',
    ring: 'ring-purple-500',
    soft: 'bg-purple-50/60',
  },
  business: {
    badge: 'bg-gradient-to-br from-teal-100 to-teal-200 text-teal-800 border-teal-200 shadow-teal-200/50',
    pat: { kind: 'hatch', color: '#0d9488', alpha: 0.2 },
    icon: 'text-teal-600',
    cta: 'bg-teal-700 hover:bg-teal-800 text-white',
    ring: 'ring-teal-600',
    soft: 'bg-teal-50/60',
  },
  enterprise: {
    badge: 'bg-gradient-to-br from-amber-900/40 to-amber-800/30 text-amber-300 border-amber-700/30 shadow-amber-900/30',
    pat: { kind: 'grid', color: '#fbbf24', alpha: 0.15 },
    icon: 'text-amber-300',
    cta: 'bg-white text-black hover:bg-white/90',
    ring: 'ring-amber-400',
    soft: 'bg-amber-50/60',
  },
  // Enterprise on a light surface (compare table header, confirm tiles).
  enterpriseLight: {
    badge: 'bg-gradient-to-br from-amber-100 to-yellow-200 text-amber-800 border-amber-200 shadow-amber-200/50',
    pat: { kind: 'rings', color: '#d97706', alpha: 0.2 },
    icon: 'text-amber-600',
    cta: 'bg-neutral-900 hover:bg-neutral-800 text-white',
    ring: 'ring-amber-500',
    soft: 'bg-amber-50/60',
  },
}

/** Accent for a plan id on a light surface. Retired/unknown plans look like Free. */
export function accentFor(planId: string): AccentKey {
  if (planId === 'enterprise') return 'enterpriseLight'
  if (planId === 'standard' || planId === 'pro' || planId === 'business') return planId
  return 'free'
}

const PATTERN_TILE: Record<Pat['kind'], { size: number; body: (_c: string) => string }> = {
  dots: { size: 15, body: (c) => `<circle cx='1.5' cy='1.5' r='0.9' fill='${c}'/>` },
  plus: { size: 18, body: (c) => `<path d='M9 6.5v5M6.5 9h5' stroke='${c}' stroke-width='0.75'/>` },
  hatch: { size: 10, body: (c) => `<path d='M-1 1L1 -1M0 10L10 0M9 11L11 9' stroke='${c}' stroke-width='0.6'/>` },
  grid: { size: 18, body: (c) => `<path d='M18 .5H.5V18' fill='none' stroke='${c}' stroke-width='0.6'/>` },
  rings: { size: 18, body: (c) => `<circle cx='9' cy='9' r='2.75' fill='none' stroke='${c}' stroke-width='0.7'/>` },
}

/** A quiet tiled pattern in the plan colour, faded out towards the bottom. */
export function patternStyle({ kind, color, alpha }: Pat): React.CSSProperties {
  const { size, body } = PATTERN_TILE[kind]
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' opacity='${alpha}'>${body(color)}</svg>`
  const fade = 'linear-gradient(to bottom, #000 0%, rgba(0,0,0,0.5) 40%, transparent 100%)'
  return {
    backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`,
    backgroundSize: `${size}px ${size}px`,
    maskImage: fade,
    WebkitMaskImage: fade,
  }
}

/** The plan-name badge (full or mini, as on the marketing cards). */
export function PlanBadge({ accent, children, mini = false }: { accent: AccentKey; children: React.ReactNode; mini?: boolean }) {
  return (
    <span
      className={`inline-flex w-fit items-center font-semibold border whitespace-nowrap ${ACCENT[accent].badge} ${
        mini ? 'px-1 py-px text-[9px] rounded' : 'px-2 py-1 text-xs rounded-md shadow-sm'
      }`}
    >
      {children}
    </span>
  )
}

// ── Limits ───────────────────────────────────────────────────────────────────

const num = (s?: string) => {
  const n = parseInt(String(s ?? '').replace(/[^\d]/g, ''), 10)
  return Number.isNaN(n) ? undefined : n
}

/** A plan's limit: live (plans.py via /api/billing/prices) first, catalog second. 0 = unlimited. */
export function planLimit(
  planId: string,
  key: 'members' | 'admin_seats' | 'courses' | 'ai_credits',
  limits?: PlanLimits,
): number | undefined {
  const live = limits?.[planId]?.[key]
  if (typeof live === 'number') return live
  const plan = findPlan(planId)
  if (!plan) return undefined
  if (key === 'ai_credits') return num(plan.features.find((f) => f.badgeLimitKey === 'ai_credits')?.badge)
  const f = plan.features.find((x) => x.limitKey === key)
  if (!f) return undefined
  return /^unlimited/i.test(f.label) ? 0 : num(f.label)
}

// ── Card highlights ──────────────────────────────────────────────────────────

export interface Highlight {
  icon: Icon
  label: string
  /** Small grey chip after the label (admin seats on the members line). */
  chip?: string
}

const STATIC_HIGHLIGHTS: Record<CardPlanId, [Icon, string, string][]> = {
  standard: [
    [GlobeStand, 'atlas', 'Atlas AI & course translation'],
    [CurrencyCircleDollar, 'payments', 'Payments with 0% platform fees'],
    [CalendarCheck, 'drip', 'Drip content & discount codes'],
    [Garage, 'communities', 'Communities & podcasts'],
    [DeviceMobile, 'app', 'iOS & Android app'],
    [ChartBar, 'analytics', 'Analytics'],
  ],
  pro: [
    [Globe, 'domain', 'Custom domain'],
    [Medal, 'cert_paths', 'Certificates & learning paths'],
    [Lightning, 'plays', 'Plays with streaks & badges'],
    [Code, 'api', 'API, MCP & webhooks'],
    [Headset, 'support', 'Priority support'],
  ],
  business: [
    [Buildings, 'seats', 'Sell to companies (B2B seats)'],
    [SealCheck, 'training', 'Required training & manager reports'],
    [VideoCamera, 'live', 'Live sessions with recordings'],
    [Key, 'identity', 'SSO, SCIM, LTI & SCORM'],
    [ShieldCheck, 'audit', 'Audit logs'],
  ],
  enterprise: [
    [Buildings, 'hubs', 'Multiple hubs & organizations'],
    [DeviceMobile, 'one_app', 'One mobile app for all hubs'],
    [SquaresFour, 'console', 'One console for every hub'],
    [HardDrives, 'dedicated', 'Dedicated or self-hosted'],
    [Lifebuoy, 'sla', 'SLA & account manager'],
  ],
}

/** The short list on a plan card: members (with admin seats), AI credits, then what the plan adds. */
export function planHighlights(t: TFn, planId: CardPlanId, limits?: PlanLimits): Highlight[] {
  const P = 'billing.flow.cards'
  const out: Highlight[] = []
  if (planId === 'enterprise') {
    out.push({ icon: InfinityIcon, label: t(`${P}.members_admins`, { defaultValue: 'Unlimited members & admins' }) })
  } else {
    const members = planLimit(planId, 'members', limits)
    const admins = planLimit(planId, 'admin_seats', limits)
    out.push({
      icon: Users,
      label: !members
        ? t(`${P}.members_unlimited`, { defaultValue: 'Unlimited members' })
        : t(`${P}.members_up_to`, { count: members, formatted: members.toLocaleString() }),
      chip: admins ? t(`${P}.admin_chip`, { count: admins, formatted: admins.toLocaleString() }) : undefined,
    })
    const credits = planLimit(planId, 'ai_credits', limits)
    if (credits && credits > 0) {
      out.push({ icon: Sparkle, label: t(`${P}.credits_month`, { formatted: credits.toLocaleString() }) })
    }
  }
  for (const [icon, key, fallback] of STATIC_HIGHLIGHTS[planId]) {
    out.push({ icon, label: t(`${P}.${planId}.${key}`, { defaultValue: fallback }) })
  }
  return out
}

const TAGLINES: Record<string, string> = {
  free: 'Explore the basics, no commitment.',
  standard: 'Sell courses and grow a community.',
  pro: 'Run your own branded academy.',
  business: 'Train companies and teams.',
  enterprise: 'Run every school from one place.',
}

export function planTaglineV2(t: TFn, planId: string, fallback = ''): string {
  return t(`billing.flow.taglines.${planId.replace(/-/g, '_')}`, { defaultValue: TAGLINES[planId] ?? fallback })
}

// ── Compare table ────────────────────────────────────────────────────────────

/** A cell: included, not included, or a value to print. */
export type Cell = boolean | string
export interface CompareRow {
  key: string
  icon: Icon
  /** Standard, Pro, Business, Enterprise. */
  cells: [Cell, Cell, Cell, Cell]
}
export interface CompareGroup {
  key: string
  tint: string
  rows: CompareRow[]
}

const Y = true
const N = false

/** Same rows as the marketing compare table; seat and credit counts come from the live limits. */
export function compareGroups(t: TFn, limits?: PlanLimits): CompareGroup[] {
  const R = 'billing.flow.rows'
  const count = (planId: string, key: 'admin_seats' | 'ai_credits') => {
    const n = planLimit(planId, key, limits)
    if (n === undefined) return N
    return n === 0 ? t(`${R}.unlimited`, { defaultValue: 'Unlimited' }) : n.toLocaleString()
  }
  const yrs = (n: number) => t(`${R}.history_years`, { count: n })
  return [
    {
      key: 'g_limits',
      tint: 'text-blue-500',
      rows: [
        { key: 'members', icon: Users, cells: [Y, Y, Y, Y] },
        { key: 'admin_seats', icon: UserGear, cells: [count('standard', 'admin_seats'), count('pro', 'admin_seats'), count('business', 'admin_seats'), t(`${R}.unlimited`, { defaultValue: 'Unlimited' })] },
        { key: 'ai_credits', icon: Sparkle, cells: [count('standard', 'ai_credits'), count('pro', 'ai_credits'), count('business', 'ai_credits'), t(`${R}.custom`, { defaultValue: 'Custom' })] },
      ],
    },
    {
      key: 'g_teach',
      tint: 'text-rose-500',
      rows: [
        { key: 'courses', icon: BookOpen, cells: [Y, Y, Y, Y] },
        { key: 'payments', icon: CurrencyCircleDollar, cells: [Y, Y, Y, Y] },
        { key: 'discounts', icon: Ticket, cells: [Y, Y, Y, Y] },
        { key: 'affiliates', icon: HandCoins, cells: [N, Y, Y, Y] },
        { key: 'seats', icon: Buildings, cells: [N, N, Y, Y] },
        { key: 'drip', icon: CalendarCheck, cells: [Y, Y, Y, Y] },
        { key: 'import', icon: ArrowSquareIn, cells: [Y, Y, Y, Y] },
        { key: 'paths', icon: Circuitry, cells: [N, Y, Y, Y] },
        { key: 'certificates', icon: Medal, cells: [N, Y, Y, Y] },
        { key: 'plays', icon: Lightning, cells: [N, Y, Y, Y] },
        { key: 'boards', icon: ChalkboardSimple, cells: [N, Y, Y, Y] },
        { key: 'live', icon: VideoCamera, cells: [N, N, Y, Y] },
      ],
    },
    {
      key: 'g_community',
      tint: 'text-purple-500',
      rows: [
        { key: 'communities', icon: Garage, cells: [Y, Y, Y, Y] },
        { key: 'messaging', icon: ChatsCircle, cells: [Y, Y, Y, Y] },
        { key: 'mobile_app', icon: DeviceMobile, cells: [Y, Y, Y, Y] },
        { key: 'atlas', icon: GlobeStand, cells: [Y, Y, Y, Y] },
        { key: 'ai_builder', icon: Files, cells: [Y, Y, Y, Y] },
        { key: 'captions', icon: ClosedCaptioning, cells: [N, Y, Y, Y] },
        { key: 'translation', icon: Translate, cells: [Y, Y, Y, Y] },
        { key: 'scheduled_agents', icon: GlobeStand, cells: [N, N, Y, Y] },
      ],
    },
    {
      key: 'g_brand',
      tint: 'text-teal-600',
      rows: [
        { key: 'domain', icon: Globe, cells: [N, Y, Y, Y] },
        { key: 'api', icon: Code, cells: [N, Y, Y, Y] },
        { key: 'webhooks', icon: FlowArrow, cells: [N, Y, Y, Y] },
        { key: 'emails', icon: EnvelopeSimple, cells: [Y, Y, Y, Y] },
        { key: 'hubs', icon: Buildings, cells: [N, N, N, Y] },
        { key: 'one_app', icon: Devices, cells: [N, N, N, Y] },
        { key: 'console', icon: SquaresFour, cells: [N, N, N, Y] },
      ],
    },
    {
      key: 'g_teams',
      tint: 'text-amber-600',
      rows: [
        { key: 'two_factor', icon: LockKey, cells: [Y, Y, Y, Y] },
        { key: 'analytics', icon: ChartBar, cells: [Y, Y, Y, Y] },
        { key: 'advanced_analytics', icon: ChartLineUp, cells: [N, Y, Y, Y] },
        { key: 'training', icon: SealCheck, cells: [N, N, Y, Y] },
        { key: 'manager_reports', icon: TreeStructure, cells: [N, N, Y, Y] },
        { key: 'roles', icon: UserGear, cells: [N, Y, Y, Y] },
        { key: 'sso', icon: Key, cells: [N, N, Y, Y] },
        { key: 'scim', icon: UsersFour, cells: [N, N, Y, Y] },
        { key: 'lti', icon: LinkSimple, cells: [N, N, Y, Y] },
        { key: 'scorm', icon: Package, cells: [N, N, Y, Y] },
        { key: 'audit', icon: ShieldCheck, cells: [N, N, Y, Y] },
        { key: 'history', icon: ClockCounterClockwise, cells: [yrs(1), yrs(1), yrs(3), yrs(7)] },
        { key: 'self_hosted', icon: HardDrives, cells: [N, N, N, Y] },
      ],
    },
    {
      key: 'g_support',
      tint: 'text-neutral-500',
      rows: [
        {
          key: 'support',
          icon: Headset,
          cells: [
            t(`${R}.support_email`, { defaultValue: 'Email' }),
            t(`${R}.support_priority`, { defaultValue: 'Priority' }),
            t(`${R}.support_setup`, { defaultValue: 'Priority + setup call' }),
            t(`${R}.support_sla`, { defaultValue: 'SLA + account manager' }),
          ],
        },
      ],
    },
  ]
}

export function rowLabel(t: TFn, key: string): string {
  return t(`billing.flow.rows.${key}`)
}

/**
 * Features a move from one card plan to another adds or removes, read off the
 * compare table (yes/no rows only). Null when either side isn't a column.
 */
export function featureDiff(
  t: TFn,
  fromId: string,
  toId: string,
): { gained: CompareRow[]; lost: CompareRow[] } | null {
  const from = (CARD_PLANS as readonly string[]).indexOf(fromId)
  const to = (CARD_PLANS as readonly string[]).indexOf(toId)
  if (from < 0 || to < 0) return null
  const rows = compareGroups(t).flatMap((g) => g.rows)
  return {
    gained: rows.filter((r) => r.cells[from] === false && r.cells[to] === true),
    lost: rows.filter((r) => r.cells[from] === true && r.cells[to] === false),
  }
}

// ── Money ────────────────────────────────────────────────────────────────────

/** Currency code for a plan's price (Stripe override first, then any override, then USD). */
export function planCurrency(planId: string, overrides?: PriceOverrides): string {
  return (overrides?.[planId]?.currency ?? Object.values(overrides ?? {})[0]?.currency ?? 'usd').toUpperCase()
}

/** Whole-unit price in the plan's currency, e.g. "$1,716" or "1.716 €". */
export function formatPlanMoney(amount: number, planId: string, overrides: PriceOverrides | undefined, lng?: string): string {
  return formatCurrency(amount, planCurrency(planId, overrides), lng, { maximumFractionDigits: 0, minimumFractionDigits: 0 })
}

/** The full amount billed once a year (Stripe's annual total when known). */
export function annualTotal(planId: string, perMonth: number, overrides?: PriceOverrides): number {
  return overrides?.[planId]?.annualTotal || perMonth * 12
}
