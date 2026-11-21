'use client'
/*
 Study mode for a flashcard deck (flipcardGrid, mode 'study' or the learner
 toggle): one large card at a time. Tap / Space / Enter flips it; then
 Again / Hard / Got it (keys 1 / 2 / 3). Again comes back soon, Hard later
 (flashcardStudyModel.ts). A progress bar counts known cards; the finish
 screen offers "Study missed cards". Known cards are remembered in
 localStorage (useExperienceMemory), keyed by card content.

 The card reuses the grid's flip classes (.flipcard-inner / -front / -back
 in globals.css): a 3D turn, or a cross-fade under prefers-reduced-motion.
*/
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowClockwise, ArrowCounterClockwise, CheckCircle, Confetti } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { Celebrate, buzz, useExperienceMemory } from '../Experiences/shared'
import { flipcardFaces } from './flipcardStyles'
import {
  type Rating,
  type StudyCard,
  type StudySession,
  createSession,
  currentCard,
  isFinished,
  mergeKnown,
  rateCard,
  ratingFromKey,
  sessionProgress,
} from './flashcardStudyModel'

export interface StudyDeckCard extends StudyCard {
  color?: string
  style?: string
}

/** One memory for every deck of an activity: a card known in one deck is known everywhere. */
const MEMORY_ID = 'flashcards'

