'use client'
/*
 The right-hand panels of the Code playground: Instructions, Tests, Output.
 Author fields commit on blur (CommitInput); learner state stays local.
*/
import React from 'react'
import {
  CaretRight, CheckCircle, Circle, Clock, ClipboardText, Copy, Database, Eye, EyeSlash, FileText, Lightbulb, Lock, Memory, Plus, Terminal, Trash, WarningCircle, XCircle,
} from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { v4 as uuidv4 } from 'uuid'
import { buttonClass } from '@components/Dashboard/Shared/DashKit/buttons'
import { cn } from '@/lib/utils'
import { CommitInput, TEXTAREA_CLASS, FIELD_CLASS } from '../../../Blocks/ui/BlockChrome'
import { LIMITS, STATUS, summarize, visibleResult, type RunError, type RunProblem, type TestCase, type TestResult } from './runner'
import { COMPLEXITY_OPTIONS } from './SettingsPanel'

const MONO = "font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-words"
// Plain <div>s instead of <pre>: the editor's prose styles paint every <pre> black.
const CODE_BOX = cn(MONO, 'rounded-lg bg-neutral-50 px-2.5 py-2 text-neutral-700 shadow-[0_0_0_1px_var(--lhb-border,rgba(0,0,0,0.05))]')

export function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = React.useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text).catch(() => {})
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      aria-label={t('editor.blocks.code_playground.copy_to_clipboard', 'Copy to clipboard')}
      className={cn('inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors', copied ? 'text-emerald-600' : 'text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700')}
    >
      {copied ? <ClipboardText size={12} /> : <Copy size={12} />}
    </button>
  )
}

function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('mb-1.5 text-[12px] font-semibold text-neutral-500', className)}>{children}</div>
}

// ─── Markdown (learner instructions) ─────────────────────────────────────────

const md = {
  h1: ({ children }: any) => <div className="mb-2 mt-3 text-[15px] font-semibold text-neutral-900 first:mt-0">{children}</div>,
  h2: ({ children }: any) => <div className="mb-1.5 mt-3 text-[14px] font-semibold text-neutral-900 first:mt-0">{children}</div>,
  h3: ({ children }: any) => <div className="mb-1 mt-2 text-[13px] font-semibold text-neutral-900 first:mt-0">{children}</div>,
  p: ({ children }: any) => <p className="mb-2 text-[13px] leading-relaxed text-neutral-600 last:mb-0">{children}</p>,
  strong: ({ children }: any) => <strong className="font-semibold text-neutral-800">{children}</strong>,
  ul: ({ children }: any) => <ul className="!my-2 list-disc !ps-5 text-[13px] text-neutral-600">{children}</ul>,
  ol: ({ children }: any) => <ol className="!my-2 list-decimal !ps-5 text-[13px] text-neutral-600">{children}</ol>,
  li: ({ children }: any) => <li className="!my-0.5">{children}</li>,
  code: ({ className, children }: any) =>
    className ? <code className={cn(className, 'block')}>{children}</code> : <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-[12px] text-rose-600">{children}</code>,
  pre: ({ children }: any) => <div className={cn(CODE_BOX, 'my-2 overflow-x-auto')}>{children}</div>,
  a: ({ href, children }: any) => <a href={href} target="_blank" rel="noopener noreferrer" className="!text-sky-700 underline">{children}</a>,
  blockquote: ({ children }: any) => <blockquote className="my-2 border-s-2 border-neutral-200 ps-3 text-neutral-500">{children}</blockquote>,
  table: ({ children }: any) => <div className="my-2 overflow-x-auto"><table className="min-w-full border-collapse text-xs">{children}</table></div>,
  th: ({ children }: any) => <th className="border border-neutral-200 bg-neutral-50 px-2 py-1 text-start font-semibold">{children}</th>,
  td: ({ children }: any) => <td className="border border-neutral-200 px-2 py-1">{children}</td>,
}

// ─── Instructions ────────────────────────────────────────────────────────────

interface InstructionsProps {
  isAuthor: boolean
  attrs: Record<string, any>
  commit: (_patch: Record<string, any>) => void
  hints: string[]
  isSql: boolean
  solution?: React.ReactNode
}

