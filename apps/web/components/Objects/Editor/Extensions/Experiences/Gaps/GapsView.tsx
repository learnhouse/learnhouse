'use client'
/*
 Fill the gaps: a passage with `[[answer|alt]]` gaps. Learners type the
 answers inline or place chips from a shuffled word bank (tap a chip, then a
 gap; drag and drop works too). Check marks each gap, shows the right answer
 for the wrong ones, and Try again keeps what was right.
*/
import React from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { BracketsSquare, Check, Keyboard, Rows, TextT, WarningCircle, X } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { buttonClass } from '@components/Dashboard/Shared/DashKit/buttons'
import { cn } from '@/lib/utils'
import { Segmented, TEXTAREA_CLASS } from '../../../Blocks/ui/BlockChrome'
import {
  ExperienceFooter,
  ExperienceFrame,
  buzz,
  useEnsureBlockId,
  useExperienceEditable,
  useExperienceMemory,
  useLiveAttrs,
  type CommitPatch,
} from '../shared'
import {
  buildBank,
  gradeGaps,
  isCorrect,
  keepCorrect,
  makeGap,
  normalizeGapsMode,
  parseGaps,
  starsForScore,
  type BankChip,
  type GapToken,
  type GapsMode,
  type GapsToken,
} from './gapsModel'

type Stars = 0 | 1 | 2 | 3

interface StoredAttrs {
  blockId: string
  title: string
  text: string
  mode: unknown
  caseSensitive: unknown
}

/** Start a fresh round when `key` changes (state adjusted during render, no effect). */
function useResetOn(key: string, reset: () => void) {
  const [seen, setSeen] = React.useState(key)
  if (seen !== key) {
    setSeen(key)
    reset()
  }
}

/* ───────────────────────────── Editor ───────────────────────────── */

