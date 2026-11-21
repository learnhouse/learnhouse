'use client'
/*
 "Property grid" (node expMatrix): learners tick which properties (columns)
 apply to each row. In single mode every row takes exactly one pick.

 Author: rows and columns lists, the answer grid itself (checkboxes, or
 radios in single mode), the answer type, inline hints, and "Preview as
 learner" in the frame header.

 Learner: a table of raised toggle cells that press in when ticked. Arrow
 keys move between cells (one tab stop for the whole grid, RTL aware), Space
 or Enter toggles. On a phone the table becomes one card per row. "Check"
 marks every cell: a right tick keeps its mark in green, a wrong tick turns
 red with a cross, a missed one shows a dashed outline with a faint check.
 "Retry wrong ones" keeps the right ticks.
*/
import React from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { ArrowCounterClockwise, Check, Table, Trash, X } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { CommitInput, FIELD_CLASS, Segmented } from '../../../Blocks/ui/BlockChrome'
import {
  ExperienceFooter,
  ExperienceFrame,
  Stars,
  buzz,
  newId,
  useEnsureBlockId,
  useExperienceEditable,
  useExperienceMemory,
  useLiveAttrs,
  type CommitPatch,
} from '../shared'
import {
  MATRIX_LIMITS,
  addColumn,
  addRow,
  canCheck,
  cellKey,
  checkMatrix,
  isPlayable,
  moveFocus,
  normalizeMatrix,
  playableMatrix,
  removeColumn,
  removeRow,
  retryWrong,
  toggleAnswer,
  toggleAnswerCell,
  updateColumn,
  updateRow,
  validateMatrix,
  type CellResult,
  type MatrixAnswers,
  type MatrixCheck,
  type MatrixData,
  type MatrixMode,
} from './matrixModel'
import { AddRowButton, BlockHints, FormSection, ICON_BTN, NotReady, ResultIcon, RowHints, contentKey } from '../Sort/kit'

const TONE = 'math' as const

type Frame = {
  tone: typeof TONE
  icon: React.ReactNode
  editable: boolean
  preview: boolean
  onPreviewChange: (_v: boolean) => void
  nodeView: NodeViewProps
  label: string
}

export default function MatrixView(props: NodeViewProps) {
  const { t } = useTranslation()
  const editable = useExperienceEditable(props)
  useEnsureBlockId(props, editable)
  const [attrs, commit] = useLiveAttrs(props)
  const data = React.useMemo(() => normalizeMatrix(attrs), [attrs])
  const [preview, setPreview] = React.useState(false)
  const frame: Frame = {
    tone: TONE,
    icon: <Table weight="duotone" />,
    editable,
    preview,
    onPreviewChange: setPreview,
    nodeView: props,
    label: t('editor.experiences.matrix.title', 'Property grid'),
  }
  const playable = React.useMemo(() => playableMatrix(data), [data])
  return (
    <NodeViewWrapper className="block-exp-matrix">
      {editable && !preview ? (
        <MatrixEditor data={data} commit={commit} frame={frame} />
      ) : (
        <MatrixPlayer key={contentKey(playable)} data={playable} frame={frame} source={props} />
      )}
    </NodeViewWrapper>
  )
}

// ─── Author form ────────────────────────────────────────────────────────────

const ISSUE_FALLBACK: Record<string, string> = {
  too_few_rows: 'Add at least 2 rows.',
  too_many_rows: 'Use at most 8 rows; learners only see the first 8.',
  too_few_columns: 'Add at least 2 columns.',
  too_many_columns: 'Use at most 6 columns; learners only see the first 6.',
  empty_row: 'Name this row, or remove it.',
  empty_column: 'Name this column, or remove it.',
  row_no_tick: 'Nothing is ticked in this row. Fine if none apply.',
  row_not_one: 'Pick exactly one answer for this row.',
  unused_column: 'No row has this property yet.',
  duplicate_row: 'Another row has the same name.',
  duplicate_column: 'Another column has the same name.',
}

