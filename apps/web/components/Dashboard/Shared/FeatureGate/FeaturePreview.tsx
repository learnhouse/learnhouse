'use client'
// What a locked feature looks like, before you have it: a small styled mock of
// the real screen with sample content, in the feature's own color. Pure markup
// in the kit's palette (dark.css remaps it), no images to load, nothing
// clickable, hidden from assistive tech (the copy next to it says the same).
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  ArrowFatUp,
  CalendarDots,
  ChatCircle,
  CheckCircle,
  Code,
  Globe,
  LockKey,
  LockSimple,
  Microphone,
  Play,
  SealCheck,
  ShieldCheck,
  Sparkle,
  UsersThree,
  VideoCamera,
} from '@phosphor-icons/react'
import type { FeatureKey } from '@services/features/featureMetadata'

type Kind =
  | 'discussions'
  | 'chart'
  | 'certificate'
  | 'path'
  | 'calendar'
  | 'audio'
  | 'groups'
  | 'domain'
  | 'code'
  | 'roles'
  | 'seo'
  | 'drip'
  | 'price'
  | 'sso'
  | 'log'
  | 'companies'
  | 'newsletter'
  | 'board'
  | 'play'

const KIND: Partial<Record<FeatureKey, Kind>> = {
  communities: 'discussions',
  messaging: 'discussions',
  analytics: 'chart',
  course_analytics: 'chart',
  certifications: 'certificate',
  paths: 'path',
  required_training: 'path',
  live_sessions: 'calendar',
  podcasts: 'audio',
  usergroups: 'groups',
  custom_domains: 'domain',
  api_access: 'code',
  webhooks: 'code',
  lti: 'code',
  scorm: 'code',
  roles: 'roles',
  seo: 'seo',
  drip: 'drip',
  payments: 'price',
  sso: 'sso',
  scim: 'sso',
  audit_logs: 'log',
  company_seats: 'companies',
  newsletter: 'newsletter',
  boards: 'board',
  playgrounds: 'play',
  ai: 'play',
}

/** Each feature's own color: the hero wash, the icon, the checks. Static
 *  class strings so Tailwind keeps them. */
export interface Accent {
  wash: string
  soft: string
  icon: string
  solid: string
  ring: string
  /** RGB of the hero's dot pattern. */
  dots: string
}

const ACCENTS: Record<string, Accent> = {
  teal: { wash: 'from-teal-50 via-teal-50/40', soft: 'bg-teal-50', icon: 'text-teal-600', solid: 'bg-teal-500', ring: 'ring-teal-200/70', dots: '20,184,166' },
  sky: { wash: 'from-sky-50 via-sky-50/40', soft: 'bg-sky-50', icon: 'text-sky-600', solid: 'bg-sky-500', ring: 'ring-sky-200/70', dots: '14,165,233' },
  amber: { wash: 'from-amber-50 via-amber-50/40', soft: 'bg-amber-50', icon: 'text-amber-600', solid: 'bg-amber-500', ring: 'ring-amber-200/70', dots: '245,158,11' },
  indigo: { wash: 'from-indigo-50 via-indigo-50/40', soft: 'bg-indigo-50', icon: 'text-indigo-600', solid: 'bg-indigo-500', ring: 'ring-indigo-200/70', dots: '99,102,241' },
  rose: { wash: 'from-rose-50 via-rose-50/40', soft: 'bg-rose-50', icon: 'text-rose-600', solid: 'bg-rose-500', ring: 'ring-rose-200/70', dots: '244,63,94' },
  violet: { wash: 'from-violet-50 via-violet-50/40', soft: 'bg-violet-50', icon: 'text-violet-600', solid: 'bg-violet-500', ring: 'ring-violet-200/70', dots: '139,92,246' },
  cyan: { wash: 'from-cyan-50 via-cyan-50/40', soft: 'bg-cyan-50', icon: 'text-cyan-600', solid: 'bg-cyan-500', ring: 'ring-cyan-200/70', dots: '6,182,212' },
  emerald: { wash: 'from-emerald-50 via-emerald-50/40', soft: 'bg-emerald-50', icon: 'text-emerald-600', solid: 'bg-emerald-500', ring: 'ring-emerald-200/70', dots: '16,185,129' },
  orange: { wash: 'from-orange-50 via-orange-50/40', soft: 'bg-orange-50', icon: 'text-orange-600', solid: 'bg-orange-500', ring: 'ring-orange-200/70', dots: '249,115,22' },
  pink: { wash: 'from-pink-50 via-pink-50/40', soft: 'bg-pink-50', icon: 'text-pink-600', solid: 'bg-pink-500', ring: 'ring-pink-200/70', dots: '236,72,153' },
  fuchsia: { wash: 'from-fuchsia-50 via-fuchsia-50/40', soft: 'bg-fuchsia-50', icon: 'text-fuchsia-600', solid: 'bg-fuchsia-500', ring: 'ring-fuchsia-200/70', dots: '217,70,239' },
  slate: { wash: 'from-slate-100 via-slate-50/60', soft: 'bg-slate-100', icon: 'text-slate-600', solid: 'bg-slate-600', ring: 'ring-slate-200/70', dots: '100,116,139' },
}