function GapsEditor({
  text,
  mode,
  caseSensitive,
  commit,
}: {
  text: string
  mode: GapsMode
  caseSensitive: boolean
  commit: (_patch: CommitPatch<StoredAttrs>) => void
}) {
  const { t } = useTranslation()
  const k = 'editor.experiences.gaps.'
  const [draft, setDraft] = React.useState(text)
  const editing = React.useRef(false)
  const pause = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const areaRef = React.useRef<HTMLTextAreaElement>(null)
  const [refused, setRefused] = React.useState(false)
  const helpId = React.useId()

  React.useEffect(() => {
    if (!editing.current) setDraft(text)
  }, [text])
  React.useEffect(() => () => {
    if (pause.current) clearTimeout(pause.current)
  }, [])

  const save = (value: string) => {
    if (pause.current) clearTimeout(pause.current)
    pause.current = null
    commit({ text: value })
  }
  const onChange = (value: string) => {
    setDraft(value)
    setRefused(false)
    if (pause.current) clearTimeout(pause.current)
    pause.current = setTimeout(() => save(value), 500)
  }

  const onMakeGap = () => {
    const el = areaRef.current
    if (!el) return
    const result = makeGap(draft, el.selectionStart, el.selectionEnd, t(`${k}gap_placeholder`))
    if (!result) {
      setRefused(true)
      return
    }
    setDraft(result.text)
    save(result.text)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(result.selStart, result.selEnd)
    })
  }

  const parsed = React.useMemo(() => parseGaps(draft), [draft])
  const hints = parsed.issues.map((issue) =>
    issue.kind === 'noGaps' ? t(`${k}hint_no_gaps`) : issue.kind === 'empty' ? t(`${k}hint_empty_gap`) : t(`${k}hint_unclosed`),
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-64">
          <Segmented<GapsMode>
            value={mode}
            ariaLabel={t(`${k}mode_label`)}
            onChange={(v) => commit({ mode: v })}
            options={[
              { value: 'type', label: <><Keyboard size={13} aria-hidden />{t(`${k}mode_type`)}</> },
              { value: 'bank', label: <><Rows size={13} aria-hidden />{t(`${k}mode_bank`)}</> },
            ]}
          />
        </div>
        <label className="inline-flex items-center gap-2 text-xs text-neutral-600 sm:ms-auto">
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(e) => commit({ caseSensitive: e.target.checked })}
            className="h-3.5 w-3.5 accent-neutral-900"
          />
          {t(`${k}case_sensitive`)}
        </label>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-neutral-600">{t(`${k}text_label`)}</span>
          <button
            type="button"
            className={buttonClass('secondary', 'sm')}
            // Keep the textarea selection: don't take focus on mousedown.
            onMouseDown={(e) => e.preventDefault()}
            onClick={onMakeGap}
          >
            <BracketsSquare size={13} aria-hidden />
            {t(`${k}make_gap`)}
          </button>
        </div>
        <textarea
          ref={areaRef}
          value={draft}
          rows={5}
          dir="auto"
          aria-label={t(`${k}text_label`)}
          aria-describedby={helpId}
          className={cn(TEXTAREA_CLASS, 'font-[inherit]')}
          onFocus={() => (editing.current = true)}
          onBlur={() => {
            editing.current = false
            if (draft !== text) save(draft)
          }}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'g') {
              e.preventDefault()
              onMakeGap()
            }
          }}
        />
        <p id={helpId} className="m-0 text-[11px] leading-snug text-neutral-400">
          {t(`${k}syntax_help`)}
        </p>
        {refused && (
          <p className="m-0 flex items-center gap-1.5 text-xs text-amber-700" role="status">
            <WarningCircle size={14} weight="fill" aria-hidden />
            {t(`${k}hint_inside_gap`)}
          </p>
        )}
        {hints.length > 0 && (
          <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-live="polite">
            {hints.map((h, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-amber-700">
                <WarningCircle size={14} weight="fill" className="mt-px shrink-0" aria-hidden />
                {h}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-xl bg-neutral-50 px-3 py-3">
        <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-neutral-500">
          <TextT size={12} aria-hidden />
          {t(`${k}preview_label`)}
          <span className="ms-auto font-normal text-neutral-400">{t(`${k}gap_count`, { n: parsed.gaps.length })}</span>
        </div>
        <p className="m-0 text-sm leading-7 whitespace-pre-wrap text-neutral-800 [overflow-wrap:anywhere]" dir="auto">
          {parsed.tokens.map((tok, i) =>
            tok.type === 'text' ? (
              <React.Fragment key={i}>{tok.value}</React.Fragment>
            ) : (
              <span key={i} className="mx-0.5 inline-flex items-center gap-1 rounded-md bg-sky-50 px-1.5 py-0.5 align-baseline text-[13px] font-medium text-sky-700">
                {tok.answers[0]}
                {tok.answers.length > 1 && <span className="text-[11px] font-normal text-sky-500">+{tok.answers.length - 1}</span>}
              </span>
            ),
          )}
        </p>
      </div>
    </div>
  )
}

/* ───────────────────────────── Learner ───────────────────────────── */

function inputWidth(gap: GapToken): string {
  const longest = Math.max(...gap.answers.map((a) => a.length), 3)
  return `${Math.min(Math.max(longest + 2, 5), 22)}ch`
}

function ResultIcon({ ok }: { ok: boolean }) {
  const { t } = useTranslation()
  return ok ? (
    <Check size={13} weight="bold" className="shrink-0 text-emerald-600" role="img" aria-label={t('activities.experiences.gaps.correct')} />
  ) : (
    <X size={13} weight="bold" className="shrink-0 text-rose-600" role="img" aria-label={t('activities.experiences.gaps.wrong')} />
  )
}

function TypeGap({
  gap,
  value,
  result,
  onChange,
  onEnter,
  inputRef,
}: {
  gap: GapToken
  value: string
  result: boolean | undefined
  onChange: (_v: string) => void
  onEnter: () => void
  inputRef: (_el: HTMLInputElement | null) => void
}) {
  const { t } = useTranslation()
  const checked = result !== undefined
  return (
    <span className="mx-0.5 inline-flex flex-wrap items-center gap-1 align-baseline">
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-lg px-1 transition-colors focus-within:shadow-[inset_0_1px_2px_rgba(15,23,42,0.08),inset_0_0_0_2px_rgba(14,165,233,0.55)]',
          !checked && 'lh-exp-well',
          checked && result && 'bg-emerald-50 shadow-[inset_0_0_0_1.5px_rgba(5,150,105,0.55)]',
          checked && !result && 'lh-exp-shake bg-rose-50 shadow-[inset_0_0_0_1.5px_rgba(225,29,72,0.55)]',
        )}
      >
        <input
          ref={inputRef}
          type="text"
          value={value}
          readOnly={checked}
          dir="auto"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-label={t('activities.experiences.gaps.gap_aria', { n: gap.index + 1 })}
          aria-invalid={checked && !result ? true : undefined}
          style={{ width: inputWidth(gap) }}
          className="h-8 min-w-0 bg-transparent px-1 text-center text-[15px] text-neutral-900 outline-none placeholder:text-neutral-400"
          placeholder="…"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') {
              e.preventDefault()
              onEnter()
            }
          }}
        />
        {checked && <ResultIcon ok={!!result} />}
      </span>
      {checked && !result && (
        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[13px] font-medium text-emerald-800">
          <span className="sr-only">{t('activities.experiences.gaps.answer_is')}</span>
          <Check size={11} weight="bold" aria-hidden />
          {gap.answers[0]}
        </span>
      )}
    </span>
  )
}