export function FlashcardStudy({ cards, shuffle, memorySource }: { cards: StudyDeckCard[]; shuffle: boolean; memorySource?: unknown }) {
  const { t } = useTranslation()
  const memory = useExperienceMemory(MEMORY_ID, memorySource)
  const byKey = React.useMemo(() => new Map(cards.map((c) => [c.key, c])), [cards])
  const deckSig = cards.map((c) => c.key).join('|')

  const begin = React.useCallback(
    (opts: { only?: string[]; forget?: boolean } = {}) => {
      const remembered = opts.forget ? [] : memory.read<string[]>('known', [])
      return createSession(cards, { known: Array.isArray(remembered) ? remembered : [], only: opts.only, shuffle })
    },
    // Deck content, not the array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deckSig, shuffle, memory],
  )

  const [session, setSession] = React.useState<StudySession>(() => begin())
  const [flipped, setFlipped] = React.useState(false)
  const [lastSig, setLastSig] = React.useState(deckSig)
  if (lastSig !== deckSig) {
    // The author edited the deck (or a collaborator did): start over.
    setLastSig(deckSig)
    setSession(begin())
    setFlipped(false)
  }

  const persist = (s: StudySession) => {
    const remembered = memory.read<string[]>('known', [])
    memory.write('known', mergeKnown(Array.isArray(remembered) ? remembered : [], s))
  }

  const rate = (r: Rating) => {
    if (!flipped) return
    const next = rateCard(session, r)
    buzz(r === 'again' ? 'wrong' : 'correct')
    setSession(next)
    setFlipped(false)
    persist(next)
  }

  const restart = (opts: { only?: string[]; forget?: boolean }) => {
    // Forget this deck's cards only; other decks of the activity keep theirs.
    if (opts.forget) {
      const remembered = memory.read<string[]>('known', [])
      memory.write('known', (Array.isArray(remembered) ? remembered : []).filter((k) => !byKey.has(k)))
    }
    setSession(begin(opts))
    setFlipped(false)
  }

  const progress = sessionProgress(session)
  const key = currentCard(session)
  const card = key ? byKey.get(key) : undefined
  const done = isFinished(session)
  const rootRef = React.useRef<HTMLDivElement>(null)

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || done) return
    const tag = (e.target as HTMLElement).tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
    if (!flipped && (e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault()
      setFlipped(true)
      return
    }
    if (flipped && tag !== 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault()
      setFlipped(false)
      return
    }
    const r = flipped ? ratingFromKey(e.key) : null
    if (r) {
      e.preventDefault()
      rate(r)
    }
  }

  if (cards.length === 0) {
    return <p className="py-6 text-center text-[14px] text-neutral-500">{t('activities.experiences.flashcards.empty', 'No cards yet.')}</p>
  }

  const progressBar = (
    <div className="flex items-center gap-3">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.known}
        aria-label={t('activities.experiences.flashcards.known_progress', { known: progress.known, total: progress.total, defaultValue: '{{known}} of {{total}} known' })}
        className="lh-exp-well h-2 flex-1 overflow-hidden rounded-full"
      >
        <div
          className="h-full rounded-full bg-gradient-to-b from-emerald-400 to-emerald-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.3)] transition-[width] duration-500 ease-out motion-reduce:transition-none"
          style={{ width: `${progress.pct}%` }}
        />
      </div>
      <span className="flex-none text-[12px] font-medium tabular-nums text-neutral-500">
        {t('activities.experiences.flashcards.known_progress', { known: progress.known, total: progress.total, defaultValue: '{{known}} of {{total}} known' })}
      </span>
    </div>
  )

  if (done) {
    const allKnownBefore = session.reviews === 0
    const missed = session.missed.filter((k) => byKey.has(k))
    return (
      <div className="lh-exp-table relative flex flex-col gap-4 px-3 py-4 sm:px-5 sm:py-5" data-testid="flashcards-finish">
        {progressBar}
        <div className="lh-exp-slide-in px-2 py-5 text-center">
          <div className="lh-exp-snap mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full border border-emerald-200 border-b-emerald-300 bg-gradient-to-b from-emerald-50 to-emerald-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_2px_0_rgba(15,23,42,0.06),0_8px_16px_-8px_rgba(15,23,42,0.3)]">
            {allKnownBefore ? <CheckCircle size={28} weight="duotone" className="text-emerald-600" /> : <Confetti size={28} weight="duotone" className="text-emerald-600" />}
          </div>
          <h4 className="m-0 text-center text-lg font-bold text-neutral-900">
            {allKnownBefore ? t('activities.experiences.flashcards.all_known_title', 'You know every card') : t('activities.experiences.flashcards.finish_title', 'Deck done!')}
          </h4>
          <p className="mx-auto mt-1.5 text-center mb-0 max-w-sm text-[14px] text-neutral-600">
            {allKnownBefore
              ? t('activities.experiences.flashcards.all_known_body', 'Study them again whenever you like.')
              : t('activities.experiences.flashcards.finish_body', { known: progress.known, total: progress.total, defaultValue: 'You know {{known}} of {{total}} cards.' })}
          </p>
          {!allKnownBefore && (
            <dl className="mx-auto mt-4 grid max-w-xs grid-cols-2 gap-2 text-start">
              <Stat label={t('activities.experiences.flashcards.stat_reviews', 'Reviews')} value={session.reviews} />
              <Stat label={t('activities.experiences.flashcards.stat_missed', 'To review')} value={missed.length} />
            </dl>
          )}
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {missed.length > 0 && (
              <button type="button" onClick={() => restart({ only: missed })} className="lh-exp-key">
                <ArrowClockwise size={14} weight="bold" />
                {t('activities.experiences.flashcards.study_missed', 'Study missed cards')}
              </button>
            )}
            <button
              type="button"
              onClick={() => restart({ forget: true })}
              className={missed.length ? 'lh-exp-raised lh-exp-press inline-flex min-h-9 items-center gap-1.5 rounded-xl px-3.5 text-[14px] font-semibold text-neutral-800' : 'lh-exp-key'}
            >
              <ArrowCounterClockwise size={14} weight="bold" />
              {t('activities.experiences.flashcards.study_again', 'Study all again')}
            </button>
          </div>
        </div>
        <Celebrate show={!allKnownBefore && missed.length === 0} />
      </div>
    )
  }

  const faces = flipcardFaces(card?.color, card?.style)
  const hint = flipped
    ? t('activities.experiences.flashcards.rate_hint', 'How well did you know it?')
    : t('activities.experiences.flashcards.tap_to_flip', 'Tap the card or press Space to flip')

  return (
    <div ref={rootRef} className="lh-exp-table flex flex-col gap-4 px-3 py-4 sm:px-5 sm:py-5" onKeyDown={onKeyDown} data-testid="flashcards-study">
      {progressBar}
      {/* An index card on top of the rest of the deck (its edges peek out below). */}
      <div
        className="lh-exp-stack flipcard-container mx-auto mb-3 h-60 w-full max-w-xl rounded-2xl max-sm:h-52"
        data-depth={Math.min(2, Math.max(0, progress.total - progress.known - 1))}
        data-lhb-keep=""
      >
        <div
          role="button"
          tabIndex={0}
          aria-pressed={flipped}
          aria-label={`${flipped ? card?.answer : card?.question} — ${hint}`}
          onClick={() => setFlipped((f) => !f)}
          className={cn(
            'flipcard-inner cursor-pointer rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2',
            flipped && 'flipped',
          )}
        >
          {(['front', 'back'] as const).map((side) => {
            const back = side === 'back'
            const hidden = back !== flipped
            const text = (back ? card?.answer : card?.question) || '…'
            return (
              <div
                key={side}
                aria-hidden={hidden || undefined}
                className={cn(
                  back ? 'flipcard-back' : 'flipcard-front',
                  'flex flex-col rounded-2xl border-2 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_2px_0_rgba(15,23,42,0.08),0_14px_28px_-14px_rgba(15,23,42,0.35)] max-sm:p-4',
                  // Faint ruled lines on the question side only, like an index card.
                  !back && 'lh-exp-ruled',
                  back ? faces.back : faces.front,
                )}
              >
                <span className="text-[12px] font-medium opacity-75">
                  {back ? t('activities.experiences.flashcards.answer_side', 'Answer') : t('activities.experiences.flashcards.question_side', 'Question')}
                </span>
                <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto">
                  <p
                    dir="auto"
                    className={cn(
                      'm-0 whitespace-pre-line break-words text-center font-semibold tracking-[-0.01em]',
                      text.length > 160 ? 'text-base leading-snug' : text.length > 70 ? 'text-xl leading-snug' : 'text-2xl leading-tight max-sm:text-xl',
                    )}
                  >
                    {text}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <p className="m-0 text-center text-[13px] text-neutral-500" aria-live="polite">
        {hint}
      </p>
      <div className={cn('grid grid-cols-3 gap-2 transition-opacity', flipped ? 'opacity-100' : 'pointer-events-none opacity-40')} aria-hidden={!flipped || undefined}>
        <RateButton k="1" tone="rose" disabled={!flipped} onClick={() => rate('again')} label={t('activities.experiences.flashcards.again', 'Again')} />
        <RateButton k="2" tone="amber" disabled={!flipped} onClick={() => rate('hard')} label={t('activities.experiences.flashcards.hard', 'Hard')} />
        <RateButton k="3" tone="emerald" disabled={!flipped} onClick={() => rate('good')} label={t('activities.experiences.flashcards.got_it', 'Got it')} />
      </div>
    </div>
  )
}

function RateButton({ k, tone, label, onClick, disabled }: { k: string; tone: 'rose' | 'amber' | 'emerald'; label: string; onClick: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-keyshortcuts={k}
      className={cn(
        'lh-exp-raised lh-exp-press lh-exp-tint inline-flex h-12 items-center justify-center gap-2 rounded-xl text-[14px] font-semibold focus-visible:outline-none',
        tone === 'rose' && 'text-rose-700',
        tone === 'amber' && 'text-amber-700',
        tone === 'emerald' && 'text-emerald-700',
      )}
    >
      {label}
      <kbd className="lh-exp-well hidden h-5 min-w-5 items-center justify-center rounded-md px-1 font-sans text-[11px] font-semibold opacity-80 sm:inline-flex">{k}</kbd>
    </button>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-white px-3 py-2 shadow-[0_0_0_1px_var(--exp-edge,rgba(0,0,0,0.08))]">
      <dt className="text-[12px] font-medium text-neutral-500">{label}</dt>
      <dd className="m-0 text-lg font-semibold tabular-nums text-neutral-900">{value}</dd>
    </div>
  )
}

export default FlashcardStudy
