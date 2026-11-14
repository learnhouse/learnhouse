'use client'
import React from 'react'
import {
  ArrowsClockwise,
  BatteryLow,
  Bell,
  BookOpen,
  Broom,
  CheckSquare,
  ClockCounterClockwise,
  Confetti,
  Copy,
  Envelope,
  EnvelopeSimple,
  Eye,
  FlowArrow,
  HandWaving,
  Heartbeat,
  Hourglass,
  Lock,
  Megaphone,
  Moon,
  Note,
  NotionLogo,
  Prohibit,
  RocketLaunch,
  ShieldWarning,
  Sparkle,
  Tag,
  Timer,
  Trash,
  TrendUp,
  Trophy,
  UserCircle,
  UserMinus,
  UsersThree,
  Warning,
  Newspaper,
} from '@phosphor-icons/react'
import type { Icon as PhosphorIcon } from '@phosphor-icons/react'

// One icon + colour per automation, so the gallery, the rules list, the editor
// and run lists all show the same face for a rule. Keyed by template; custom
// rules fall back to their first action.
//
// Tones: emerald/amber/rose/sky/violet/blue are remapped by the dark theme;
// the other hues use a translucent fill with a mid text shade that reads on
// both themes.

export type AutomationGroup = 'lifecycle' | 'growth' | 'health' | 'cleanup' | 'notifications'
export const AUTOMATION_GROUPS: AutomationGroup[] = ['lifecycle', 'growth', 'health', 'cleanup', 'notifications']

const TONE = {
  emerald: 'bg-emerald-50 text-emerald-600',
  amber: 'bg-amber-50 text-amber-600',
  rose: 'bg-rose-50 text-rose-600',
  sky: 'bg-sky-50 text-sky-600',
  violet: 'bg-violet-50 text-violet-600',
  blue: 'bg-blue-50 text-blue-600',
  pink: 'bg-pink-500/12 text-pink-500',
  indigo: 'bg-indigo-500/12 text-indigo-500',
  orange: 'bg-orange-500/12 text-orange-500',
  teal: 'bg-teal-500/12 text-teal-500',
  slate: 'bg-slate-500/12 text-slate-500',
  red: 'bg-red-500/12 text-red-500',
  neutral: 'bg-neutral-100 text-neutral-500',
} as const

interface Visual {
  Icon: PhosphorIcon
  tone: string
  group: AutomationGroup
}

const TEMPLATES: Record<string, Visual> = {
  // Lifecycle & POCs
  poc_auto_close: { Icon: Lock, tone: TONE.amber, group: 'lifecycle' },
  poc_ending_soon: { Icon: Timer, tone: TONE.sky, group: 'lifecycle' },
  trial_or_poc_ending_email: { Icon: Hourglass, tone: TONE.orange, group: 'lifecycle' },
  poc_started_alert: { Icon: RocketLaunch, tone: TONE.violet, group: 'lifecycle' },
  poc_converted_celebrate: { Icon: Trophy, tone: TONE.amber, group: 'lifecycle' },
  // Growth & onboarding
  new_org_welcome: { Icon: HandWaving, tone: TONE.emerald, group: 'growth' },
  onboarding_nudge: { Icon: BookOpen, tone: TONE.emerald, group: 'growth' },
  activation_celebration: { Icon: Confetti, tone: TONE.pink, group: 'growth' },
  upgrade_suggestion: { Icon: TrendUp, tone: TONE.indigo, group: 'growth' },
  winback_dormant: { Icon: ArrowsClockwise, tone: TONE.teal, group: 'growth' },
  ai_heavy_user: { Icon: Sparkle, tone: TONE.violet, group: 'growth' },
  big_signup_alert: { Icon: Megaphone, tone: TONE.blue, group: 'growth' },
  // Health & risk
  health_refresh: { Icon: Heartbeat, tone: TONE.rose, group: 'health' },
  at_risk_paid: { Icon: Warning, tone: TONE.amber, group: 'health' },
  low_ai_credits: { Icon: BatteryLow, tone: TONE.orange, group: 'health' },
  over_member_limit: { Icon: UsersThree, tone: TONE.sky, group: 'health' },
  inactive_paid_followup: { Icon: ClockCounterClockwise, tone: TONE.amber, group: 'health' },
  dormant_free_orgs: { Icon: Moon, tone: TONE.slate, group: 'health' },
  churn_risk_to_notion: { Icon: NotionLogo, tone: TONE.slate, group: 'health' },
  // Cleanup & safety
  auto_close_abandoned: { Icon: UserMinus, tone: TONE.rose, group: 'cleanup' },
  fake_signup_cleanup: { Icon: Broom, tone: TONE.rose, group: 'cleanup' },
  duplicate_org_signups: { Icon: Copy, tone: TONE.slate, group: 'cleanup' },
  spam_review: { Icon: ShieldWarning, tone: TONE.red, group: 'cleanup' },
  unverified_admin_reminder: { Icon: EnvelopeSimple, tone: TONE.sky, group: 'cleanup' },
  // Notifications
  weekly_digest: { Icon: Newspaper, tone: TONE.blue, group: 'notifications' },
}