export function InstructionsPanel({ isAuthor, attrs, commit, hints, isSql, solution }: InstructionsProps) {
  const { t } = useTranslation()
  const [openHints, setOpenHints] = React.useState<Set<number>>(new Set())
  const description: string = attrs.description || ''
  const complexity = (v: string) => t(COMPLEXITY_OPTIONS.find((o) => o.value === v)?.labelKey || '', v)

  if (isAuthor) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <div>
          <Label>{t('editor.blocks.code_playground.description_label', 'Task description')}</Label>
          <CommitInput
            multiline
            value={description}
            placeholder={t('editor.blocks.code_playground.description_placeholder', 'Describe the task…')}
            aria-label={t('editor.blocks.code_playground.description_label', 'Task description')}
            className={cn(TEXTAREA_CLASS, 'min-h-[120px] resize-y bg-neutral-50 font-mono')}
            onCommit={(v) => commit({ description: v })}
          />
          <p className="mt-1 text-[11px] text-neutral-400">{t('editor.blocks_v2.code.markdown_hint', 'Markdown works: **bold**, `code`, lists.')}</p>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <Label className="mb-0">{t('editor.blocks.code_playground.hints', 'Hints')}</Label>
            <button type="button" className={buttonClass('ghost', 'sm')} onClick={() => commit({ hints: [...hints, ''] })}>
              <Plus size={12} /> {t('editor.blocks.code_playground.add', 'Add')}
            </button>
          </div>
          {hints.length === 0 && <p className="text-[11px] text-neutral-400">{t('editor.blocks_v2.code.hints_empty', 'Hints open one at a time for learners who get stuck.')}</p>}
          <div className="flex flex-col gap-1.5">
            {hints.map((hint, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <Lightbulb size={14} className="shrink-0 text-amber-500" />
                <CommitInput
                  value={hint}
                  placeholder={t('editor.blocks.code_playground.hint_placeholder', { number: i + 1 })}
                  aria-label={t('editor.blocks.code_playground.hint_number', { number: i + 1 })}
                  onCommit={(v) => commit({ hints: hints.map((h, j) => (j === i ? v : h)) })}
                />
                <button type="button" aria-label={t('common.delete', 'Delete')} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-neutral-400 hover:bg-rose-50 hover:text-rose-600" onClick={() => commit({ hints: hints.filter((_, j) => j !== i) })}>
                  <Trash size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {description ? (
        <div>
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={md}>{description}</ReactMarkdown>
        </div>
      ) : (
        <p className="py-6 text-center text-[13px] text-neutral-400">{t('editor.blocks.code_playground.no_description')}</p>
      )}

      {(attrs.timeComplexity || attrs.spaceComplexity || (isSql && attrs.sqliteDbPath) || (attrs.additionalFiles || []).length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {attrs.timeComplexity && (
            <span className="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-1 text-[11px] text-neutral-600">
              <Clock size={11} /> {t('editor.blocks.code_playground.speed_label', { value: complexity(attrs.timeComplexity) })}
            </span>
          )}
          {attrs.spaceComplexity && (
            <span className="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-1 text-[11px] text-neutral-600">
              <Memory size={11} /> {t('editor.blocks.code_playground.memory_label', { value: complexity(attrs.spaceComplexity) })}
            </span>
          )}
          {isSql && attrs.sqliteDbPath && (
            <span className="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-1 text-[11px] text-neutral-600">
              <Database size={11} /> {t('editor.blocks.code_playground.runs_against', { name: attrs.sqliteDbName || 'database.sqlite' })}
            </span>
          )}
          {(attrs.additionalFiles || []).map((f: any, i: number) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-1 font-mono text-[11px] text-neutral-600">
              <FileText size={11} /> {f?.name}
            </span>
          ))}
        </div>
      )}

      {hints.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-neutral-500">
            <Lightbulb size={12} className="text-amber-500" /> {t('editor.blocks.code_playground.hints', 'Hints')}
          </div>
          {hints.map((hint, i) => {
            const open = openHints.has(i)
            return (
              <div key={i} className="overflow-hidden rounded-lg bg-amber-50/60 ring-1 ring-amber-100">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenHints((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n })}
                  className="flex w-full items-center gap-2 px-3 py-2 text-start text-[12px] font-medium text-amber-800"
                >
                  <CaretRight size={11} className={cn('transition-transform rtl:rotate-180', open && 'rotate-90 rtl:rotate-90')} />
                  {t('editor.blocks.code_playground.hint_number', { number: i + 1 })}
                </button>
                {open && <p className="px-3 pb-2.5 text-[12px] leading-relaxed text-neutral-700">{hint}</p>}
              </div>
            )
          })}
        </div>
      )}

      {solution}
    </div>
  )
}

