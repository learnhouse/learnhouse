'use client'
/*
 Code playground block.

 Authors write the starter code (and a solution, extra files, tests) right in
 the block; the rest of the settings live in a popover. Learners get the same
 layout: editor on the start side, Instructions / Tests / Output on the other,
 stacked on narrow screens.

 Collab: code is a local draft committed after a pause and on blur (useDraft);
 every other field commits on blur/click. Nothing writes per keystroke, and
 nothing writes on mount.
*/
import { NodeViewWrapper } from '@tiptap/react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowCounterClockwise, BracketsCurly, CheckCircle, Code, CircleNotch, Clock, ClockCounterClockwise, Eye, Flask, FileText, GearSix, Lock, Play, Plus, Terminal, Trash, X,
} from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import dynamic from 'next/dynamic'
import { v4 as uuidv4 } from 'uuid'
import { linter, lintGutter } from '@codemirror/lint'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { useCourse } from '@components/Contexts/CourseContext'
import { uploadSqliteDb } from '@services/blocks/CodePlayground/sqlite'
import { getAPIUrl } from '@services/config/config'
import { cn } from '@/lib/utils'
import EditorBlockFrame from '../../Blocks/ui/EditorBlockFrame'
import { BlockPopover, Segmented } from '../../Blocks/ui/BlockChrome'
import { getLanguageById } from './languages'
import SubmissionHistory from './SubmissionHistory'
import CodeDiff from './CodeDiff'
import { parseBlankRegions, getBlankRegionExtensions } from './FillInTheBlank'
import { createPlaygroundKeymap } from './keymap'
import { parseErrors, errorsToDiagnostics } from './errorAnnotations'
import { cmClassName, cmStyles, getLanguageExtension, getLockedRegionExtensions, getTheme, parseLockedRegions } from './playground/codemirrorSetup'
import {
  LIMITS, checkRun, clampTimeLimitMs, executeOnce, executeTests, normalizeTestCases, shouldReplaceStarter, summarize,
  type AdditionalFile, type RunError, type RunProblem, type TestCase, type TestResult,
} from './playground/runner'
import { useDraft } from './playground/useDraft'
import LanguagePicker from './playground/LanguagePicker'
import SettingsPanel, { DIFFICULTY_STYLE, type Difficulty } from './playground/SettingsPanel'
import { InstructionsPanel, OutputPanel, TestsPanel } from './playground/panels'

const CodeMirror = dynamic(() => import('@uiw/react-codemirror'), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-[#1a1b26]" />,
})
const ReactConfetti = dynamic(() => import('react-confetti'), { ssr: false })

type Tab = 'instructions' | 'tests' | 'output' | 'history'
type FileTab = 'main' | 'solution' | number

const BASIC_SETUP = { lineNumbers: true, foldGutter: false, highlightActiveLine: true, autocompletion: true } as const

/** A CodeMirror bound to a node attr through a draft (commits after a pause and on blur). */
function DraftEditor({ value, onCommit, extensions, editable = true, onCreate }: { value: string; onCommit: (_v: string) => void; extensions: any[]; editable?: boolean; onCreate?: (_view: any) => void }) {
  const { draft, setDraft, flush } = useDraft(value, onCommit)
  return (
    <div className="h-full" onBlur={flush}>
      <CodeMirror
        value={draft}
        onChange={setDraft}
        onCreateEditor={onCreate}
        editable={editable}
        extensions={extensions}
        height="100%"
        style={{ ...cmStyles, height: '100%' }}
        basicSetup={BASIC_SETUP}
      />
    </div>
  )
}

function duplicateIdBefore(doc: any, pos: number, id: string): boolean {
  let dup = false
  doc.descendants((n: any, p: number) => {
    if (dup || p >= pos) return false
    if (n.type.name === 'blockCode' && n.attrs.blockUuid === id) dup = true
    return !dup
  })
  return dup
}

