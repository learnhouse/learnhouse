'use client'
import React from 'react'
import { CheckCircle, Info, WarningCircle, XCircle } from '@phosphor-icons/react'
import { SectionCard } from '@components/Dashboard/Shared/DashKit/DashKit'
import { scoreGrade, type SeoCheck } from '@/lib/seo/score'
import { useSeoT } from '@/lib/seo/i18n'

const GRADE_COLOR = { good: 'text-emerald-600', ok: 'text-amber-500', poor: 'text-rose-500' } as const

export function ScoreRing({ score, size = 64 }: { score: number; size?: number }) {
  const grade = scoreGrade(score)
  const r = (size - 8) / 2
  const c = 2 * Math.PI * r
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${score}/100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={6} className="stroke-neutral-100" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - score / 100)}
          className={`stroke-current ${GRADE_COLOR[grade]} transition-[stroke-dashoffset] duration-500`}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-base font-bold tabular-nums text-neutral-900">{score}</span>
    </div>
  )
}

const ICONS = {
  pass: <CheckCircle size={16} weight="fill" className="text-emerald-500 shrink-0 mt-px" />,
  warn: <WarningCircle size={16} weight="fill" className="text-amber-500 shrink-0 mt-px" />,
  fail: <XCircle size={16} weight="fill" className="text-rose-500 shrink-0 mt-px" />,
  info: <Info size={16} weight="fill" className="text-sky-500 shrink-0 mt-px" />,
}

const ORDER = { fail: 0, warn: 1, info: 2, pass: 3 }

/** Score ring + actionable checklist, worst items first. */
export function SeoScoreCard({ score, checks }: { score: number; checks: SeoCheck[] }) {
  const st = useSeoT()
  const grade = scoreGrade(score)
  const sorted = [...checks].sort((a, b) => ORDER[a.level] - ORDER[b.level])
  return (
    <SectionCard bodyClassName="p-5">
      <div className="flex items-center gap-4">
        <ScoreRing score={score} />
        <div>
          <div className="text-sm font-semibold text-neutral-900">{st('score.title')}</div>
          <div className={`text-sm font-medium ${GRADE_COLOR[grade]}`}>{st(`score.${grade}`)}</div>
        </div>
      </div>
      <ul className="mt-4 space-y-2.5" aria-label={st('score.checks')}>
        {sorted.map((c) => (
          <li key={c.id} className="flex items-start gap-2 text-[13px] leading-snug text-neutral-700">
            {ICONS[c.level]}
            <span>{st(`checks.${c.id}`, c.params)}</span>
          </li>
        ))}
      </ul>
    </SectionCard>
  )
}