const FEATURE_ACCENT: Partial<Record<FeatureKey, keyof typeof ACCENTS>> = {
  communities: 'teal',
  messaging: 'teal',
  analytics: 'sky',
  course_analytics: 'sky',
  certifications: 'amber',
  paths: 'indigo',
  required_training: 'indigo',
  live_sessions: 'rose',
  podcasts: 'violet',
  usergroups: 'cyan',
  company_seats: 'cyan',
  custom_domains: 'emerald',
  seo: 'emerald',
  payments: 'emerald',
  drip: 'orange',
  newsletter: 'pink',
  boards: 'amber',
  playgrounds: 'fuchsia',
  ai: 'violet',
}

export function accentFor(feature: FeatureKey): Accent {
  return ACCENTS[FEATURE_ACCENT[feature] ?? 'slate']
}

export function hasPreview(feature: FeatureKey): boolean {
  return feature in KIND
}

const Card = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <div className={`rounded-xl bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1 ring-inset ring-neutral-900/[0.06] ${className}`}>{children}</div>
)

const Initial = ({ name, tone }: { name: string; tone: string }) => (
  <span className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${tone}`}>{name.charAt(0)}</span>
)

export default function FeaturePreview({ feature }: { feature: FeatureKey }) {
  const { t } = useTranslation()
  const kind = KIND[feature]
  if (!kind) return null
  const a = accentFor(feature)
  const P = 'common.plans.gate.preview'
  const s = (key: string) => t(`common.plans.gate.sample.${key}`)

  const body = (() => {
    switch (kind) {
      case 'discussions':
        return (
          <div className="flex flex-col gap-2">
            {[
              ['Maya', 'bg-teal-100 text-teal-700', s('discussion_1'), 12, 8],
              ['Omar', 'bg-amber-100 text-amber-700', s('discussion_2'), 5, 3],
              ['Lena', 'bg-sky-100 text-sky-700', s('discussion_3'), 9, 6],
            ].map(([name, tone, title, replies, votes], i) => (
              <Card key={i} className="flex items-center gap-3 px-3 py-2.5">
                <span className={`flex flex-col items-center text-[10px] font-semibold tabular-nums ${i === 0 ? a.icon : 'text-neutral-400'}`}>
                  <ArrowFatUp size={12} weight={i === 0 ? 'fill' : 'regular'} />
                  {votes as number}
                </span>
                <Initial name={name as string} tone={tone as string} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-semibold text-neutral-800">{title as string}</p>
                  <p className="text-[10px] text-neutral-400">{name as string}</p>
                </div>
                <span className="flex items-center gap-1 text-[11px] text-neutral-400 tabular-nums">
                  <ChatCircle size={12} /> {replies as number}
                </span>
              </Card>
            ))}
          </div>
        )
      case 'chart':
        return (
          <Card className="p-3.5">
            <div className="mb-3 flex items-end justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-neutral-400">{t(`${P}.completion`)}</p>
                <p className="text-xl font-bold text-neutral-900 tabular-nums">68%</p>
              </div>
              <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">+12%</span>
            </div>
            <div className="flex h-20 items-end gap-1.5">
              {[30, 45, 38, 60, 52, 70, 64, 82, 76, 90].map((h, i) => (
                <span key={i} className={`flex-1 rounded-t ${i === 9 ? a.solid : 'bg-sky-200'}`} style={{ height: `${h}%` }} />
              ))}
            </div>
            <div className="mt-3 flex items-center gap-3 border-t border-neutral-100 pt-2.5 text-[10px] text-neutral-500">
              <span className="flex items-center gap-1"><UsersThree size={12} /> 342</span>
              <span className="flex items-center gap-1"><CheckCircle size={12} /> 233</span>
            </div>
          </Card>
        )
      case 'certificate':
        return (
          <Card className="relative overflow-hidden px-5 py-5 text-center">
            <div className="pointer-events-none absolute inset-2 rounded-lg border border-dashed border-amber-200" />
            <SealCheck size={30} weight="duotone" className="mx-auto text-amber-500" />
            <p className="mt-2 text-[10px] uppercase tracking-[0.2em] text-neutral-400">{t(`${P}.certificate`)}</p>
            <p className="mt-1 font-serif text-lg font-semibold text-neutral-800">Alex Morgan</p>
            <p className="mt-1 text-[11px] text-neutral-500">{s('course_name')}</p>
          </Card>
        )
      case 'path':
        return (
          <Card className="px-4 py-3.5">
            {[s('path_1'), s('path_2'), s('path_3')].map((name, i) => (
              <div key={name} className="flex items-stretch gap-3">
                <div className="flex flex-col items-center">
                  <span className={`flex size-6 items-center justify-center rounded-full text-[11px] font-bold ${i === 0 ? 'bg-emerald-500 text-white' : i === 1 ? `${a.solid} text-white` : 'bg-neutral-100 text-neutral-400'}`}>
                    {i === 0 ? <CheckCircle size={14} weight="bold" /> : i === 2 ? <LockSimple size={11} weight="bold" /> : i + 1}
                  </span>
                  {i < 2 && <span className="w-px flex-1 bg-neutral-200" />}
                </div>
                <div className={`min-w-0 flex-1 ${i < 2 ? 'pb-3' : ''}`}>
                  <p className={`text-[12px] font-semibold ${i === 2 ? 'text-neutral-400' : 'text-neutral-800'}`}>{name}</p>
                  {i === 1 && (
                    <span className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                      <span className={`block h-full w-[45%] rounded-full ${a.solid}`} />
                    </span>
                  )}
                </div>
              </div>
            ))}
          </Card>
        )
      case 'calendar':
        return (
          <div className="flex flex-col gap-2">
            <Card className="flex items-center gap-3 px-3 py-3">
              <span className={`flex size-10 shrink-0 flex-col items-center justify-center rounded-lg ${a.soft} ${a.icon}`}>
                <VideoCamera size={18} weight="duotone" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-semibold text-neutral-800">{s('session_1')}</p>
                <p className="text-[10px] text-neutral-500 tabular-nums">{s('today')} · 14:00</p>
              </div>
              <span className="flex items-center gap-1 rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-semibold text-white">
                <span className="size-1.5 animate-pulse rounded-full bg-white" /> {t(`${P}.live`)}
              </span>
            </Card>
            <Card className="flex items-center gap-3 px-3 py-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-neutral-50 text-neutral-400">
                <CalendarDots size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-semibold text-neutral-800">{s('session_2')}</p>
                <p className="text-[10px] text-neutral-500 tabular-nums">{s('thursday')} · 10:30</p>
              </div>
              <span className="flex -space-x-1.5">
                {['bg-sky-200', 'bg-amber-200', 'bg-emerald-200'].map((c) => <span key={c} className={`size-5 rounded-full ring-2 ring-white ${c}`} />)}
              </span>
            </Card>
          </div>
        )
      case 'audio':
        return (
          <Card className="flex items-center gap-3 p-3">
            <span className={`flex size-14 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-400 to-fuchsia-400 text-white`}>
              <Microphone size={24} weight="duotone" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-semibold text-neutral-800">{s('episode')}</p>
              <div className="mt-2 flex h-5 items-end gap-0.5">
                {[40, 70, 50, 90, 60, 80, 45, 65, 30, 75, 55, 85, 40, 60].map((h, i) => (
                  <span key={i} className={`w-1 rounded-full ${i < 6 ? a.solid : 'bg-neutral-200'}`} style={{ height: `${h}%` }} />
                ))}
              </div>
            </div>
            <span className="flex size-9 items-center justify-center rounded-full bg-neutral-900 text-white">
              <Play size={13} weight="fill" />
            </span>
          </Card>
        )
      case 'groups':
      case 'companies':
        return (
          <div className="grid grid-cols-2 gap-2">
            {(kind === 'companies' ? ['Acme', 'Globex', 'Initech', 'Umbrella'] : ['Sales', 'Support', 'Cohort A', 'Cohort B']).map((name, i) => (
              <Card key={name} className="p-2.5">
                <div className="flex items-center gap-1.5">
                  <span className={`flex size-6 items-center justify-center rounded-md text-[10px] font-bold ${['bg-cyan-100 text-cyan-700', 'bg-amber-100 text-amber-700', 'bg-emerald-100 text-emerald-700', 'bg-rose-100 text-rose-700'][i]}`}>{name.charAt(0)}</span>
                  <span className="truncate text-[11px] font-semibold text-neutral-700">{name}</span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="flex -space-x-1.5">
                    {[0, 1, 2].map((j) => <span key={j} className="size-4 rounded-full bg-neutral-200 ring-2 ring-white" />)}
                  </span>
                  <span className="text-[10px] text-neutral-400 tabular-nums">{[24, 12, 31, 8][i]}</span>
                </div>
              </Card>
            ))}
          </div>
        )
      case 'domain':
        return (
          <Card className="overflow-hidden">
            <div className="flex items-center gap-2 border-b border-neutral-100 px-3 py-2">
              <span className="flex gap-1">
                <span className="size-2 rounded-full bg-rose-300" />
                <span className="size-2 rounded-full bg-amber-300" />
                <span className="size-2 rounded-full bg-emerald-300" />
              </span>
              <span className="flex flex-1 items-center gap-1.5 rounded-md bg-neutral-100 px-2 py-1 text-[11px] text-neutral-700" dir="ltr">
                <LockKey size={10} className="text-emerald-600" /> learn.yourschool.com
              </span>
            </div>
            <div className="p-3">
              <p className="text-[13px] font-bold text-neutral-900">Your School</p>
              <p className="mt-0.5 text-[11px] text-neutral-500">{s('course_name')}</p>
              <span className={`mt-2.5 inline-flex rounded-md px-2 py-1 text-[10px] font-semibold text-white ${a.solid}`}>{t(`${P}.enroll`)}</span>
            </div>
          </Card>
        )
      case 'code':
        return (
          <div className="rounded-xl p-3.5 font-mono text-[11px] leading-relaxed" style={{ background: '#18181b', color: '#d4d4d8' }} dir="ltr">
            <p><span style={{ color: '#7dd3fc' }}>POST</span> /api/v1/courses</p>
            <p style={{ color: '#71717a' }}>{'{'}</p>
            <p className="ps-3"><span style={{ color: '#fcd34d' }}>&quot;name&quot;</span>: <span style={{ color: '#6ee7b7' }}>&quot;Onboarding&quot;</span>,</p>
            <p className="ps-3"><span style={{ color: '#fcd34d' }}>&quot;public&quot;</span>: <span style={{ color: '#c4b5fd' }}>true</span></p>
            <p style={{ color: '#71717a' }}>{'}'}</p>
            <p className="mt-1 flex items-center gap-1" style={{ color: '#34d399' }}><Code size={11} /> 201 Created</p>
          </div>
        )
      case 'roles':
        return (
          <Card className="divide-y divide-neutral-100">
            {[t(`${P}.role_editor`), t(`${P}.role_reviewer`), t(`${P}.role_viewer`)].map((role, i) => (
              <div key={role} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <span className="flex items-center gap-2 text-[12px] font-medium text-neutral-700">
                  <ShieldCheck size={14} className={a.icon} /> {role}
                </span>
                <span className="flex gap-1">
                  {[0, 1, 2].map((j) => <span key={j} className={`size-3 rounded ${j <= 2 - i ? 'bg-emerald-400' : 'bg-neutral-200'}`} />)}
                </span>
              </div>
            ))}
          </Card>
        )
      case 'seo':
        return (
          <Card className="p-3.5" >
            <div dir="ltr">
              <p className="flex items-center gap-1.5 text-[11px] text-neutral-500"><Globe size={11} /> yourschool.com › courses</p>
              <p className="mt-1 text-[13px] font-medium text-sky-700">{s('course_name')} | Your School</p>
            </div>
            <p className="mt-1 text-[11px] leading-snug text-neutral-500">{s('seo_snippet')}</p>
          </Card>
        )
      case 'drip':
        return (
          <div className="flex flex-col gap-1.5">
            {[0, 1, 2, 3].map((i) => (
              <Card key={i} className="flex items-center gap-3 px-3 py-2">
                <span className={`w-14 text-[10px] font-semibold tabular-nums ${i < 2 ? a.icon : 'text-neutral-400'}`}>{t(`${P}.week`, { count: i + 1 })}</span>
                <span className={`flex-1 truncate text-[12px] ${i < 2 ? 'font-medium text-neutral-800' : 'text-neutral-400'}`}>{s(`drip_${i + 1}`)}</span>
                {i >= 2 ? <LockSimple size={12} className="text-neutral-300" /> : <CheckCircle size={13} weight="fill" className="text-emerald-500" />}
              </Card>
            ))}
          </div>
        )
      case 'price':
        return (
          <Card className="p-4">
            <p className="text-[12px] font-semibold text-neutral-800">{s('course_name')}</p>
            <p className="mt-0.5 text-[10px] text-neutral-500">{s('one_time')}</p>
            <p className="mt-2.5 text-2xl font-bold text-neutral-900 tabular-nums">$49</p>
            <span className={`mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-[12px] font-semibold text-white ${a.solid}`}>
              {t(`${P}.enroll`)} <ArrowRight size={12} weight="bold" className="rtl:rotate-180" />
            </span>
          </Card>
        )
      case 'sso':
        return (
          <Card className="flex flex-col gap-2.5 p-4">
            <span className="flex items-center justify-center gap-2 rounded-lg bg-neutral-900 py-2 text-[12px] font-semibold text-white">
              <ShieldCheck size={13} /> {t(`${P}.sso`)}
            </span>
            <p className="text-center text-[10px] text-neutral-400" dir="ltr">you@yourcompany.com</p>
          </Card>
        )
      case 'log':
        return (
          <Card className="divide-y divide-neutral-100 font-mono text-[10px]">
            {['course.published', 'member.role_changed', 'settings.updated'].map((x, i) => (
              <div key={x} className="flex items-center justify-between gap-2 px-3 py-2" dir="ltr">
                <span className="text-neutral-700">{x}</span>
                <span className="text-neutral-400 tabular-nums">{`09:${12 + i * 7}`}</span>
              </div>
            ))}
          </Card>
        )
      case 'newsletter':
        return (
          <Card className="p-3.5">
            <p className="truncate text-[12px] font-semibold text-neutral-800">{s('newsletter_subject')}</p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              {[['1,240', 'sent'], ['58%', 'opened'], ['21%', 'clicked']].map(([v, k]) => (
                <div key={k} className={`rounded-lg py-2 ${k === 'opened' ? a.soft : 'bg-neutral-50'}`}>
                  <p className="text-sm font-bold text-neutral-900 tabular-nums">{v}</p>
                  <p className="text-[10px] text-neutral-500">{t(`${P}.${k}`)}</p>
                </div>
              ))}
            </div>
          </Card>
        )
      case 'board':
        return (
          <Card className="relative h-40 overflow-hidden">
            <span className="absolute start-4 top-4 w-28 -rotate-2 rounded-md bg-amber-100 p-2 text-[11px] font-medium text-amber-900 shadow-sm">{s('note_1')}</span>
            <span className="absolute end-5 top-7 w-28 rotate-2 rounded-md bg-sky-100 p-2 text-[11px] font-medium text-sky-900 shadow-sm">{s('note_2')}</span>
            <span className="absolute bottom-4 start-12 w-32 rounded-md bg-emerald-100 p-2 text-[11px] font-medium text-emerald-900 shadow-sm">{s('note_3')}</span>
            <span className="absolute bottom-8 end-10 flex items-center gap-1 rounded-full bg-rose-500 px-1.5 py-0.5 text-[9px] font-semibold text-white">Maya</span>
          </Card>
        )
      case 'play':
        return (
          <Card className="p-3.5">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-neutral-500"><Sparkle size={12} weight="fill" className={a.icon} /> {s('play_title')}</p>
            <p className="mt-2 text-[12px] font-medium text-neutral-800">{s('play_question')}</p>
            <div className="mt-2.5 grid grid-cols-2 gap-1.5">
              {['3', '5', '7', '9'].map((x, i) => (
                <span key={x} className={`rounded-lg py-1.5 text-center text-[12px] font-semibold ${i === 1 ? `${a.solid} text-white` : 'bg-neutral-50 text-neutral-600'}`}>{x}</span>
              ))}
            </div>
          </Card>
        )
    }
  })()

  return (
    <div aria-hidden="true" className="pointer-events-none select-none" data-feature-preview={kind}>
      {body}
    </div>
  )
}