const CodePlaygroundComponent: React.FC<any> = (props) => {
  const { node, editor, getPos } = props
  const { t } = useTranslation()
  const editorState = useEditorProvider() as any
  const session = useLHSession() as any
  const org = useOrg() as any
  const course = useCourse() as any
  const isAuthor = !!(editorState?.isEditable ?? true)
  const token: string | undefined = session?.data?.tokens?.access_token
  const attrs = node.attrs

  const languageId: number = attrs.languageId
  const languageName: string = attrs.languageName || getLanguageById(languageId)?.name || 'Code'
  const starterCode: string = attrs.starterCode || ''
  const solutionCode: string = attrs.solutionCode || ''
  const tests = useMemo(() => normalizeTestCases(attrs.testCases), [attrs.testCases])
  const hints: string[] = useMemo(() => (Array.isArray(attrs.hints) ? attrs.hints.filter((h: unknown) => typeof h === 'string') : []), [attrs.hints])
  const files: AdditionalFile[] = useMemo(
    () => (Array.isArray(attrs.additionalFiles) ? attrs.additionalFiles.filter((f: any) => f && typeof f === 'object').map((f: any) => ({ name: String(f.name ?? ''), content: String(f.content ?? '') })) : []),
    [attrs.additionalFiles],
  )
  const difficulty: Difficulty = attrs.difficulty === 'easy' || attrs.difficulty === 'hard' ? attrs.difficulty : 'medium'
  const maxAttempts: number = typeof attrs.maxAttemptsBeforeReveal === 'number' ? attrs.maxAttemptsBeforeReveal : 3
  const timeLimitMs = clampTimeLimitMs(attrs.timeLimitMs ?? 10000)
  const timedMode = !!attrs.timedMode
  const timedDurationMs: number = attrs.timedDurationMs ?? 300000
  const isSql = languageId === 82
  // Blocks get an id on their first edit (see commit); older ones share 'unknown'.
  const blockId: string = attrs.blockUuid || 'unknown'
  const activityUuid: string = props.extension?.options?.activity?.activity_uuid || ''

  // ─── Writes ───
  // One guarded write per change. The node may be gone by the time a pending
  // draft flushes (deleted, undone), so check the position still holds us.
  const commit = useCallback(
    (patch: Record<string, any>) => {
      if (!isAuthor || !editor) return
      const pos = typeof getPos === 'function' ? getPos() : undefined
      if (typeof pos !== 'number') return
      const current = editor.state.doc.nodeAt(pos)
      if (!current || current.type.name !== 'blockCode') return
      const id = current.attrs.blockUuid
      const needsId = !id || duplicateIdBefore(editor.state.doc, pos, id)
      editor.commands.command(({ tr }: any) => {
        tr.setNodeMarkup(pos, undefined, { ...current.attrs, ...patch, ...(needsId ? { blockUuid: uuidv4() } : {}) })
        return true
      })
    },
    [isAuthor, editor, getPos],
  )
  const commitTests = useCallback((next: TestCase[]) => commit({ testCases: next.map(({ hidden, ...tc }) => (hidden ? { ...tc, hidden: true } : tc)) }), [commit])
  const commitFile = useCallback((i: number, patch: Partial<AdditionalFile>) => commit({ additionalFiles: files.map((f, j) => (j === i ? { ...f, ...patch } : f)) }), [commit, files])

  // ─── Code ───
  const starter = useDraft(starterCode, (v) => commit({ starterCode: v }))
  const [learnerCode, setLearnerCode] = useState(starterCode)
  // The author changed the starter (another tab, a collaborator): follow it.
  const [lastStarter, setLastStarter] = useState(starterCode)
  if (!isAuthor && starterCode !== lastStarter) {
    setLastStarter(starterCode)
    setLearnerCode(starterCode)
  }
  const code = isAuthor ? starter.draft : learnerCode

  const [fileTab, setFileTab] = useState<FileTab>('main')
  const activeFile = typeof fileTab === 'number' && fileTab < files.length ? fileTab : null
  const showingSolution = isAuthor && fileTab === 'solution'

  // ─── CodeMirror extensions ───
  const [extensions, setExtensions] = useState<any[]>([])
  const [plainExtensions, setPlainExtensions] = useState<any[]>([])
  const parsedErrorsRef = useRef<ReturnType<typeof parseErrors>>([])
  const cmViewRef = useRef<any>(null)
  const runPrimaryRef = useRef<() => void>(() => {})
  const resetRef = useRef<() => void>(() => {})

  useEffect(() => {
    const lang = getLanguageById(languageId)
    if (!lang) return
    let cancelled = false
    ;(async () => {
      const [langExt, theme] = await Promise.all([getLanguageExtension(lang.codemirrorLang), getTheme()])
      const exts: any[] = [langExt, theme]
      try {
        const { autocompletion } = await import('@codemirror/autocomplete')
        exts.push(autocompletion())
      } catch {
        // optional
      }
      if (!isAuthor && starterCode) {
        if (parseLockedRegions(starterCode).size > 0) exts.push(...(await getLockedRegionExtensions(starterCode)))
        if (parseBlankRegions(starterCode).length > 0) exts.push(...getBlankRegionExtensions(starterCode))
      }
      exts.push(createPlaygroundKeymap({ onRun: () => runPrimaryRef.current(), onReset: () => resetRef.current() }))
      exts.push(linter((view) => errorsToDiagnostics(parsedErrorsRef.current, view.state.doc)), lintGutter())
      if (!cancelled) {
        setExtensions(exts)
        setPlainExtensions([langExt, theme])
      }
    })()
    return () => {
      cancelled = true
    }
    // Locked/blank regions are fixed when the learner view mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [languageId, isAuthor])

  // Error marks belong to the run that produced them.
  useEffect(() => {
    parsedErrorsRef.current = []
    cmViewRef.current?.dispatch({})
  }, [code])

  // ─── Running ───
  const [running, setRunning] = useState(false)
  const [mode, setMode] = useState<'run' | 'tests' | null>(null)
  const [results, setResults] = useState<TestResult[] | null>(null)
  const [runError, setRunError] = useState<RunError | null>(null)
  const [problem, setProblem] = useState<RunProblem | null>(null)
  const [tab, setTab] = useState<Tab>('instructions')
  const [stdin, setStdin] = useState('')
  const [studentTests, setStudentTests] = useState<TestCase[]>([])
  const [attempts, setAttempts] = useState(0)
  const [elapsedMs, setElapsedMs] = useState(0)
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])

  const hasTests = tests.length > 0 || (!isAuthor && studentTests.length > 0)
  const primaryKind: 'run' | 'tests' = hasTests ? 'tests' : 'run'

  // Timed challenge (learners).
  const [challengeStarted, setChallengeStarted] = useState(false)
  const [challengeLeft, setChallengeLeft] = useState(timedDurationMs)
  const challengeExpired = timedMode && challengeStarted && challengeLeft <= 0
  useEffect(() => {
    if (!timedMode || !challengeStarted || isAuthor) return
    const timer = setInterval(() => setChallengeLeft((v) => Math.max(0, v - 1000)), 1000)
    return () => clearInterval(timer)
  }, [timedMode, challengeStarted, isAuthor])

  useEffect(() => {
    if (!running) return
    const started = Date.now()
    const timer = setInterval(() => setElapsedMs(Date.now() - started), 100)
    return () => clearInterval(timer)
  }, [running])

  const run = useCallback(
    async (kind: 'run' | 'tests') => {
      if (running || !token) return
      if (!isAuthor && timedMode && (challengeExpired || !challengeStarted)) return
      const batch = kind === 'tests' ? [...tests, ...(isAuthor ? [] : studentTests)] : []
      const blocked = checkRun(code, batch, files, kind === 'run' ? stdin : '')
      setTab('output')
      if (blocked) {
        setProblem(blocked)
        setRunError(null)
        return
      }
      setProblem(null)
      setRunError(null)
      setResults(null)
      setMode(kind)
      setElapsedMs(0)
      setRunning(true)
      if (kind === 'tests' && !isAuthor) setAttempts((a) => a + 1)
      const req = { apiUrl: getAPIUrl(), token, activityUuid, languageId, code, files, sqliteDbPath: isSql && attrs.sqliteDbPath ? attrs.sqliteDbPath : undefined }
      const out = kind === 'tests' ? await executeTests(req, batch) : await executeOnce(req, stdin, t('editor.blocks.code_playground.tab_output', 'Output'))
      if (!mounted.current) return
      setRunning(false)
      if (!out.ok) {
        setRunError(out.error)
        return
      }
      setResults(out.results)
      const first = out.results[0]
      parsedErrorsRef.current = parseErrors(first?.stderr || null, first?.compile_output || null)
      cmViewRef.current?.dispatch({})

      // Learners' graded runs are kept for their history (as before: test
      // runs, or plain runs on a block without tests).
      if (!isAuthor && activityUuid && (kind === 'tests' || tests.length === 0)) {
        const passed = out.results.filter((r) => r.passed).length
        fetch(`${getAPIUrl()}code/submissions/save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            activity_uuid: activityUuid,
            block_id: blockId,
            language_id: languageId,
            source_code: code,
            results: { items: out.results },
            passed: passed === out.results.length && out.results.length > 0,
            total_tests: out.results.length,
            passed_tests: passed,
            execution_time_ms: first?.time ? Math.round(parseFloat(first.time) * 1000) : null,
          }),
        }).catch(() => {})
      }
    },
    [running, token, isAuthor, timedMode, challengeExpired, challengeStarted, tests, studentTests, code, files, stdin, activityUuid, languageId, isSql, attrs.sqliteDbPath, blockId, t],
  )

  const resetCode = useCallback(() => {
    setLearnerCode(starterCode)
    setResults(null)
    setRunError(null)
    setProblem(null)
  }, [starterCode])

  useEffect(() => {
    runPrimaryRef.current = () => run(primaryKind)
    resetRef.current = () => { if (!isAuthor) resetCode() }
  })

  const summary = summarize(results)
  const allPassed = !!summary?.allPassed && mode === 'tests'

  // Confetti when a learner's test run passes everything.
  const containerRef = useRef<HTMLDivElement>(null)
  const [confetti, setConfetti] = useState<{ w: number; h: number } | null>(null)
  useEffect(() => {
    if (!allPassed || isAuthor || !containerRef.current) return
    setConfetti({ w: containerRef.current.offsetWidth, h: containerRef.current.offsetHeight })
    const timer = setTimeout(() => setConfetti(null), 4000)
    return () => clearTimeout(timer)
  }, [allPassed, isAuthor])

  // ─── Author tools ───
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [uploadingDb, setUploadingDb] = useState(false)
  const dbInputRef = useRef<HTMLInputElement>(null)

  const onLanguage = (id: number) => {
    const lang = getLanguageById(id)
    if (!lang) return
    starter.flush()
    // Swap in the new template only over an untouched starter; real code stays.
    const replace = shouldReplaceStarter(starter.draft, getLanguageById(languageId)?.defaultCode)
    commit({ languageId: lang.id, languageName: lang.name, ...(replace ? { starterCode: lang.defaultCode } : {}) })
  }

  const onDbFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (dbInputRef.current) dbInputRef.current.value = ''
    if (!file || !token) return
    const orgUuid = org?.org_uuid
    const courseUuid = course?.courseStructure?.course_uuid
    if (!activityUuid || !orgUuid || !courseUuid) return
    setUploadingDb(true)
    try {
      const id = attrs.blockUuid || uuidv4()
      const result = await uploadSqliteDb(file, activityUuid, id, orgUuid, courseUuid, token)
      commit({ sqliteDbPath: result.file_path, sqliteDbName: result.file_name, blockUuid: id })
    } catch {
      // The settings field stays on "Upload" so the author can retry.
    } finally {
      if (mounted.current) setUploadingDb(false)
    }
  }

  const addFile = () => {
    if (files.length >= LIMITS.files) return
    let n = files.length + 1
    while (files.some((f) => f.name === `data${n}.txt`)) n++
    commit({ additionalFiles: [...files, { name: `data${n}.txt`, content: '' }] })
    setFileTab(files.length)
  }
  const removeFile = (i: number) => {
    commit({ additionalFiles: files.filter((_, j) => j !== i) })
    setFileTab('main')
  }

  // ─── Pieces ───
  const diffStyle = DIFFICULTY_STYLE[difficulty]
  const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`

  const header = (
    <div className="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-white/[0.06] px-4 py-2" dir="ltr">
      <Code weight="duotone" size={14} className="text-neutral-500" />
      <span className="text-[12px] font-semibold tracking-tight text-neutral-300">{t('editor.toolbar.code_playground', 'Code playground')}</span>
      <span className={cn('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold', diffStyle.darkChip)}>
        <span className={cn('h-1.5 w-1.5 rounded-full', diffStyle.dot)} />
        {t(diffStyle.labelKey)}
      </span>
      {timedMode && (
        <span className="inline-flex items-center gap-1 rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-neutral-400">
          <Clock size={11} /> {t('editor.blocks_v2.code.minutes', { count: Math.round(timedDurationMs / 60000), defaultValue: '{{count}} min' })}
        </span>
      )}
      <div className="ms-auto flex items-center gap-1">
        {isAuthor ? (
          <>
            <LanguagePicker languageId={languageId} languageName={languageName} onChange={onLanguage} />
            <BlockPopover
              open={settingsOpen}
              onOpenChange={setSettingsOpen}
              width={340}
              title={t('editor.blocks_v2.code.settings', 'Exercise settings')}
              trigger={
                <button
                  type="button"
                  aria-label={t('editor.blocks_v2.code.settings', 'Exercise settings')}
                  title={t('editor.blocks_v2.code.settings', 'Exercise settings')}
                  className={cn('inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-white/[0.06] hover:text-neutral-300', settingsOpen && 'bg-white/[0.08] text-neutral-200')}
                >
                  <GearSix size={14} />
                </button>
              }
            >
              <SettingsPanel
                attrs={attrs}
                commit={commit}
                isSql={isSql}
                uploadingDb={uploadingDb}
                onPickDb={() => dbInputRef.current?.click()}
                canResetStarter={(getLanguageById(languageId)?.defaultCode || '') !== starter.draft}
                onResetStarter={() => {
                  const tpl = getLanguageById(languageId)?.defaultCode
                  if (tpl !== undefined) {
                    starter.setDraft(tpl)
                    starter.flush()
                  }
                }}
              />
            </BlockPopover>
            <input ref={dbInputRef} type="file" accept=".sqlite,.db,.sqlite3" className="hidden" onChange={onDbFile} />
          </>
        ) : (
          <>
            <span className="px-1 py-1.5 text-[12px] font-medium text-neutral-500">{languageName}</span>
            <button
              type="button"
              onClick={resetCode}
              title={t('editor.blocks.code_playground.reset_code', 'Reset code')}
              aria-label={t('editor.blocks.code_playground.reset_code', 'Reset code')}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 transition-colors hover:text-neutral-300"
            >
              <ArrowCounterClockwise size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  )

  const tabBtn = (id: FileTab, label: React.ReactNode, icon: React.ReactNode) => (
    <button
      key={String(id)}
      type="button"
      onClick={() => setFileTab(id)}
      className={cn(
        'flex shrink-0 items-center gap-1.5 whitespace-nowrap border-e border-white/[0.06] px-3.5 py-2 text-[11px] font-medium transition-colors',
        fileTab === id ? 'border-b-2 border-b-blue-500 bg-[#1a1b26] text-neutral-200' : 'text-neutral-500 hover:bg-white/[0.03] hover:text-neutral-300',
      )}
    >
      {icon}
      {label}
    </button>
  )

  const editorArea = (
    // Dark by design in every block theme: keeps the original palette (data-lhb-keep).
    <div data-lhb-keep="" className="relative flex min-h-0 min-w-0 flex-col bg-[#1a1b26]">
      {header}
      <div className="flex shrink-0 items-center overflow-x-auto border-b border-white/[0.06] bg-[#16161e]" dir="ltr">
        {tabBtn('main', isAuthor ? t('editor.blocks_v2.code.starter', 'Starter code') : t('editor.blocks_v2.code.your_code', 'Your code'), <BracketsCurly size={12} />)}
        {isAuthor && tabBtn('solution', t('editor.blocks.code_playground.solution', 'Solution'), <Eye size={12} />)}
        {files.map((f, i) => tabBtn(i, f.name || `file-${i + 1}`, <FileText size={12} />))}
        {isAuthor && files.length < LIMITS.files && (
          <button type="button" onClick={addFile} title={t('editor.blocks.code_playground.add_file', 'Add file')} aria-label={t('editor.blocks.code_playground.add_file', 'Add file')} className="ms-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-neutral-500 hover:bg-white/10 hover:text-neutral-200">
            <Plus size={12} />
          </button>
        )}
      </div>
      {isAuthor && activeFile !== null && (
        <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-1.5" dir="ltr">
          <span className="text-[11px] text-neutral-500">{t('editor.blocks_v2.code.file_name', 'File name')}</span>
          <input
            key={`name-${activeFile}-${files[activeFile]?.name}`}
            defaultValue={files[activeFile]?.name}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            onBlur={(e) => {
              const name = e.target.value.trim()
              if (name && name !== files[activeFile]?.name) commitFile(activeFile, { name })
            }}
            aria-label={t('editor.blocks_v2.code.file_name', 'File name')}
            className="h-6 min-w-0 flex-1 rounded-md bg-white/5 px-2 font-mono text-[11px] text-neutral-200 outline-none focus:bg-white/10"
          />
          <button type="button" aria-label={t('common.delete', 'Delete')} onClick={() => removeFile(activeFile)} className="inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 hover:bg-rose-500/20 hover:text-rose-300">
            <Trash size={12} />
          </button>
        </div>
      )}
      {showingSolution && (
        <div className="border-b border-white/[0.06] px-3 py-1.5 text-[11px] text-neutral-500">{t('editor.blocks.code_playground.solution_hint')}</div>
      )}
      <div dir="ltr" className={cn('relative h-[300px] min-h-0 overflow-hidden @3xl:h-auto @3xl:flex-1', cmClassName)}>
        {extensions.length > 0 && (
          activeFile !== null ? (
            isAuthor ? (
              <DraftEditor key={`file-${activeFile}`} value={files[activeFile]?.content || ''} onCommit={(v) => commitFile(activeFile, { content: v })} extensions={plainExtensions} />
            ) : (
              <CodeMirror value={files[activeFile]?.content || ''} editable={false} extensions={plainExtensions} height="100%" style={{ ...cmStyles, height: '100%' }} basicSetup={BASIC_SETUP} />
            )
          ) : showingSolution ? (
            <DraftEditor key="solution" value={solutionCode} onCommit={(v) => commit({ solutionCode: v })} extensions={plainExtensions} />
          ) : isAuthor ? (
            <div className="h-full" onBlur={starter.flush}>
              <CodeMirror
                value={starter.draft}
                onChange={starter.setDraft}
                onCreateEditor={(view: any) => { cmViewRef.current = view }}
                extensions={extensions}
                height="100%"
                style={{ ...cmStyles, height: '100%' }}
                basicSetup={BASIC_SETUP}
              />
            </div>
          ) : (
            <CodeMirror
              value={learnerCode}
              onChange={setLearnerCode}
              onCreateEditor={(view: any) => { cmViewRef.current = view }}
              editable={!challengeExpired}
              extensions={extensions}
              height="100%"
              style={{ ...cmStyles, height: '100%' }}
              basicSetup={BASIC_SETUP}
            />
          )
        )}
      </div>

      {/* Run bar */}
      <div className="border-t border-white/[0.06]">
        <div className="h-0.5 w-full bg-white/[0.04]">
          {(running || results) && (
            <div
              className={cn('h-full transition-all', running ? 'bg-sky-400 duration-100' : results?.some((r) => r.status?.id === 5) ? 'bg-rose-500 duration-300' : allPassed ? 'bg-emerald-400 duration-300' : 'bg-neutral-500 duration-300')}
              style={{ width: running ? `${Math.min(100, (elapsedMs / timeLimitMs) * 100)}%` : '100%' }}
            />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
          <button
            type="button"
            onClick={() => run(primaryKind)}
            disabled={running || !token || challengeExpired}
            className="inline-flex items-center gap-2 rounded-lg bg-white/[0.10] px-4 py-2 text-[13px] font-semibold text-neutral-200 transition-all hover:bg-white/[0.14] disabled:cursor-not-allowed disabled:bg-white/[0.06] disabled:text-neutral-500"
          >
            {running ? <CircleNotch size={13} className="animate-spin" /> : primaryKind === 'tests' ? <Flask size={13} weight="fill" /> : <Play size={13} weight="fill" />}
            {primaryKind === 'tests'
              ? isAuthor ? t('editor.blocks_v2.code.test_solution', 'Run tests') : t('editor.blocks_v2.code.run_tests', 'Run tests')
              : isAuthor ? t('editor.blocks.code_playground.test_run', 'Test run') : t('editor.blocks.code_playground.run_code', 'Run')}
          </button>
          {primaryKind === 'tests' && (
            <button
              type="button"
              onClick={() => run('run')}
              disabled={running || !token || challengeExpired}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-neutral-300 transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              <Play size={13} /> {t('editor.blocks_v2.code.run', 'Run')}
            </button>
          )}
          <kbd className="hidden font-sans text-[10px] text-neutral-500 sm:inline">{typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘' : 'Ctrl'}+Enter</kbd>
          <div className="ms-auto flex items-center gap-2">
            {running && <span className="font-mono text-[11px] text-neutral-400">{(elapsedMs / 1000).toFixed(1)}s / {Math.round(timeLimitMs / 1000)}s</span>}
            {!running && allPassed && (
              <span className="flex items-center gap-1 text-[12px] font-semibold text-emerald-400"><CheckCircle size={13} weight="fill" />{t('editor.blocks.code_playground.all_passed', 'All passed')}</span>
            )}
            {!running && summary && mode === 'tests' && !summary.allPassed && (
              <span className="font-mono text-[12px] font-semibold text-amber-300">{summary.passed}/{summary.total}</span>
            )}
            {!token && <span className="text-[11px] text-neutral-500">{t('editor.blocks_v2.code.err_auth', 'Sign in to run code.')}</span>}
            {timedMode && challengeStarted && !isAuthor && (
              <span className={cn('font-mono text-[12px] font-semibold', challengeLeft < 30000 ? 'text-rose-400' : 'text-neutral-300')}>{mmss(challengeLeft)}</span>
            )}
          </div>
        </div>
      </div>

      {/* Timed challenge gate */}
      {timedMode && !isAuthor && (!challengeStarted || challengeExpired) && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[#1a1b26]/95 p-6 text-center">
          <Clock size={28} className="text-neutral-400" />
          <span className="text-[14px] font-semibold text-neutral-100">
            {challengeExpired ? t('editor.blocks_v2.code.time_up', 'Time’s up') : t('editor.blocks.code_playground.timed_challenge', 'Timed challenge')}
          </span>
          <span className="max-w-xs text-[12px] text-neutral-400">
            {challengeExpired
              ? t('editor.blocks_v2.code.time_up_hint', 'Your last results stay below. Reload the page to try again.')
              : t('editor.blocks.code_playground.timed_intro', { count: Math.floor(timedDurationMs / 60000) })}
          </span>
          {!challengeExpired && (
            <button type="button" onClick={() => { setChallengeStarted(true); setChallengeLeft(timedDurationMs) }} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-[13px] font-semibold text-neutral-900 hover:bg-neutral-100">
              <Play size={13} weight="fill" /> {t('editor.blocks.code_playground.start_challenge', 'Start challenge')}
            </button>
          )}
        </div>
      )}
    </div>
  )

  // Learners: the solution unlocks after enough test runs.
  const [showSolution, setShowSolution] = useState(false)
  const [solutionView, setSolutionView] = useState<'diff' | 'solution'>('diff')
  const canReveal = !!solutionCode && !isAuthor && attempts >= maxAttempts
  const solutionBlock = !isAuthor && solutionCode ? (
    <div className="flex flex-col gap-2 border-t border-neutral-100 pt-3">
      {canReveal ? (
        <>
          <button type="button" onClick={() => setShowSolution((v) => !v)} className="inline-flex w-fit items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-neutral-700 shadow-[0_0_0_1px_var(--lhb-border-strong,rgba(0,0,0,0.08))] hover:bg-neutral-50">
            {showSolution ? <X size={12} /> : <Eye size={12} />}
            {showSolution ? t('editor.blocks.code_playground.hide_solution', 'Hide solution') : t('editor.blocks.code_playground.view_solution', 'View solution')}
          </button>
          {showSolution && (
            <>
              <div className="w-48">
                <Segmented
                  ariaLabel={t('editor.blocks.code_playground.solution', 'Solution')}
                  value={solutionView}
                  onChange={setSolutionView}
                  options={[
                    { value: 'diff', label: t('editor.blocks.code_playground.diff', 'Diff') },
                    { value: 'solution', label: t('editor.blocks.code_playground.solution', 'Solution') },
                  ]}
                />
              </div>
              {solutionView === 'diff' ? (
                <CodeDiff studentCode={code} solutionCode={solutionCode} />
              ) : (
                <div dir="ltr" className={cn('overflow-hidden rounded-lg', cmClassName)}>
                  {plainExtensions.length > 0 && <CodeMirror value={solutionCode} extensions={plainExtensions} editable={false} height="auto" maxHeight="300px" style={cmStyles} basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: false }} />}
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <span className="flex items-center gap-1.5 text-[11px] text-neutral-500">
          <Lock size={11} /> {t('editor.blocks.code_playground.solution_available_after', { count: Math.max(0, maxAttempts - attempts) })}
        </span>
      )}
    </div>
  ) : null

  const tabs: { id: Tab; label: string; icon: React.ReactNode; badge?: React.ReactNode }[] = [
    { id: 'instructions', label: t('editor.blocks.code_playground.tab_description', 'Description'), icon: <FileText weight="duotone" size={13} /> },
    {
      id: 'tests',
      label: t('editor.blocks.code_playground.tab_test_cases', 'Tests'),
      icon: <Flask size={13} />,
      badge: tests.length > 0 ? (
        <span className={cn('rounded-full px-1.5 py-px text-[10px] font-semibold leading-none', summary && mode === 'tests' ? (summary.allPassed ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700') : 'bg-neutral-100 text-neutral-600')}>
          {summary && mode === 'tests' ? `${summary.passed}/${summary.total}` : tests.length}
        </span>
      ) : null,
    },
    { id: 'output', label: t('editor.blocks.code_playground.tab_output', 'Output'), icon: <Terminal size={13} />, badge: running ? <CircleNotch size={11} className="animate-spin text-neutral-400" /> : null },
    ...(!isAuthor ? [{ id: 'history' as Tab, label: t('editor.blocks.code_playground.tab_history', 'History'), icon: <ClockCounterClockwise size={13} /> }] : []),
  ]

  const panel = (
    <div className="flex min-h-0 min-w-0 flex-col border-t border-neutral-200/60 bg-white @3xl:border-s @3xl:border-t-0">
      <div role="tablist" className="flex shrink-0 items-center overflow-x-auto border-b border-neutral-200/60 px-1 scrollbar-hide">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            type="button"
            role="tab"
            aria-selected={tab === tb.id}
            onClick={() => setTab(tb.id)}
            className={cn(
              'relative flex shrink-0 items-center gap-1.5 px-3.5 py-3 text-[12px] font-semibold transition-all @max-md:flex-1 @max-md:justify-center @max-md:px-2',
              tab === tb.id ? 'text-neutral-800' : 'text-neutral-500 hover:text-neutral-700',
            )}
          >
            {tb.icon}
            <span className={cn(tab !== tb.id && '@max-sm:sr-only')}>{tb.label}</span>
            {tb.badge}
            {tab === tb.id && <span className="absolute inset-x-3 bottom-0 h-[2px] rounded-full bg-neutral-800" />}
          </button>
        ))}
      </div>
      <div className="max-h-[460px] min-h-[180px] flex-1 overflow-y-auto @3xl:max-h-none">
        {tab === 'instructions' && <InstructionsPanel isAuthor={isAuthor} attrs={attrs} commit={commit} hints={hints} isSql={isSql} solution={solutionBlock} />}
        {tab === 'tests' && <TestsPanel isAuthor={isAuthor} tests={tests} results={mode === 'tests' ? results : null} commitTests={commitTests} studentTests={studentTests} setStudentTests={setStudentTests} />}
        {tab === 'output' && (
          <OutputPanel
            isAuthor={isAuthor}
            mode={mode}
            results={results}
            tests={tests}
            error={runError}
            problem={problem}
            isSql={isSql}
            stdin={stdin}
            setStdin={setStdin}
            showStdin
          />
        )}
        {tab === 'history' && (
          <div className="p-4">
            <SubmissionHistory activityUuid={activityUuid} blockId={blockId} accessToken={token || ''} onRestoreCode={(c) => setLearnerCode(c)} />
          </div>
        )}
      </div>
    </div>
  )

  return (
    <NodeViewWrapper className="block-code-playground">
      <EditorBlockFrame
        editable={isAuthor && !!editor}
        node={node}
        editor={editor}
        getPos={getPos}
        selected={props.selected}
        tone="code"
        label={<><BracketsCurly size={11} weight="bold" />{t('editor.toolbar.code_playground', 'Code playground')}</>}
        forceToolbar={settingsOpen}
        className="p-1"
      >
        <div ref={containerRef} className="@container relative overflow-hidden rounded-2xl bg-white nice-shadow">
          {confetti && (
            <ReactConfetti width={confetti.w} height={confetti.h} numberOfPieces={600} recycle={false} style={{ position: 'absolute', inset: 0, zIndex: 50, pointerEvents: 'none' }} />
          )}
          {/* The original split (60 / 40, 560px tall); stacked when the block is narrow. */}
          <div className="grid @3xl:h-[560px] @3xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            {editorArea}
            {panel}
          </div>
        </div>
      </EditorBlockFrame>
    </NodeViewWrapper>
  )
}

export default CodePlaygroundComponent
