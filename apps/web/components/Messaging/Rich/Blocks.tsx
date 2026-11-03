'use client'

import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowCounterClockwise,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Books,
  Cards,
  Check,
  CheckCircle,
  ListChecks,
  Question,
  Shuffle,
  X,
  XCircle,
} from '@phosphor-icons/react'
import { useOrg } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import type { CourseCard } from '@services/messaging/messaging'
import type { CourseBlockData, FlashcardsData, QuizData, RichBlockKind, StepsData } from './parse'

const shell = 'not-prose my-2.5 rounded-xl border border-gray-200 bg-white overflow-hidden text-gray-900'

function BlockHeader({ icon, title, right }: { icon: React.ReactNode; title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3.5 h-10 border-b border-gray-100 bg-gray-50/70">
      <span className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
        {icon}
        {title}
      </span>
      {right}
    </div>
  )
}

/* ------------------------------------------------------------------------ */
/* Quiz                                                                     */
/* ------------------------------------------------------------------------ */

export function QuizBlock({ data }: { data: QuizData }) {
  const [picked, setPicked] = useState<Record<number, number>>({})
  const answered = Object.keys(picked).length
  const score = data.questions.reduce((n, q, i) => n + (picked[i] === q.answer ? 1 : 0), 0)
  const done = answered === data.questions.length

  return (
    <div className={shell}>
      <BlockHeader
        icon={<Question size={14} weight="bold" />}
        title={data.questions.length > 1 ? `Quiz · ${data.questions.length} questions` : 'Quiz'}
        right={
          answered > 0 && (
            <span className="text-xs font-semibold tabular-nums text-gray-600">
              {score}/{data.questions.length}
            </span>
          )
        }
      />
      <div className="divide-y divide-gray-100">
        {data.questions.map((q, qi) => {
          const choice = picked[qi]
          const revealed = choice !== undefined
          return (
            <div key={qi} className="p-3.5 space-y-2.5">
              <p className="text-sm font-semibold leading-snug">
                {data.questions.length > 1 && <span className="text-gray-400 me-1.5">{qi + 1}.</span>}
                {q.question}
              </p>
              <div className="grid gap-1.5">
                {q.options.map((opt, oi) => {
                  const isAnswer = oi === q.answer
                  const isChoice = oi === choice
                  let tone = 'border-gray-200 hover:bg-gray-50'
                  if (revealed && isAnswer) tone = 'border-green-500 bg-green-50 text-green-900'
                  else if (revealed && isChoice) tone = 'border-red-400 bg-red-50 text-red-900'
                  else if (revealed) tone = 'border-gray-200 opacity-60'
                  return (
                    <button
                      key={oi}
                      type="button"
                      disabled={revealed}
                      onClick={() => setPicked((p) => ({ ...p, [qi]: oi }))}
                      className={`flex items-center gap-2.5 w-full text-start rounded-lg border px-3 py-2 text-sm transition-colors ${tone}`}
                    >
                      <span
                        className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold shrink-0 ${
                          revealed && isAnswer
                            ? 'bg-green-500 text-white'
                            : revealed && isChoice
                              ? 'bg-red-500 text-white'
                              : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {revealed && isAnswer ? <Check size={11} weight="bold" /> : revealed && isChoice ? <X size={11} weight="bold" /> : String.fromCharCode(65 + oi)}
                      </span>
                      <span>{opt}</span>
                    </button>
                  )
                })}
              </div>
              {revealed && (
                <div
                  className={`flex gap-2 rounded-lg px-3 py-2 text-xs leading-relaxed ${
                    choice === q.answer ? 'bg-green-50 text-green-900' : 'bg-red-50 text-red-900'
                  }`}
                >
                  {choice === q.answer ? (
                    <CheckCircle size={16} weight="fill" className="shrink-0 mt-0.5 text-green-600" />
                  ) : (
                    <XCircle size={16} weight="fill" className="shrink-0 mt-0.5 text-red-500" />
                  )}
                  <span>
                    <strong>{choice === q.answer ? 'Correct.' : `Answer: ${q.options[q.answer]}.`}</strong>{' '}
                    {q.explanation}
                  </span>
                </div>
              )}
            </div>
          )
        })}
      </div>
      {done && (
        <div className="flex items-center justify-between px-3.5 py-2.5 border-t border-gray-100 bg-gray-50/70">
          <span className="text-sm font-semibold">
            {score === data.questions.length ? 'Perfect score 🎉' : `You got ${score} of ${data.questions.length}`}
          </span>
          <button
            type="button"
            onClick={() => setPicked({})}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 hover:text-gray-900"
          >
            <ArrowCounterClockwise size={13} weight="bold" />
            Retry
          </button>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------------ */
/* Flashcards                                                               */
/* ------------------------------------------------------------------------ */

export function FlashcardsBlock({ data }: { data: FlashcardsData }) {
  const [order, setOrder] = useState(() => data.cards.map((_, i) => i))
  const [pos, setPos] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const card = data.cards[order[pos]] ?? data.cards[0]

  const go = (delta: number) => {
    setFlipped(false)
    setPos((p) => (p + delta + order.length) % order.length)
  }
  const shuffle = () => {
    const next = order.slice()
    for (let i = next.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[next[i], next[j]] = [next[j], next[i]]
    }
    setOrder(next)
    setPos(0)
    setFlipped(false)
  }

  return (
    <div className={shell}>
      <BlockHeader
        icon={<Cards size={14} weight="bold" />}
        title="Flashcards"
        right={
          <button
            type="button"
            onClick={shuffle}
            className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-900"
          >
            <Shuffle size={13} weight="bold" />
            Shuffle
          </button>
        }
      />
      <div className="p-3.5">
        <button
          type="button"
          onClick={() => setFlipped((f) => !f)}
          className="block w-full [perspective:1200px] focus:outline-none"
          aria-label={flipped ? 'Show front' : 'Show back'}
        >
          <div
            className="relative w-full h-40 transition-transform duration-500 [transform-style:preserve-3d]"
            style={{ transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)' }}
          >
            <div className="absolute inset-0 flex flex-col items-center justify-center rounded-lg bg-gray-900 text-white px-5 text-center [backface-visibility:hidden]">
              <span className="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-2">Term</span>
              <span className="text-base font-semibold leading-snug">{card.front}</span>
            </div>
            <div className="absolute inset-0 flex flex-col items-center justify-center rounded-lg bg-gray-50 border border-gray-200 px-5 text-center [backface-visibility:hidden] [transform:rotateY(180deg)]">
              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Definition</span>
              <span className="text-sm leading-relaxed text-gray-800 overflow-y-auto">{card.back}</span>
            </div>
          </div>
        </button>
        <div className="flex items-center justify-between mt-3">
          <button
            type="button"
            onClick={() => go(-1)}
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900"
            aria-label="Previous card"
          >
            <ArrowLeft size={15} weight="bold" />
          </button>
          <div className="flex items-center gap-1">
            {order.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-colors ${i === pos ? 'w-4 bg-gray-900' : 'w-1.5 bg-gray-200'}`}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => go(1)}
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900"
            aria-label="Next card"
          >
            <ArrowRight size={15} weight="bold" />
          </button>
        </div>
        <p className="text-center text-[11px] text-gray-400 mt-1">
          {pos + 1} / {order.length} · tap the card to flip
        </p>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------------ */
/* Steps                                                                    */
/* ------------------------------------------------------------------------ */

export function StepsBlock({ data }: { data: StepsData }) {
  const [done, setDone] = useState<Set<number>>(new Set())
  const toggle = (i: number) =>
    setDone((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  const progress = Math.round((done.size / data.steps.length) * 100)

  return (
    <div className={shell}>
      <BlockHeader
        icon={<ListChecks size={14} weight="bold" />}
        title={data.title || 'Steps'}
        right={<span className="text-xs font-semibold tabular-nums text-gray-500">{progress}%</span>}
      />
      <div className="h-0.5 bg-gray-100">
        <div className="h-full bg-gray-900 transition-all duration-300" style={{ width: `${progress}%` }} />
      </div>
      <ol className="p-3.5 space-y-0">
        {data.steps.map((step, i) => {
          const checked = done.has(i)
          const last = i === data.steps.length - 1
          return (
            <li key={i} className="relative flex gap-3">
              {!last && <span className="absolute start-[11px] top-7 bottom-0 w-px bg-gray-200" />}
              <button
                type="button"
                onClick={() => toggle(i)}
                className={`relative z-[1] mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full border text-[11px] font-bold shrink-0 transition-colors ${
                  checked ? 'bg-gray-900 border-gray-900 text-white' : 'bg-white border-gray-300 text-gray-500 hover:border-gray-900'
                }`}
                aria-label={checked ? 'Mark step not done' : 'Mark step done'}
              >
                {checked ? <Check size={12} weight="bold" /> : i + 1}
              </button>
              <div className={`pb-4 ${last ? 'pb-0' : ''}`}>
                <p className={`text-sm font-semibold leading-snug ${checked ? 'line-through text-gray-400' : ''}`}>
                  {step.title}
                </p>
                {step.detail && <p className="text-xs text-gray-600 leading-relaxed mt-0.5">{step.detail}</p>}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/* ------------------------------------------------------------------------ */
/* Course recommendation                                                    */
/* ------------------------------------------------------------------------ */

export function CourseBlock({
  data,
  courses,
  orgslug,
}: {
  data: CourseBlockData
  courses?: Record<string, CourseCard>
  orgslug: string
}) {
  const org = useOrg() as any
  const course = courses?.[data.course_uuid]
  // Only courses the backend resolved for this reader render; anything else
  // was made up or out of reach.
  if (!course) return null
  const href = getUriWithOrg(orgslug, `/course/${course.course_uuid.replace(/^course_/, '')}`)
  const thumb =
    course.thumbnail_image && org?.org_uuid
      ? getCourseThumbnailMediaDirectory(org.org_uuid, course.course_uuid, course.thumbnail_image)
      : null
  return (
    <Link
      href={href}
      className="not-prose group my-2.5 flex items-stretch gap-0 rounded-xl bg-white nice-shadow overflow-hidden hover:bg-gray-50 transition-colors no-underline"
    >
      <div className="w-28 shrink-0 bg-gray-100 relative">
        {thumb ? (
          <img src={thumb} alt="" className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-gray-300">
            <Books size={28} weight="duotone" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0 p-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Recommended course</p>
        <p className="text-sm font-bold text-gray-900 leading-snug truncate">{course.name}</p>
        {(data.reason || course.description) && (
          <p className="text-xs text-gray-600 leading-relaxed line-clamp-2 mt-0.5">{data.reason || course.description}</p>
        )}
        <span className="inline-flex items-center gap-1 mt-1.5 text-xs font-semibold text-gray-900 group-hover:underline">
          Open course
          <ArrowUpRight size={12} weight="bold" />
        </span>
      </div>
    </Link>
  )
}

/* ------------------------------------------------------------------------ */
/* Streaming placeholder                                                    */
/* ------------------------------------------------------------------------ */

const PENDING_LABEL: Record<RichBlockKind, string> = {
  quiz: 'Writing a quiz',
  flashcards: 'Making flashcards',
  steps: 'Laying out steps',
  course: 'Finding a course',
  chart: 'Drawing a chart',
  mindmap: 'Mapping it out',
  timeline: 'Building a timeline',
  exercise: 'Writing an exercise',
  reminder: 'Setting a reminder',
}

export function PendingBlock({ kind }: { kind: RichBlockKind }) {
  const rows = useMemo(() => (kind === 'course' || kind === 'reminder' ? 1 : 3), [kind])
  return (
    <div className="not-prose my-2.5 rounded-xl border border-gray-200 bg-white p-3.5 space-y-2.5 overflow-hidden">
      <p className="text-xs font-semibold text-gray-500">{PENDING_LABEL[kind]}…</p>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="lh-msg-shimmer h-8 rounded-xl" style={{ width: `${92 - i * 14}%` }} />
      ))}
      <style jsx global>{`
        .lh-msg-shimmer {
          background: linear-gradient(90deg, #f4f4f5 0%, #e9e9ec 40%, #f4f4f5 80%);
          background-size: 200% 100%;
          animation: lh-msg-shimmer 1.3s ease-in-out infinite;
        }
        @keyframes lh-msg-shimmer {
          0% { background-position: 100% 0; }
          100% { background-position: -100% 0; }
        }
      `}</style>
    </div>
  )
}
