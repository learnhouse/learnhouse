'use client'
/*
 Fill the gaps: a passage with `[[answer|alt]]` gaps. Learners type the
 answers inline or place chips from a shuffled word bank (tap a chip, then a
 gap; drag and drop works too). Check marks each gap, shows the right answer
 for the wrong ones, and Try again keeps what was right.
*/
import React from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { BracketsSquare, Check, Keyboard, PencilSimple, Rows, Trash, X } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { buttonClass } from '@components/Dashboard/Shared/DashKit/buttons'
import { cn } from '@/lib/utils'
import { BlockPopover, CommitInput, Segmented, SettingsField } from '../../../Blocks/ui/BlockChrome'
import { InlineHint } from '../Sort/kit'
import {
  AnswerKeyHint,
  ExperienceFooter,
  ExperienceFrame,
  SettingsGear,
  SettingsToggle,
  buzz,
  useEnsureBlockId,
  useExperienceEditable,
  useExperienceMemory,
  useLiveAttrs,
  type CommitPatch,
} from '../shared'
import {
  buildBank,
  escapeGapText,
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
// Edit in place: the passage as learners see it, each gap showing its answer
// as a filled slot (the answer key). Select words and press "Make gap"; click
// a gap to edit its accepted answers; click the text (or "Edit text") to edit
// the passage itself, where typing [[ ]] makes a gap too. Mode and case
// sensitivity live behind the header gear.

/** Source offset of a position inside a text run (escapes take two source characters). */
function sourceOffset(source: string, runStart: number, displayOffset: number): number {
  let i = runStart
  let n = 0
  while (n < displayOffset && i < source.length) {
    i += source[i] === '\\' && i + 1 < source.length ? 2 : 1
    n++
  }
  return i
}

/** The text runs between valid gaps, with where each starts in the source. */
function textRuns(source: string, tokens: GapsToken[]): (number | null)[] {
  let pos = 0
  return tokens.map((tok) => {
    if (tok.type === 'gap') {
      pos = tok.end
      return null
    }
    return pos
  })
}

/** Rewrite one gap (by index) in the source: new answers, or plain text when `answers` is empty. */
function rewriteGap(source: string, index: number, answers: string[], plain?: string): string {
  const gap = parseGaps(source).gaps[index]
  if (!gap) return source
  const clean = answers.map((a) => a.replace(/\s+/g, ' ').trim()).filter((a, i, all) => a && all.indexOf(a) === i)
  const replacement = clean.length ? `[[${clean.map(escapeGapText).join('|')}]]` : (plain ?? gap.answers[0] ?? '').replace(/\[\[/g, '[ [')
  return source.slice(0, gap.start) + replacement + source.slice(gap.end)
}

function GapAnswers({ gap, onChange, onRemoveGap }: { gap: GapToken; onChange: (_answers: string[]) => void; onRemoveGap: () => void }) {
  const { t } = useTranslation()
  const k = 'editor.experiences.gaps.'
  return (
    <>
      <p className="m-0 -mt-1 text-[11px] leading-snug text-neutral-400">{t(`${k}answers_hint`, 'Learners can type any of these. The first one goes in the word bank.')}</p>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {gap.answers.map((a, i) => (
          <li key={`${i}:${a}`} className="flex items-center gap-1.5">
            <CommitInput
              value={a}
              onCommit={(v) => onChange(gap.answers.map((x, j) => (j === i ? v : x)))}
              aria-label={t(`${k}answer_label`, { n: i + 1, defaultValue: 'Accepted answer {{n}}' })}
              maxLength={80}
            />
            {gap.answers.length > 1 && (
              <button
                type="button"
                aria-label={t(`${k}remove_answer`, { answer: a, defaultValue: 'Remove “{{answer}}”' })}
                onClick={() => onChange(gap.answers.filter((_, j) => j !== i))}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-400 outline-none hover:bg-rose-50 hover:text-rose-600 focus-visible:ring-2 focus-visible:ring-sky-500/40"
              >
                <X size={12} weight="bold" aria-hidden />
              </button>
            )}
          </li>
        ))}
        <li>
          <CommitInput
            key={gap.answers.join('|')}
            value=""
            placeholder={t(`${k}add_answer`, 'Add another accepted answer')}
            aria-label={t(`${k}add_answer`, 'Add another accepted answer')}
            maxLength={80}
            onCommit={(v) => v.trim() && onChange([...gap.answers, v])}
          />
        </li>
      </ul>
      <button type="button" onClick={onRemoveGap} className={cn(buttonClass('ghost', 'sm'), 'self-start')}>
        <Trash size={13} aria-hidden />
        {t(`${k}remove_gap`, 'Remove gap (keep the word)')}
      </button>
    </>
  )
}

function GapsEditor({ text, mode, commit }: { text: string; mode: GapsMode; commit: (_patch: CommitPatch<StoredAttrs>) => void }) {
  const { t } = useTranslation()
  const k = 'editor.experiences.gaps.'
  const [editing, setEditing] = React.useState<{ caret: number } | null>(null)
  const [refused, setRefused] = React.useState(false)
  const [selection, setSelection] = React.useState<{ start: number; end: number } | null>(null)
  const passageRef = React.useRef<HTMLParagraphElement>(null)
  const parsed = React.useMemo(() => parseGaps(text), [text])
  const runs = React.useMemo(() => textRuns(text, parsed.tokens), [text, parsed.tokens])
  const clickTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(() => () => {
    if (clickTimer.current) clearTimeout(clickTimer.current)
  }, [])

  const edit = (fn: (_text: string) => string) => commit((live) => ({ text: fn(typeof live.text === 'string' ? live.text : '') }))

  /** Source offset of a DOM point inside the passage, or null when it is not in plain text. */
  const pointToSource = (node: Node | null, offset: number): number | null => {
    const el = (node?.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement | null))?.closest<HTMLElement>('[data-run]')
    if (!el || !passageRef.current?.contains(el)) return null
    const start = Number(el.dataset.run)
    return sourceOffset(text, start, node?.nodeType === Node.TEXT_NODE ? offset : offset ? (el.textContent ?? '').length : 0)
  }

  // Track a selection of plain words in the passage for "Make gap".
  React.useEffect(() => {
    if (editing) return
    const onChange = () => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || !sel.rangeCount) return setSelection(null)
      const r = sel.getRangeAt(0)
      if (!passageRef.current?.contains(r.commonAncestorContainer)) return setSelection(null)
      const a = pointToSource(r.startContainer, r.startOffset)
      const b = pointToSource(r.endContainer, r.endOffset)
      setSelection(a !== null && b !== null && b > a ? { start: a, end: b } : null)
      setRefused(a === null || b === null)
    }
    document.addEventListener('selectionchange', onChange)
    return () => document.removeEventListener('selectionchange', onChange)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, text])

  const makeGapFromSelection = () => {
    if (!selection) {
      setRefused(true)
      return
    }
    const result = makeGap(text, selection.start, selection.end, t(`${k}gap_placeholder`))
    if (!result) {
      setRefused(true)
      return
    }
    commit({ text: result.text })
    window.getSelection()?.removeAllRanges()
    setSelection(null)
  }

  // A single click on the words (not a word selection) edits the passage there.
  const onPassageClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    if (e.detail > 1) {
      if (clickTimer.current) clearTimeout(clickTimer.current)
      return
    }
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed) return
    const caret = sel?.rangeCount ? pointToSource(sel.anchorNode, sel.anchorOffset) : null
    if (clickTimer.current) clearTimeout(clickTimer.current)
    clickTimer.current = setTimeout(() => {
      if (window.getSelection()?.isCollapsed !== false) setEditing({ caret: caret ?? text.length })
    }, 260)
  }

  const hints = parsed.issues.map((issue) =>
    issue.kind === 'noGaps' ? t(`${k}hint_no_gaps`) : issue.kind === 'empty' ? t(`${k}hint_empty_gap`) : t(`${k}hint_unclosed`),
  )

  const slot = (gap: GapToken) => (
    <BlockPopover
      key={`g${gap.index}`}
      title={t(`${k}gap_title`, { n: gap.index + 1, defaultValue: 'Gap {{n}}' })}
      width={260}
      align="start"
      trigger={
        <button
          type="button"
          aria-label={t(`${k}gap_aria`, { n: gap.index + 1, answer: gap.answers[0], defaultValue: 'Gap {{n}}: {{answer}}. Edit the accepted answers' })}
          className={cn(
            'lh-exp-well mx-0.5 inline-flex min-h-9 cursor-pointer items-center justify-center gap-1 rounded-lg p-0.5 align-middle text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50 data-[state=open]:ring-2 data-[state=open]:ring-sky-500/40',
            mode === 'type' && 'px-2',
          )}
          style={{ minWidth: inputWidth(gap) }}
        >
          {mode === 'bank' ? (
            <span className="lh-exp-raised inline-flex h-8 w-full items-center justify-center gap-1 rounded-md px-2 font-medium text-neutral-900">{gap.answers[0]}</span>
          ) : (
            <span className="font-medium text-sky-700">{gap.answers[0]}</span>
          )}
          {gap.answers.length > 1 && <span className="px-1 text-[11px] font-semibold text-sky-600">+{gap.answers.length - 1}</span>}
        </button>
      }
    >
      <GapAnswers
        gap={gap}
        onChange={(answers) => edit((src) => rewriteGap(src, gap.index, answers))}
        onRemoveGap={() => edit((src) => rewriteGap(src, gap.index, []))}
      />
    </BlockPopover>
  )

  const bankChips = mode === 'bank' ? parsed.gaps.map((g) => g.answers[0]) : []

  return (
    <div className="flex flex-col gap-4">
      {editing ? (
        <PassageSource
          text={text}
          caret={editing.caret}
          onSave={(v) => commit({ text: v })}
          onDone={() => setEditing(null)}
          refused={refused}
          setRefused={setRefused}
        />
      ) : (
        <p
          ref={passageRef}
          onClick={onPassageClick}
          title={t(`${k}passage_hint`, 'Click to edit the text. Select words, then “Make gap”.')}
          className="m-0 cursor-text text-[15px] leading-9 whitespace-pre-wrap text-neutral-800 [overflow-wrap:anywhere]"
          dir="auto"
        >
          {parsed.tokens.map((tok, i) =>
            tok.type === 'text' ? (
              <span key={i} data-run={runs[i] ?? 0}>
                {tok.value}
              </span>
            ) : (
              slot(tok)
            ),
          )}
          {!text.trim() && <span className="text-neutral-400">{t(`${k}passage_placeholder`, 'Write your text here…')}</span>}
        </p>
      )}

      {!editing && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            // Keep the word selection: don't take focus on mousedown.
            onMouseDown={(e) => e.preventDefault()}
            onClick={makeGapFromSelection}
            disabled={!selection}
            className="lh-exp-raised lh-exp-press inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-neutral-700 outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 disabled:opacity-45"
          >
            <BracketsSquare size={14} aria-hidden />
            {t(`${k}make_gap`)}
          </button>
          <button
            type="button"
            onClick={() => setEditing({ caret: text.length })}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-neutral-500 outline-none hover:bg-neutral-200/60 hover:text-neutral-800 focus-visible:ring-2 focus-visible:ring-sky-500/40"
          >
            <PencilSimple size={14} aria-hidden />
            {t(`${k}edit_text`, 'Edit text')}
          </button>
          <span className="text-[12px] text-neutral-400">
            {selection ? t(`${k}make_gap_ready`, 'Press “Make gap” to turn the selected words into a gap.') : t(`${k}select_hint`, 'Select words to make a gap. Click a gap to edit its answers.')}
          </span>
        </div>
      )}

      {refused && !editing && <InlineHint severity="warning">{t(`${k}hint_inside_gap`)}</InlineHint>}
      {hints.length > 0 && (
        <div className="flex flex-col gap-1" aria-live="polite">
          {hints.map((h, i) => (
            <InlineHint key={i} severity="warning">
              {h}
            </InlineHint>
          ))}
        </div>
      )}

      {/* What learners pick from in word-bank mode (shuffled for them). */}
      {mode === 'bank' && bankChips.length > 0 && (
        <div className="lh-exp-well rounded-2xl p-3" aria-hidden>
          <div className="mb-2 text-[12px] text-neutral-500">{t('activities.experiences.gaps.bank_help')}</div>
          <ul className="m-0 flex min-h-9 list-none flex-wrap gap-2 p-0">
            {bankChips.map((w, i) => (
              <li key={i} className="lh-exp-raised inline-flex min-h-10 items-center rounded-lg px-3 text-[14px] font-medium text-neutral-800">
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/** The passage source, edited in place with the passage's own typography. */
function PassageSource({
  text,
  caret,
  onSave,
  onDone,
  refused,
  setRefused,
}: {
  text: string
  caret: number
  onSave: (_v: string) => void
  onDone: () => void
  refused: boolean
  setRefused: (_v: boolean) => void
}) {
  const { t } = useTranslation()
  const k = 'editor.experiences.gaps.'
  const [draft, setDraft] = React.useState(text)
  const atFocus = React.useRef(text)
  const pause = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const areaRef = React.useRef<HTMLTextAreaElement>(null)
  const helpId = React.useId()

  React.useEffect(() => {
    const el = areaRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(caret, caret)
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  React.useEffect(() => () => {
    if (pause.current) clearTimeout(pause.current)
  }, [])
  React.useLayoutEffect(() => {
    const el = areaRef.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  }, [draft])

  const save = (value: string) => {
    if (pause.current) clearTimeout(pause.current)
    pause.current = null
    if (value !== text) onSave(value)
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

  return (
    <div className="flex flex-col gap-2">
      <span className="lh-exp-edit block">
        <textarea
          ref={areaRef}
          value={draft}
          rows={2}
          dir="auto"
          aria-label={t(`${k}text_label`)}
          aria-describedby={helpId}
          spellCheck
          className="m-0 block w-full resize-none overflow-hidden bg-transparent p-0 font-[inherit] text-[15px] leading-9 text-neutral-800 outline-none"
          onChange={(e) => {
            const v = e.target.value
            setDraft(v)
            setRefused(false)
            if (pause.current) clearTimeout(pause.current)
            pause.current = setTimeout(() => save(v), 500)
          }}
          onBlur={() => {
            save(draft)
            onDone()
          }}
          onKeyDown={(e) => {
            if (!e.metaKey && !e.ctrlKey) e.stopPropagation()
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'g') {
              e.preventDefault()
              e.stopPropagation()
              onMakeGap()
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              if (pause.current) clearTimeout(pause.current)
              setDraft(atFocus.current)
              onSave(atFocus.current)
              onDone()
            }
          }}
        />
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onMakeGap}
          className="lh-exp-raised lh-exp-press inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-neutral-700 outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40"
        >
          <BracketsSquare size={14} aria-hidden />
          {t(`${k}make_gap`)}
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            save(draft)
            onDone()
          }}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-neutral-500 outline-none hover:bg-neutral-200/60 hover:text-neutral-800 focus-visible:ring-2 focus-visible:ring-sky-500/40"
        >
          <Check size={14} aria-hidden />
          {t(`${k}done_editing`, 'Done')}
        </button>
        <span id={helpId} className="text-[12px] text-neutral-400">
          {t(`${k}syntax_help`)}
        </span>
      </div>
      {refused && <InlineHint severity="warning">{t(`${k}hint_inside_gap`)}</InlineHint>}
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

  const instructions = mode === 'bank' ? t(`${k}instructions_bank`) : t(`${k}instructions_type`)
  const frame = {
    tone: 'link' as const,
    icon: <BracketsSquare weight="duotone" />,
    title,
    onTitleChange: (v: string) => commit({ title: v }),
    titlePlaceholder: t('editor.experiences.gaps.title_placeholder'),
    instructions,
    editable,
    preview,
    onPreviewChange: setPreview,
    nodeView: props,
    label: t('editor.experiences.gaps.title'),
  }

  if (!learner) {
    const settings = (
      <SettingsGear>
        <SettingsField label={t('editor.experiences.gaps.mode_label')}>
          <Segmented<GapsMode>
            value={mode}
            ariaLabel={t('editor.experiences.gaps.mode_label')}
            onChange={(v) => commit({ mode: v })}
            options={[
              { value: 'type', label: <><Keyboard size={13} aria-hidden />{t('editor.experiences.gaps.mode_type')}</> },
              { value: 'bank', label: <><Rows size={13} aria-hidden />{t('editor.experiences.gaps.mode_bank')}</> },
            ]}
          />
        </SettingsField>
        <SettingsToggle checked={caseSensitive} onChange={(v) => commit({ caseSensitive: v })} label={t('editor.experiences.gaps.case_sensitive')} />
      </SettingsGear>
    )
    return (
      <NodeViewWrapper className="block-exp-gaps">
        <ExperienceFrame {...frame} wysiwyg headerEnd={settings} footer={<AnswerKeyHint />}>
          <GapsEditor text={text} mode={mode} commit={commit} />
        </ExperienceFrame>
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper className="block-exp-gaps">
      <ExperienceFrame {...frame} footer={footer} celebrate={perfect} live={live}>
        {parsed.gaps.length === 0 ? (
          <p className="m-0 text-sm text-neutral-500">{t(`${k}empty`)}</p>
        ) : (
          <GapsPlayer tokens={parsed.tokens} gaps={parsed.gaps} mode={mode} caseSensitive={caseSensitive} game={game} onChecked={onChecked} />
        )}
      </ExperienceFrame>
    </NodeViewWrapper>
  )
}