function MatrixEditor({ data, commit, frame }: { data: MatrixData; commit: (_p: CommitPatch<Record<string, any>>) => void; frame: Frame }) {
  const { t } = useTranslation()
  const k = 'editor.experiences.matrix.'
  const issues = React.useMemo(() => validateMatrix(data), [data])
  const edit = (fn: (_d: MatrixData) => MatrixData) =>
    commit((live) => {
      const next = fn(normalizeMatrix(live))
      return { rows: next.rows, columns: next.columns, cells: next.cells }
    })
  const issueText = (code: string) => t(`${k}issues.${code}`, ISSUE_FALLBACK[code] ?? code)
  const rowName = (label: string, i: number) => label.trim() || t(`${k}row_placeholder`, { n: i + 1, defaultValue: 'Row {{n}}' })
  const colName = (label: string, i: number) => label.trim() || t(`${k}column_placeholder`, { n: i + 1, defaultValue: 'Column {{n}}' })
  const single = data.mode === 'single'

  const list = (kind: 'row' | 'column') => {
    const items = kind === 'row' ? data.rows : data.columns
    const min = kind === 'row' ? MATRIX_LIMITS.minRows : MATRIX_LIMITS.minColumns
    const max = kind === 'row' ? MATRIX_LIMITS.maxRows : MATRIX_LIMITS.maxColumns
    return (
      <FormSection title={kind === 'row' ? t(`${k}rows_heading`, 'Rows') : t(`${k}columns_heading`, 'Columns')}>
        {items.map((it, i) => (
          <div key={it.id} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <CommitInput
                value={it.label}
                onCommit={(label) => edit((d) => (kind === 'row' ? updateRow(d, it.id, label) : updateColumn(d, it.id, label)))}
                placeholder={kind === 'row' ? rowName('', i) : colName('', i)}
                aria-label={kind === 'row' ? rowName('', i) : colName('', i)}
                className={cn(FIELD_CLASS, 'h-9 min-w-0 flex-1')}
              />
              <button
                type="button"
                className={ICON_BTN}
                disabled={items.length <= min}
                onClick={() => edit((d) => (kind === 'row' ? removeRow(d, it.id) : removeColumn(d, it.id)))}
                aria-label={kind === 'row' ? t(`${k}remove_row`, 'Remove row') : t(`${k}remove_column`, 'Remove column')}
                title={kind === 'row' ? t(`${k}remove_row`, 'Remove row') : t(`${k}remove_column`, 'Remove column')}
              >
                <Trash size={15} aria-hidden />
              </button>
            </div>
            <RowHints issues={issues.filter((x) => x.code !== 'row_no_tick' && x.code !== 'row_not_one' && x.code !== 'unused_column')} id={it.id} text={issueText} />
          </div>
        ))}
        <AddRowButton disabled={items.length >= max} onClick={() => edit((d) => (kind === 'row' ? addRow(d, newId()) : addColumn(d, newId())))}>
          {kind === 'row' ? t(`${k}add_row`, 'Add row') : t(`${k}add_column`, 'Add column')}
        </AddRowButton>
      </FormSection>
    )
  }

  const answerIssues = issues.filter((x) => x.code === 'row_no_tick' || x.code === 'row_not_one' || x.code === 'unused_column')

  return (
    <ExperienceFrame
      {...frame}
      title={data.title}
      onTitleChange={(title) => commit({ title })}
      instructions={data.instructions}
      onInstructionsChange={(instructions) => commit({ instructions })}
    >
      <div className="flex flex-col gap-5">
        <BlockHints issues={issues} text={issueText} />

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-neutral-700">{t(`${k}mode_label`, 'Answer type')}</span>
          <div className="w-full sm:w-72">
            <Segmented<MatrixMode>
              value={data.mode}
              ariaLabel={t(`${k}mode_label`, 'Answer type')}
              onChange={(mode) => commit({ mode })}
              options={[
                { value: 'multi', label: t(`${k}mode_multi`, 'Several per row') },
                { value: 'single', label: t(`${k}mode_single`, 'One per row') },
              ]}
            />
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          {list('row')}
          {list('column')}
        </div>

        <FormSection
          title={t(`${k}answers_heading`, 'Correct answers')}
          hint={single ? t(`${k}answers_hint_single`, 'Pick the one right column for each row.') : t(`${k}answers_hint_multi`, 'Tick every cell that is true.')}
        >
          <div className="overflow-x-auto rounded-xl ring-1 ring-neutral-100">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className="p-2" />
                  {data.columns.map((c, ci) => (
                    <th key={c.id} scope="col" className="p-2 text-center align-bottom font-medium text-neutral-600 [overflow-wrap:anywhere]">
                      {colName(c.label, ci)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, ri) => (
                  <tr key={r.id} className="border-t border-neutral-100">
                    <th scope="row" className="p-2 text-start font-medium text-neutral-800 [overflow-wrap:anywhere]">
                      {rowName(r.label, ri)}
                    </th>
                    {data.columns.map((c, ci) => (
                      <td key={c.id} className="p-1 text-center">
                        <input
                          type={single ? 'radio' : 'checkbox'}
                          name={single ? `mx-${data.blockId || 'b'}-${r.id}` : undefined}
                          checked={!!data.cells[cellKey(r.id, c.id)]}
                          onChange={() => edit((d) => toggleAnswerCell(d, r.id, c.id))}
                          onKeyDown={(e) => e.stopPropagation()}
                          aria-label={t(`${k}cell_label`, { row: rowName(r.label, ri), column: colName(c.label, ci), defaultValue: '{{row}}: {{column}}' })}
                          className="h-4 w-4 cursor-pointer accent-orange-600"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {answerIssues.length > 0 && (
            <div className="flex flex-col gap-0.5">
              {answerIssues.map((x) => {
                const name = x.code === 'unused_column' ? colName(data.columns.find((c) => c.id === x.id)?.label ?? '', data.columns.findIndex((c) => c.id === x.id)) : rowName(data.rows.find((r) => r.id === x.id)?.label ?? '', data.rows.findIndex((r) => r.id === x.id))
                return (
                  <RowHints key={`${x.code}-${x.id}`} issues={[{ ...x, id: 'x' }]} id="x" text={(code) => `${name}: ${issueText(code)}`} />
                )
              })}
            </div>
          )}
        </FormSection>
      </div>
    </ExperienceFrame>
  )
}

// ─── Learner ────────────────────────────────────────────────────────────────

/** One toggle cell (table cell or a labelled pill in the phone layout). */
function Toggle({
  on,
  single,
  result,
  label,
  showLabel,
  tabbable,
  locked,
  r,
  c,
  onToggle,
  onKeyDown,
}: {
  on: boolean
  single: boolean
  result?: CellResult
  label: string
  showLabel?: string
  tabbable: boolean
  locked: boolean
  r: number
  c: number
  onToggle: () => void
  onKeyDown: (_e: React.KeyboardEvent<HTMLButtonElement>) => void
}) {
  const { t } = useTranslation()
  const k = 'activities.experiences.matrix.'
  const shown = result === 'tick' || result === 'wrong'
  const resultWord =
    result === 'tick' ? t(`${k}correct`, 'Correct') : result === 'wrong' ? t(`${k}wrong`, 'Wrong') : result === 'missed' ? t(`${k}missed`, 'Missed') : ''
  return (
    <button
      type="button"
      role={single ? 'radio' : 'checkbox'}
      aria-checked={on}
      aria-label={resultWord ? `${label}, ${resultWord}` : label}
      aria-disabled={locked || undefined}
      tabIndex={tabbable ? 0 : -1}
      data-mx-cell=""
      data-r={r}
      data-c={c}
      data-on={on ? 'true' : undefined}
      data-result={shown ? (result === 'tick' ? 'correct' : 'wrong') : undefined}
      data-missed={result === 'missed' ? 'true' : undefined}
      onClick={onToggle}
      onKeyDown={onKeyDown}
      className={cn(
        'lh-exp-raised lh-exp-toggle relative inline-flex items-center justify-center gap-2 text-orange-600 outline-none select-none',
        !locked && 'lh-exp-press',
        showLabel ? 'min-h-11 w-full justify-start rounded-xl px-3 py-2 text-start' : 'h-11 w-11 rounded-xl',
        locked && 'cursor-default',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'lh-exp-toggle-mark inline-flex h-5 w-5 shrink-0 items-center justify-center',
          single ? 'rounded-full' : 'rounded-md',
          !on && result !== 'missed' && 'lh-exp-well',
        )}
      >
        {result === 'wrong' ? (
          <X size={12} weight="bold" />
        ) : on || result === 'missed' ? (
          single && result !== 'missed' ? <span className="h-2 w-2 rounded-full bg-current" /> : <Check size={12} weight="bold" />
        ) : null}
      </span>
      {showLabel && <span className="min-w-0 flex-1 text-[14px] font-medium text-neutral-800 [overflow-wrap:anywhere]">{showLabel}</span>}
    </button>
  )
}

function MatrixPlayer({ data, frame, source }: { data: MatrixData; frame: Frame; source: NodeViewProps }) {
  const { t } = useTranslation()
  const k = 'activities.experiences.matrix.'
  const memory = useExperienceMemory(data.blockId, source)
  const [answers, setAnswers] = React.useState<MatrixAnswers>({})
  const [check, setCheck] = React.useState<MatrixCheck | null>(null)
  const [focus, setFocus] = React.useState({ r: 0, c: 0 })
  const [live, setLive] = React.useState('')
  const [best, setBest] = React.useState<number>(() => memory.read<number>('best', 0))
  const rootRef = React.useRef<HTMLDivElement>(null)

  if (!isPlayable(data)) {
    return (
      <ExperienceFrame {...frame} title={data.title} instructions={data.instructions}>
        <NotReady>{t(`${k}not_ready`, 'This activity is not ready yet.')}</NotReady>
      </ExperienceFrame>
    )
  }

  const single = data.mode === 'single'
  const cellLabel = (ri: number, ci: number) => t(`${k}cell_label`, { row: data.rows[ri].label, column: data.columns[ci].label, defaultValue: '{{row}}: {{column}}' })

  const toggle = (ri: number, ci: number) => {
    setFocus({ r: ri, c: ci })
    if (check) return
    const r = data.rows[ri]
    const c = data.columns[ci]
    const was = !!answers[cellKey(r.id, c.id)]
    setAnswers((a) => toggleAnswer(data, a, r.id, c.id))
    setLive(
      was
        ? t(`${k}live_cleared`, { cell: cellLabel(ri, ci), defaultValue: '{{cell}} cleared' })
        : t(`${k}live_ticked`, { cell: cellLabel(ri, ci), defaultValue: '{{cell}} ticked' }),
    )
  }

  const onCellKey = (e: React.KeyboardEvent<HTMLButtonElement>, ri: number, ci: number) => {
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl'
    const next = moveFocus({ r: ri, c: ci }, e.key, data.rows.length, data.columns.length, rtl)
    if (!next) return
    e.preventDefault()
    e.stopPropagation()
    setFocus(next)
    // Only the visible layout (table or phone cards) has rendered boxes.
    const target = Array.from(rootRef.current?.querySelectorAll<HTMLElement>(`[data-mx-cell][data-r="${next.r}"][data-c="${next.c}"]`) ?? []).find((el) => el.offsetParent !== null)
    target?.focus()
  }

  const onCheck = () => {
    const c = checkMatrix(data, answers)
    setCheck(c)
    buzz(c.perfect ? 'correct' : 'wrong')
    setLive(c.perfect ? t(`${k}perfect`, 'Perfect! Every cell is right.') : t(`${k}result`, { correct: c.correct, total: c.total, defaultValue: '{{correct}} of {{total}} correct' }))
    if (c.stars > best) {
      setBest(c.stars)
      memory.write('best', c.stars)
    }
  }

  const onRetryWrong = () => {
    if (!check) return
    setAnswers((a) => retryWrong(data, a, check))
    setCheck(null)
    setLive(t(`${k}live_retry`, 'The wrong answers are cleared. Try those again.'))
  }

  const onReset = () => {
    setAnswers({})
    setCheck(null)
    setLive('')
  }

  const ready = canCheck(data, answers)
  const touched = Object.keys(answers).length > 0
  const wrongRows = check ? data.rows.filter((r) => !check.rowsCorrect[r.id]) : []

  const toggleFor = (ri: number, ci: number, showLabel?: string) => {
    const key = cellKey(data.rows[ri].id, data.columns[ci].id)
    return (
      <Toggle
        on={!!answers[key]}
        single={single}
        result={check?.results[key]}
        label={cellLabel(ri, ci)}
        showLabel={showLabel}
        tabbable={focus.r === ri && focus.c === ci}
        locked={!!check}
        r={ri}
        c={ci}
        onToggle={() => toggle(ri, ci)}
        onKeyDown={(e) => onCellKey(e, ri, ci)}
      />
    )
  }

  const footer = (
    <ExperienceFooter
      stars={check ? check.stars : undefined}
      score={check ? `${check.correct} / ${check.total}` : undefined}
      onRetry={check || touched ? onReset : undefined}
    >
      {!check && best > 0 && (
        <span className="flex items-center gap-1.5 text-xs text-neutral-500">
          {t(`${k}best`, 'Best')}
          <Stars value={best as 0 | 1 | 2 | 3} size={13} />
        </span>
      )}
    </ExperienceFooter>
  )

  return (
    <ExperienceFrame {...frame} title={data.title} instructions={data.instructions} footer={footer} celebrate={!!check?.perfect} live={live}>
      <div ref={rootRef} className="flex flex-col gap-4">
        {!check && (
          <p className="m-0 text-[13px] leading-snug text-neutral-500">
            {single ? t(`${k}hint_single`, 'Pick one answer in each row, then check.') : t(`${k}hint_multi`, 'Tick every property that applies, then check.')}
          </p>
        )}

        {/* Table (sm and up) */}
        <div className="hidden overflow-x-auto sm:block">
          <table aria-label={data.title || t(`${k}grid_label`, 'Answer grid')} className="w-full border-separate border-spacing-x-1 border-spacing-y-1.5">
            <thead>
              <tr>
                <td />
                {data.columns.map((c) => (
                  <th key={c.id} scope="col" className="px-1 pb-1 text-center align-bottom text-[13px] font-semibold leading-tight text-neutral-600 [overflow-wrap:anywhere]">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, ri) => (
                <tr key={r.id}>
                  <th scope="row" className="pe-3 text-start text-[14px] font-medium text-neutral-800 [overflow-wrap:anywhere]">
                    <span className="inline-flex items-center gap-1.5">
                      {check && <ResultIcon ok={!!check.rowsCorrect[r.id]} size={14} />}
                      {r.label}
                    </span>
                  </th>
                  {data.columns.map((c, ci) => (
                    <td key={c.id} className="text-center">
                      {toggleFor(ri, ci)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* One card per row (phones) */}
        <div className="flex flex-col gap-2.5 sm:hidden">
          {data.rows.map((r, ri) => (
            <div key={r.id} className="lh-exp-well flex flex-col gap-2 rounded-2xl p-2.5">
              <div className="flex items-center gap-1.5 px-1 text-[14px] font-semibold text-neutral-800">
                {check && <ResultIcon ok={!!check.rowsCorrect[r.id]} size={14} />}
                <span className="[overflow-wrap:anywhere]">{r.label}</span>
              </div>
              <div role={single ? 'radiogroup' : 'group'} aria-label={r.label} className="grid grid-cols-2 gap-1.5">
                {data.columns.map((c, ci) => (
                  <React.Fragment key={c.id}>{toggleFor(ri, ci, c.label)}</React.Fragment>
                ))}
              </div>
            </div>
          ))}
        </div>

        {!check && <p className="m-0 hidden text-[12px] text-neutral-400 sm:block">{t(`${k}keyboard_help`, 'Arrow keys move between cells; Space ticks.')}</p>}

        {!check ? (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={onCheck} disabled={!ready} className="lh-exp-key">
              {t(`${k}check`, 'Check')}
            </button>
            {!ready && (
              <span className="text-[13px] text-neutral-500">
                {single ? t(`${k}pick_each_row`, 'Pick an answer in every row to check.') : t(`${k}tick_something`, 'Tick at least one cell to check.')}
              </span>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className={cn('m-0 flex items-center gap-2 text-[14px] font-medium', check.perfect ? 'text-emerald-700' : 'text-neutral-700')}>
              <ResultIcon ok={check.perfect} size={16} label="" />
              {check.perfect
                ? t(`${k}perfect`, 'Perfect! Every cell is right.')
                : t(`${k}result`, { correct: check.correct, total: check.total, defaultValue: '{{correct}} of {{total}} correct' })}
            </p>
            {!check.perfect && (
              <ul className="m-0 flex list-none flex-wrap items-center gap-x-4 gap-y-1.5 p-0 text-[12px] text-neutral-500" aria-hidden>
                <li className="flex items-center gap-1.5">
                  <span data-result="correct" className="lh-exp-raised inline-flex h-4 w-4 items-center justify-center rounded"><Check size={9} weight="bold" /></span>
                  {t(`${k}legend_tick`, 'Right')}
                </li>
                <li className="flex items-center gap-1.5">
                  <span data-result="wrong" className="lh-exp-raised inline-flex h-4 w-4 items-center justify-center rounded"><X size={9} weight="bold" /></span>
                  {t(`${k}legend_wrong`, 'Should not be ticked')}
                </li>
                <li className="flex items-center gap-1.5">
                  <span data-missed="true" className="lh-exp-raised lh-exp-toggle inline-flex h-4 w-4 items-center justify-center rounded text-orange-600"><Check size={9} weight="bold" className="opacity-50" /></span>
                  {t(`${k}legend_missed`, 'Should be ticked')}
                </li>
              </ul>
            )}
            {!check.perfect && wrongRows.length > 0 && (
              <div>
                <button type="button" onClick={onRetryWrong} className="lh-exp-key">
                  <ArrowCounterClockwise size={14} weight="bold" aria-hidden />
                  {t(`${k}retry_wrong`, 'Retry wrong ones')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </ExperienceFrame>
  )
}