function BankGap({
  gap,
  chip,
  result,
  armed,
  onActivate,
  onDropChip,
}: {
  gap: GapToken
  chip: BankChip | undefined
  result: boolean | undefined
  armed: boolean
  onActivate: () => void
  onDropChip: (_chipId: string) => void
}) {
  const { t } = useTranslation()
  const checked = result !== undefined
  const [over, setOver] = React.useState(false)
  return (
    <span className="mx-0.5 inline-flex flex-wrap items-center gap-1 align-baseline">
      <button
        type="button"
        disabled={checked && !!result}
        onClick={onActivate}
        onDragOver={(e) => {
          if (checked) return
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          const id = e.dataTransfer.getData('text/x-lh-chip')
          if (id) onDropChip(id)
        }}
        aria-label={
          chip
            ? t('activities.experiences.gaps.slot_filled_aria', { n: gap.index + 1, word: chip.text })
            : t('activities.experiences.gaps.slot_empty_aria', { n: gap.index + 1 })
        }
        style={{ minWidth: inputWidth(gap) }}
        data-over={(armed || over) && !chip ? 'true' : undefined}
        className={cn(
          'lh-exp-well inline-flex min-h-9 items-center justify-center rounded-lg p-0.5 align-middle text-[15px] text-sky-500 outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50 disabled:opacity-100',
          !chip && 'px-2',
          !checked && 'cursor-pointer',
        )}
      >
        {chip ? (
          <span
            key={chip.id}
            data-result={checked ? (result ? 'correct' : 'wrong') : undefined}
            className={cn(
              'lh-exp-raised inline-flex h-8 w-full items-center justify-center gap-1 rounded-md px-2 font-medium',
              !checked && 'lh-exp-snap text-neutral-900',
              checked && !result && 'lh-exp-wrong-shake',
            )}
          >
            {chip.text}
            {checked && <ResultIcon ok={!!result} />}
          </span>
        ) : (
          <span className="text-neutral-400">…</span>
        )}
      </button>
      {checked && !result && (
        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[13px] font-medium text-emerald-800">
          <span className="sr-only">{t('activities.experiences.gaps.answer_is')}</span>
          <Check size={11} weight="bold" aria-hidden />
          {gap.answers[0]}
        </span>
      )}
    </span>
  )
}

function useGapsGame(gaps: GapToken[], caseSensitive: boolean) {
  const [values, setValues] = React.useState<string[]>(() => gaps.map(() => ''))
  // Bank mode: gap index -> chip id.
  const [placed, setPlaced] = React.useState<(string | null)[]>(() => gaps.map(() => null))
  const [results, setResults] = React.useState<boolean[] | null>(null)
  const [bank, setBank] = React.useState<BankChip[]>(() => buildBank(gaps))
  const [armedChip, setArmedChip] = React.useState<string | null>(null)
  const [attempts, setAttempts] = React.useState(0)

  const reset = React.useCallback(() => {
    setValues(gaps.map(() => ''))
    setPlaced(gaps.map(() => null))
    setResults(null)
    setBank(buildBank(gaps))
    setArmedChip(null)
    setAttempts(0)
  }, [gaps])

  const chipText = (id: string | null) => (id ? bank.find((c) => c.id === id)?.text ?? '' : '')
  const answers = (mode: GapsMode) => (mode === 'bank' ? placed.map(chipText) : values)

  const check = (mode: GapsMode) => {
    const grade = gradeGaps(gaps, answers(mode), caseSensitive)
    setResults(grade.results)
    setArmedChip(null)
    setAttempts((a) => a + 1)
    return grade
  }

  const retry = () => {
    if (!results) return
    setValues((v) => keepCorrect(v, results))
    setPlaced((p) => p.map((id, i) => (results[i] ? id : null)))
    setResults(null)
  }

  return { values, setValues, placed, setPlaced, results, bank, armedChip, setArmedChip, attempts, reset, check, retry, answers }
}

type Game = ReturnType<typeof useGapsGame>