const DELETE_ACTIONS = new Set(['schedule_org_deletion', 'delete_org', 'close_org'])

function fromActions(actions?: { type: string }[] | null): Visual {
  const first = Array.isArray(actions) && actions[0] ? actions[0].type : ''
  if (first.startsWith('notify')) return { Icon: Bell, tone: TONE.sky, group: 'notifications' }
  if (first.startsWith('email')) return { Icon: Envelope, tone: TONE.blue, group: 'notifications' }
  if (first.endsWith('tag')) return { Icon: Tag, tone: TONE.violet, group: 'health' }
  if (DELETE_ACTIONS.has(first) || first.includes('delete')) return { Icon: Trash, tone: TONE.rose, group: 'cleanup' }
  if (first === 'create_task') return { Icon: CheckSquare, tone: TONE.emerald, group: 'notifications' }
  return { Icon: FlowArrow, tone: TONE.neutral, group: 'notifications' }
}

export function automationVisual(a: { template?: string | null; key?: string; actions?: { type: string }[] | null }): Visual {
  const key = a.template || a.key || ''
  return TEMPLATES[key] ?? fromActions(a.actions)
}

const TILE = { sm: 'h-6 w-6 rounded-md', md: 'h-8 w-8 rounded-lg', lg: 'h-10 w-10 rounded-xl' } as const
const GLYPH = { sm: 13, md: 16, lg: 20 } as const

/** The rule's icon on its coloured tile. */
export function AutomationIcon({
  automation,
  size = 'md',
  className = '',
}: {
  automation: { template?: string | null; key?: string; actions?: { type: string }[] | null } | null | undefined
  size?: keyof typeof TILE
  className?: string
}) {
  const { Icon, tone } = automationVisual(automation ?? {})
  return (
    <span aria-hidden="true" className={`${TILE[size]} shrink-0 inline-flex items-center justify-center ${tone} ${className}`}>
      <Icon size={GLYPH[size]} weight="duotone" />
    </span>
  )
}

// ─── action chips (gallery) ──────────────────────────────────────────────────

export type ActionKind = 'tag' | 'email' | 'notify' | 'task' | 'delete' | 'close' | 'poc' | 'health' | 'owner' | 'follow' | 'note' | 'lifecycle'

const KIND_ICON: Record<ActionKind, PhosphorIcon> = {
  tag: Tag,
  email: Envelope,
  notify: Bell,
  task: CheckSquare,
  delete: Trash,
  close: Prohibit,
  poc: Lock,
  health: Heartbeat,
  owner: UserCircle,
  follow: Eye,
  note: Note,
  lifecycle: FlowArrow,
}

export function actionKind(type: string): ActionKind {
  if (type.endsWith('tag')) return 'tag'
  if (type.startsWith('email')) return 'email'
  if (type.startsWith('notify')) return 'notify'
  if (type === 'create_task') return 'task'
  if (type.includes('delet')) return 'delete'
  if (type === 'close_org') return 'close'
  if (type === 'end_poc') return 'poc'
  if (type === 'compute_health') return 'health'
  if (type === 'assign_account_owner') return 'owner'
  if (type === 'follow_org') return 'follow'
  if (type === 'add_note') return 'note'
  return 'lifecycle'
}

export function ActionKindIcon({ kind, size = 12 }: { kind: ActionKind; size?: number }) {
  const Icon = KIND_ICON[kind]
  return <Icon size={size} aria-hidden="true" />
}

/** What a rule touches, for the "Uses email" / "Deletes after grace" badges. */
export function automationRisks(actions?: { type: string }[] | null) {
  const types = Array.isArray(actions) ? actions.map((a) => a.type) : []
  return {
    email: types.some((x) => x.startsWith('email')),
    deletes: types.some((x) => x.includes('delet')),
  }
}