// ─── Tests ───────────────────────────────────────────────────────────────────

function ResultIcon({ result }: { result?: TestResult }) {
  if (!result) return <Circle size={15} className="shrink-0 text-neutral-300" />
  return result.passed ? <CheckCircle size={15} weight="fill" className="shrink-0 text-emerald-500" /> : <XCircle size={15} weight="fill" className="shrink-0 text-rose-500" />
}

interface TestsProps {
  isAuthor: boolean
  tests: TestCase[]
  results: TestResult[] | null
  commitTests: (_tests: TestCase[]) => void
  studentTests: TestCase[]
  setStudentTests: React.Dispatch<React.SetStateAction<TestCase[]>>
}

export function TestsPanel({ isAuthor, tests, results, commitTests, studentTests, setStudentTests }: TestsProps) {
  const { t } = useTranslation()
  const byId = new Map((results || []).map((r) => [r.id, r]))
  const hiddenCount = tests.filter((tc) => tc.hidden).length
  const room = LIMITS.tests - tests.length - (isAuthor ? 0 : studentTests.length)
  const update = (id: string, patch: Partial<TestCase>) => commitTests(tests.map((tc) => (tc.id === id ? { ...tc, ...patch } : tc)))

  if (isAuthor) {
    return (
      <div className="flex flex-col gap-2.5 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-neutral-500">
            {t('editor.blocks_v2.code.tests_count', { count: tests.length, defaultValue: '{{count}} tests' })}
            {hiddenCount > 0 && <> · {t('editor.blocks_v2.code.hidden_count', { count: hiddenCount, defaultValue: '{{count}} hidden' })}</>}
          </span>
          <button
            type="button"
            className={buttonClass('secondary', 'sm')}
            disabled={room <= 0}
            onClick={() => commitTests([...tests, { id: uuidv4(), label: `Test ${tests.length + 1}`, stdin: '', expectedStdout: '' }])}
          >
            <Plus size={12} /> {t('editor.blocks.code_playground.add_test_case', 'Add test')}
          </button>
        </div>
        {tests.length === 0 && (
          <div className="rounded-xl border border-dashed border-neutral-200 px-4 py-6 text-center text-[12px] text-neutral-400">
            {t('editor.blocks.code_playground.add_tests_hint')}
          </div>
        )}
        {tests.map((tc) => {
          const r = byId.get(tc.id)
          return (
            <div key={tc.id} className={cn('rounded-xl bg-white p-3 shadow-[0_0_0_1px_var(--lhb-border,rgba(0,0,0,0.07))]', r && !r.passed && 'shadow-[0_0_0_1px_rgba(244,63,94,0.35)]')}>
              <div className="mb-2 flex items-center gap-2">
                <ResultIcon result={r} />
                <CommitInput
                  value={tc.label}
                  aria-label={t('editor.blocks.code_playground.test_label_placeholder', 'Test name')}
                  placeholder={t('editor.blocks.code_playground.test_label_placeholder', 'Test name')}
                  className="h-7 min-w-0 flex-1 rounded-md bg-transparent px-1 text-[13px] font-medium text-neutral-800 outline-none hover:bg-neutral-50 focus:bg-neutral-50"
                  onCommit={(v) => update(tc.id, { label: v })}
                />
                <button
                  type="button"
                  aria-pressed={!!tc.hidden}
                  onClick={() => update(tc.id, { hidden: !tc.hidden || undefined })}
                  title={tc.hidden ? t('editor.blocks_v2.code.hidden_on', 'Hidden: learners only see if it passes') : t('editor.blocks_v2.code.hidden_off', 'Visible to learners. Click to hide its input and output.')}
                  className={cn(
                    'inline-flex h-7 shrink-0 items-center gap-1 rounded-lg px-2 text-[11px] font-medium transition-colors',
                    tc.hidden ? 'bg-slate-800 text-white' : 'text-neutral-500 hover:bg-neutral-100',
                  )}
                >
                  {tc.hidden ? <EyeSlash size={12} /> : <Eye size={12} />}
                  {tc.hidden ? t('editor.blocks_v2.code.hidden', 'Hidden') : t('editor.blocks_v2.code.visible', 'Visible')}
                </button>
                <button type="button" aria-label={t('common.delete', 'Delete')} onClick={() => commitTests(tests.filter((x) => x.id !== tc.id))} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-neutral-400 hover:bg-rose-50 hover:text-rose-600">
                  <Trash size={13} />
                </button>
              </div>
              <div className="grid gap-2 @md:grid-cols-2">
                <div>
                  <Label>{t('editor.blocks.code_playground.input', 'Input')}</Label>
                  <CommitInput multiline value={tc.stdin} placeholder={t('editor.blocks.code_playground.stdin_placeholder', 'stdin')} aria-label={t('editor.blocks.code_playground.input', 'Input')} className={cn(TEXTAREA_CLASS, 'font-mono text-[12px]')} onCommit={(v) => update(tc.id, { stdin: v })} />
                </div>
                <div>
                  <Label>{t('editor.blocks.code_playground.expected_output', 'Expected output')}</Label>
                  <CommitInput multiline value={tc.expectedStdout} placeholder={t('editor.blocks.code_playground.expected_stdout_placeholder', 'Expected stdout')} aria-label={t('editor.blocks.code_playground.expected_output', 'Expected output')} className={cn(TEXTAREA_CLASS, 'font-mono text-[12px]')} onCommit={(v) => update(tc.id, { expectedStdout: v })} />
                </div>
              </div>
              {r && !r.passed && (
                <div className="mt-2">
                  <Label className="text-rose-600">{t('editor.blocks.code_playground.your_output', 'Output')}</Label>
                  <div className={cn(CODE_BOX, 'bg-rose-50/60 text-rose-700')}>{r.actual_stdout || r.stderr || r.compile_output || t('editor.blocks.code_playground.no_output')}</div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  // ─── Learner ───
  return (
    <div className="flex flex-col gap-2 p-4">
      {tests.length === 0 && <p className="py-4 text-center text-[13px] text-neutral-400">{t('editor.blocks.code_playground.no_tests')}</p>}
      {tests.map((tc, i) => {
        const r = byId.get(tc.id)
        if (tc.hidden) {
          return (
            <div key={tc.id} className="flex items-center gap-2 rounded-xl bg-neutral-50 px-3 py-2.5 shadow-[0_0_0_1px_var(--lhb-border,rgba(0,0,0,0.05))]">
              <ResultIcon result={r} />
              <span className="flex-1 text-[13px] font-medium text-neutral-700">{t('editor.blocks_v2.code.hidden_test', { number: i + 1, defaultValue: 'Hidden test {{number}}' })}</span>
              <Lock size={12} className="text-neutral-400" />
            </div>
          )
        }
        return (
          <details key={tc.id} className="group rounded-xl bg-white shadow-[0_0_0_1px_var(--lhb-border,rgba(0,0,0,0.07))]" open={!!r && !r.passed}>
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
              <ResultIcon result={r} />
              <span className="flex-1 truncate text-[13px] font-medium text-neutral-800">{tc.label}</span>
              {r?.time && <span className="font-mono text-[10px] text-neutral-400">{r.time}s</span>}
              <CaretRight size={11} className="text-neutral-400 transition-transform group-open:rotate-90 rtl:rotate-180 rtl:group-open:rotate-90" />
            </summary>
            <div className="grid gap-2 px-3 pb-3 @md:grid-cols-2">
              <div>
                <Label>{t('editor.blocks.code_playground.input', 'Input')}</Label>
                <div className={CODE_BOX}>{tc.stdin || <span className="text-neutral-400">{t('editor.blocks.code_playground.empty', '(empty)')}</span>}</div>
              </div>
              <div>
                <Label>{t('editor.blocks.code_playground.expected_output', 'Expected output')}</Label>
                <div className={CODE_BOX}>{tc.expectedStdout || <span className="text-neutral-400">{t('editor.blocks.code_playground.empty', '(empty)')}</span>}</div>
              </div>
              {r && !r.passed && (
                <div className="@md:col-span-2">
                  <Label className="text-rose-600">{t('editor.blocks.code_playground.your_output', 'Your output')}</Label>
                  <div className={cn(CODE_BOX, 'bg-rose-50/60 text-rose-700')}>{r.actual_stdout || r.stderr || t('editor.blocks.code_playground.no_output')}</div>
                </div>
              )}
            </div>
          </details>
        )
      })}

      <div className="mt-2 border-t border-neutral-100 pt-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-medium text-neutral-500">{t('editor.blocks.code_playground.your_test_cases', 'Your test cases')}</span>
          <button
            type="button"
            className={buttonClass('ghost', 'sm')}
            disabled={room <= 0}
            onClick={() => setStudentTests((prev) => [...prev, { id: uuidv4(), label: `My test ${prev.length + 1}`, stdin: '', expectedStdout: '' }])}
          >
            <Plus size={12} /> {t('editor.blocks.code_playground.add', 'Add')}
          </button>
        </div>
        {studentTests.length === 0 && <p className="text-[11px] text-neutral-400">{t('editor.blocks.code_playground.your_tests_hint')}</p>}
        <div className="flex flex-col gap-2">
          {studentTests.map((tc) => {
            const r = byId.get(tc.id)
            const set = (patch: Partial<TestCase>) => setStudentTests((prev) => prev.map((x) => (x.id === tc.id ? { ...x, ...patch } : x)))
            return (
              <div key={tc.id} className="rounded-xl bg-sky-50/40 p-2.5 shadow-[0_0_0_1px_rgba(14,165,233,0.15)]">
                <div className="mb-1.5 flex items-center gap-2">
                  <ResultIcon result={r} />
                  <input value={tc.label} onChange={(e) => set({ label: e.target.value })} onKeyDown={(e) => e.stopPropagation()} aria-label={t('editor.blocks.code_playground.test_label_placeholder', 'Test name')} className={cn(FIELD_CLASS, 'h-7 flex-1 text-xs')} />
                  <button type="button" aria-label={t('common.delete', 'Delete')} onClick={() => setStudentTests((prev) => prev.filter((x) => x.id !== tc.id))} className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-neutral-400 hover:bg-rose-50 hover:text-rose-600">
                    <Trash size={12} />
                  </button>
                </div>
                <div className="grid gap-1.5 @md:grid-cols-2">
                  <textarea rows={2} value={tc.stdin} onChange={(e) => set({ stdin: e.target.value })} onKeyDown={(e) => e.stopPropagation()} placeholder={t('editor.blocks.code_playground.input_placeholder', 'Input')} aria-label={t('editor.blocks.code_playground.input_stdin', 'Input (stdin)')} className={cn(TEXTAREA_CLASS, 'font-mono text-[12px]')} />
                  <textarea rows={2} value={tc.expectedStdout} onChange={(e) => set({ expectedStdout: e.target.value })} onKeyDown={(e) => e.stopPropagation()} placeholder={t('editor.blocks.code_playground.expected_output_placeholder', 'Expected output')} aria-label={t('editor.blocks.code_playground.expected_output', 'Expected output')} className={cn(TEXTAREA_CLASS, 'font-mono text-[12px]')} />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Output ──────────────────────────────────────────────────────────────────

interface OutputProps {
  isAuthor: boolean
  mode: 'run' | 'tests' | null
  results: TestResult[] | null
  tests: TestCase[]
  error: RunError | null
  problem: RunProblem | null
  isSql: boolean
  stdin: string
  setStdin: (_v: string) => void
  showStdin: boolean
}

function SqlTable({ stdout }: { stdout: string }) {
  const lines = stdout.trim().split('\n').filter(Boolean)
  if (!lines.length) return null
  const [head, ...rows] = lines.map((l) => l.split('|'))
  return (
    <div className="overflow-x-auto rounded-lg shadow-[0_0_0_1px_var(--lhb-border,rgba(0,0,0,0.07))]">
      <table className="w-full font-mono text-[12px]">
        <thead><tr className="bg-neutral-50">{head.map((h, i) => <th key={i} className="border-b border-neutral-200 px-2.5 py-1.5 text-start text-[11px] font-semibold text-neutral-500">{h}</th>)}</tr></thead>
        <tbody>{rows.map((row, ri) => <tr key={ri} className="border-b border-neutral-100 last:border-0">{row.map((c, ci) => <td key={ci} className="px-2.5 py-1 text-neutral-700">{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}

export function OutputPanel({ isAuthor, mode, results, tests, error, problem, isSql, stdin, setStdin, showStdin }: OutputProps) {
  const { t } = useTranslation()
  const summary = summarize(results)
  const testById = new Map(tests.map((tc) => [tc.id, tc]))

  const errorText = (e: RunError) => {
    switch (e.kind) {
      case 'rate_limited': return t('editor.blocks_v2.code.err_rate', 'Too many runs in a short time. Wait a moment and try again.')
      case 'unavailable': return t('editor.blocks_v2.code.err_unavailable', 'Code execution isn’t available right now. Try again later, or ask an admin to check the code runner.')
      case 'auth': return t('editor.blocks_v2.code.err_auth', 'Sign in to run code.')
      case 'network': return t('editor.blocks_v2.code.err_network', 'Couldn’t reach the server. Check your connection.')
      default: return e.message || t('editor.blocks_v2.code.err_rejected', 'The run was refused. Check the code and inputs.')
    }
  }
  const problemText = (p: RunProblem) => {
    switch (p.kind) {
      case 'too_many_tests': return t('editor.blocks_v2.code.limit_tests', 'A run holds at most {{max}} tests. Remove some of your own tests.', { max: p.max })
      case 'code_too_long': return t('editor.blocks_v2.code.limit_code', 'The code is longer than the {{max}} characters a run accepts.', { max: p.max })
      case 'input_too_long': return t('editor.blocks_v2.code.limit_input', 'An input is longer than the {{max}} characters a run accepts.', { max: p.max })
      case 'too_many_files': return t('editor.blocks_v2.code.limit_files', 'A run takes at most {{max}} extra files.', { max: p.max })
      default: return t('editor.blocks_v2.code.limit_file', '{{name}} is longer than the {{max}} characters a run accepts.', { name: (p as any).name, max: p.max })
    }
  }

  const stdinField = showStdin && (
    <div>
      <Label>{t('editor.blocks_v2.code.custom_input', 'Input for Run (stdin)')}</Label>
      <textarea
        rows={2}
        value={stdin}
        onChange={(e) => setStdin(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
        placeholder={t('editor.blocks.code_playground.input_placeholder', 'Input')}
        aria-label={t('editor.blocks_v2.code.custom_input', 'Input for Run (stdin)')}
        className={cn(TEXTAREA_CLASS, 'font-mono text-[12px]')}
      />
    </div>
  )

  if (problem || error) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <div role="alert" className="flex items-start gap-2 rounded-xl bg-rose-50/70 px-3 py-2.5 text-[13px] text-rose-700 ring-1 ring-rose-100">
          <WarningCircle size={16} weight="fill" className="mt-0.5 shrink-0" />
          {problem ? problemText(problem) : errorText(error!)}
        </div>
        {stdinField}
      </div>
    )
  }

  if (!results || !summary) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-col items-center justify-center gap-2 py-8 text-neutral-400">
          <Terminal size={22} />
          <span className="text-[13px]">{t('editor.blocks.code_playground.run_to_see_output', 'Run your code to see the output')}</span>
        </div>
        {stdinField}
      </div>
    )
  }

  // A single run: the console.
  if (mode === 'run') {
    const r = results[0]
    const statusId = r?.status?.id
    const tone = statusId === STATUS.accepted ? 'text-emerald-700 bg-emerald-50' : statusId === STATUS.compileError ? 'text-amber-700 bg-amber-50' : 'text-rose-700 bg-rose-50'
    return (
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('rounded-md px-2 py-0.5 text-[11px] font-semibold', tone)}>
            {r?.status?.description || (r?.passed ? t('editor.blocks.code_playground.accepted') : t('editor.blocks.code_playground.failed'))}
          </span>
          {r?.time && <span className="font-mono text-[11px] text-neutral-400">{Math.round(parseFloat(r.time) * 1000)} ms</span>}
          {r?.memory ? <span className="font-mono text-[11px] text-neutral-400">{Math.round(r.memory)} KB</span> : null}
        </div>
        <div className="overflow-hidden rounded-xl bg-[#1a1b26]">
          <div className="flex items-center justify-between border-b border-white/5 px-3 py-1.5">
            <span className="font-mono text-[11px] text-neutral-500">{t('editor.blocks.code_playground.terminal_label', 'Console')}</span>
            {r?.actual_stdout && <CopyButton text={r.actual_stdout} />}
          </div>
          <div className="max-h-72 overflow-auto p-3" dir="ltr">
            {r?.actual_stdout && isSql && r.actual_stdout.includes('|') ? (
              <div className="rounded-lg bg-white"><SqlTable stdout={r.actual_stdout} /></div>
            ) : r?.actual_stdout ? (
              <div className={cn(MONO, 'text-[13px] text-white/90')}>{r.actual_stdout}</div>
            ) : null}
            {r?.stderr && <div className={cn(MONO, 'mt-1 text-rose-300')}>{r.stderr}</div>}
            {r?.compile_output && <div className={cn(MONO, 'mt-1 text-amber-300')}>{r.compile_output}</div>}
            {!r?.actual_stdout && !r?.stderr && !r?.compile_output && <div className={cn(MONO, 'italic text-neutral-500')}>{t('editor.blocks.code_playground.no_output', 'No output')}</div>}
          </div>
        </div>
        {stdinField}
      </div>
    )
  }

  // Tests: a score, then each result.
  const pct = summary.total ? Math.round((summary.passed / summary.total) * 100) : 0
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className={cn('rounded-xl px-3.5 py-3 ring-1', summary.allPassed ? 'bg-emerald-50/70 ring-emerald-100' : 'bg-white ring-neutral-200/70')}>
        <div className="flex items-center justify-between gap-2">
          <span className={cn('flex items-center gap-1.5 text-[13px] font-semibold', summary.allPassed ? 'text-emerald-700' : 'text-neutral-800')}>
            {summary.allPassed ? <CheckCircle size={15} weight="fill" /> : <XCircle size={15} weight="fill" className="text-rose-500" />}
            {summary.allPassed ? t('editor.blocks.code_playground.all_tests_passed', 'All tests passed!') : t('editor.blocks.code_playground.tests_passed_count', { passed: summary.passed, total: summary.total })}
          </span>
          <span className="font-mono text-[12px] font-semibold text-neutral-600">{pct}%</span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
          <div className={cn('h-full rounded-full transition-all duration-500', summary.allPassed ? 'bg-emerald-500' : 'bg-amber-400')} style={{ width: `${pct}%` }} />
        </div>
      </div>

      {summary.compileOutput && (
        <div>
          <Label className="text-amber-700">{t('editor.blocks_v2.code.compile_error', 'Compiler output')}</Label>
          <div className={cn(CODE_BOX, 'bg-amber-50/70 text-amber-800')} dir="ltr">{summary.compileOutput}</div>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {results.map((raw, i) => {
          const tc = testById.get(raw.id)
          const r = visibleResult(raw, tc, isAuthor)
          const label = r.redacted ? t('editor.blocks_v2.code.hidden_test', { number: i + 1, defaultValue: 'Hidden test {{number}}' }) : r.label
          return (
            <div key={r.id} className="rounded-xl bg-white px-3 py-2 shadow-[0_0_0_1px_var(--lhb-border,rgba(0,0,0,0.07))]">
              <div className="flex items-center gap-2">
                <ResultIcon result={r} />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-neutral-800">{label}</span>
                {r.redacted && <Lock size={11} className="text-neutral-400" />}
                {tc?.hidden && isAuthor && <EyeSlash size={12} className="text-neutral-400" />}
                <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-semibold', r.passed ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700')}>
                  {r.status?.description || (r.passed ? t('editor.blocks.code_playground.accepted') : t('editor.blocks.code_playground.failed'))}
                </span>
                {r.time && <span className="hidden font-mono text-[10px] text-neutral-400 @sm:inline">{r.time}s</span>}
              </div>
              {!r.passed && !r.redacted && (r.actual_stdout != null || r.stderr) && (
                <div className="mt-2 grid gap-2 @md:grid-cols-2" dir="ltr">
                  <div>
                    <Label>{t('editor.blocks.code_playground.output', 'Output')}</Label>
                    <div className={cn(CODE_BOX, 'text-rose-700')}>{r.actual_stdout || r.stderr || t('editor.blocks.code_playground.no_output')}</div>
                  </div>
                  {r.expected_stdout && (
                    <div>
                      <Label>{t('editor.blocks.code_playground.expected', 'Expected')}</Label>
                      <div className={cn(CODE_BOX, 'text-emerald-700')}>{r.expected_stdout}</div>
                    </div>
                  )}
                </div>
              )}
              {!r.passed && r.redacted && (
                <p className="mt-1 text-[11px] text-neutral-400">{t('editor.blocks_v2.code.hidden_failed', 'This test’s input is hidden. Check edge cases the visible tests don’t cover.')}</p>
              )}
            </div>
          )
        })}
      </div>
      {stdinField}
    </div>
  )
}