function Passage({ tokens, renderGap }: { tokens: GapsToken[]; renderGap: (_gap: GapToken) => React.ReactNode }) {
  return (
    <p className="m-0 text-[15px] leading-9 whitespace-pre-wrap text-neutral-800 [overflow-wrap:anywhere]" dir="auto">
      {tokens.map((tok, i) => (tok.type === 'text' ? <React.Fragment key={i}>{tok.value}</React.Fragment> : <React.Fragment key={i}>{renderGap(tok)}</React.Fragment>))}
    </p>
  )
}

function GapsPlayer({ tokens, gaps, mode, caseSensitive, game, onChecked }: {
  tokens: GapsToken[]
  gaps: GapToken[]
  mode: GapsMode
  caseSensitive: boolean
  game: Game
  onChecked: (_correct: number, _total: number) => void
}) {
  const { t } = useTranslation()
  const k = 'activities.experiences.gaps.'
  const inputs = React.useRef<(HTMLInputElement | null)[]>([])
  const bankLabelId = React.useId()
  const checked = game.results !== null

  const doCheck = () => {
    const grade = game.check(mode)
    buzz(grade.correct === grade.total ? 'correct' : 'wrong')
    onChecked(grade.correct, grade.total)
  }

  const focusNext = (index: number) => {
    for (let i = index + 1; i < gaps.length; i++) {
      const el = inputs.current[i]
      if (el && !el.readOnly) {
        el.focus()
        return
      }
    }
    if (!checked) doCheck()
  }

  // After "Try again", put the cursor in the first gap still to fix.
  React.useEffect(() => {
    if (mode !== 'type' || checked || game.attempts === 0) return
    const first = gaps.findIndex((g, i) => !isCorrect(g, game.values[i] ?? '', caseSensitive))
    inputs.current[first]?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checked])

  const usedChips = new Set(game.placed.filter(Boolean) as string[])
  const placeChip = (gapIndex: number, chipId: string) => {
    game.setPlaced((prev) => {
      const next = prev.map((id) => (id === chipId ? null : id))
      next[gapIndex] = chipId
      return next
    })
    game.setArmedChip(null)
  }
  const activateSlot = (gapIndex: number) => {
    if (checked) {
      if (game.results?.[gapIndex]) return
      game.retry()
    }
    if (game.armedChip) {
      placeChip(gapIndex, game.armedChip)
      return
    }
    // Tapping a filled slot sends its chip back to the bank.
    if (game.placed[gapIndex]) game.setPlaced((prev) => prev.map((id, i) => (i === gapIndex ? null : id)))
  }

  const filled = mode === 'bank' ? game.placed.filter(Boolean).length : game.values.filter((v) => v.trim()).length

  return (
    <div className="flex flex-col gap-4">
      <Passage
        tokens={tokens}
        renderGap={(gap) =>
          mode === 'bank' ? (
            <BankGap
              gap={gap}
              chip={game.bank.find((c) => c.id === game.placed[gap.index])}
              result={game.results?.[gap.index]}
              armed={!!game.armedChip}
              onActivate={() => activateSlot(gap.index)}
              onDropChip={(id) => {
                if (checked) game.retry()
                placeChip(gap.index, id)
              }}
            />
          ) : (
            <TypeGap
              gap={gap}
              value={game.values[gap.index] ?? ''}
              result={game.results?.[gap.index]}
              inputRef={(el) => {
                inputs.current[gap.index] = el
              }}
              onChange={(v) => game.setValues((prev) => prev.map((x, i) => (i === gap.index ? v : x)))}
              onEnter={() => focusNext(gap.index)}
            />
          )
        }
      />

      {mode === 'bank' && !checked && (
        <div className="lh-exp-well rounded-2xl p-3">
          <div className="mb-2 text-[12px] text-neutral-500" id={bankLabelId}>
            {game.armedChip ? t(`${k}bank_armed`) : t(`${k}bank_help`)}
          </div>
          <ul className="m-0 flex min-h-9 list-none flex-wrap gap-2 p-0" aria-labelledby={bankLabelId}>
            {game.bank.map((chip) =>
              usedChips.has(chip.id) ? null : (
                <li key={chip.id}>
                  <button
                    type="button"
                    draggable
                    aria-pressed={game.armedChip === chip.id}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/x-lh-chip', chip.id)
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                    onClick={() => game.setArmedChip(game.armedChip === chip.id ? null : chip.id)}
                    className={cn(
                      'lh-exp-raised lh-exp-press inline-flex min-h-10 cursor-grab items-center rounded-lg px-3 text-[14px] font-medium outline-none active:cursor-grabbing',
                      game.armedChip === chip.id ? 'text-sky-700' : 'text-neutral-800',
                    )}
                  >
                    {chip.text}
                  </button>
                </li>
              ),
            )}
            {usedChips.size === game.bank.length && <li className="self-center text-[13px] text-neutral-500">{t(`${k}bank_empty`)}</li>}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {!checked ? (
          <button type="button" className="lh-exp-key" onClick={doCheck} disabled={filled === 0}>
            <Check size={13} weight="bold" aria-hidden />
            {t(`${k}check`)}
          </button>
        ) : (
          game.results?.some((r) => !r) && (
            <button type="button" className="lh-exp-key" onClick={game.retry}>
              {t(`${k}fix_wrong`)}
            </button>
          )
        )}
        {!checked && filled < gaps.length && (
          <span className="text-[13px] text-neutral-500">{t(`${k}filled`, { done: filled, total: gaps.length })}</span>
        )}
      </div>
    </div>
  )
}

/* ───────────────────────────── View ───────────────────────────── */

export default function GapsView(props: NodeViewProps) {
  const { t } = useTranslation()
  const editable = useExperienceEditable(props)
  useEnsureBlockId(props, editable)
  const [attrs, commit] = useLiveAttrs<StoredAttrs>(props)
  const [preview, setPreview] = React.useState(false)
  const text = typeof attrs.text === 'string' ? attrs.text : ''
  const mode = normalizeGapsMode(attrs.mode)
  const caseSensitive = attrs.caseSensitive === true
  const title = typeof attrs.title === 'string' ? attrs.title : ''
  const parsed = React.useMemo(() => parseGaps(text), [text])
  const learner = !editable || preview
  const memory = useExperienceMemory(attrs.blockId, props)
  const game = useGapsGame(parsed.gaps, caseSensitive)
  const k = 'activities.experiences.gaps.'

  const [best, setBest] = React.useState<Stars | null>(() => memory.read<Stars | null>('best', null))
  useResetOn(`${preview}|${mode}|${text}`, game.reset)

  const [live, setLive] = React.useState('')
  const grade = game.results ? { correct: game.results.filter(Boolean).length, total: game.results.length } : null
  const stars: Stars = grade ? starsForScore(grade.correct, grade.total) : 0
  const perfect = !!grade && grade.total > 0 && grade.correct === grade.total

  const onChecked = (correct: number, total: number) => {
    setLive(t(`${k}result_live`, { correct, total }))
    const s = starsForScore(correct, total)
    if (best === null || s > best) {
      memory.write('best', s)
      setBest(s)
    }
  }

  const footer = learner && parsed.gaps.length > 0 ? (
    <ExperienceFooter
      stars={grade ? stars : undefined}
      score={grade ? t(`${k}score`, { correct: grade.correct, total: grade.total }) : undefined}
      onRetry={game.attempts > 0 ? game.reset : undefined}
      retryLabel={t(`${k}start_over`)}
    >
      {best !== null && <span className="text-xs text-neutral-400">{t(`${k}best`, { stars: best })}</span>}
    </ExperienceFooter>
  ) : undefined

  return (
    <NodeViewWrapper className="block-exp-gaps">
      <ExperienceFrame
        tone="link"
        icon={<BracketsSquare weight="duotone" />}
        title={title}
        onTitleChange={(v) => commit({ title: v })}
        titlePlaceholder={t('editor.experiences.gaps.title_placeholder')}
        instructions={learner ? (mode === 'bank' ? t(`${k}instructions_bank`) : t(`${k}instructions_type`)) : undefined}
        editable={editable}
        preview={preview}
        onPreviewChange={setPreview}
        nodeView={props}
        label={t('editor.experiences.gaps.title')}
        footer={footer}
        celebrate={learner && perfect}
        live={learner ? live : ''}
      >
        {!learner ? (
          <GapsEditor text={text} mode={mode} caseSensitive={caseSensitive} commit={commit} />
        ) : parsed.gaps.length === 0 ? (
          <p className="m-0 text-sm text-neutral-500">{t(`${k}empty`)}</p>
        ) : (
          <GapsPlayer tokens={parsed.tokens} gaps={parsed.gaps} mode={mode} caseSensitive={caseSensitive} game={game} onChecked={onChecked} />
        )}
      </ExperienceFrame>
    </NodeViewWrapper>
  )
}
