'use client'
import { NodeViewWrapper } from '@tiptap/react'
import React, { useState, useCallback } from 'react'
import {
  Play,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  Terminal,
  Clock,
  MemoryStick,
  CircleDot,
  RotateCcw,
  Lightbulb,
  Code2,
  FlaskConical,
  FileText,
} from 'lucide-react'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl } from '@services/config/config'
import { PLAYGROUND_LANGUAGES, getLanguageById } from './languages'
import dynamic from 'next/dynamic'
import { v4 as uuidv4 } from 'uuid'
import { Resizable } from 're-resizable'

const CodeMirror = dynamic(() => import('@uiw/react-codemirror'), {
  ssr: false,
  loading: () => (
    <div className="h-[300px] bg-[#0d2137] animate-pulse" />
  ),
})

const cmStyles: React.CSSProperties = {
  fontSize: '14px',
  fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, monospace",
}
const cmClassName = [
  '[&_.cm-editor]:!bg-[#0d2137]',
  '[&_.cm-gutters]:!bg-[#0a1c30]',
  '[&_.cm-gutters]:!border-r-[#163a5c]',
  '[&_.cm-activeLineGutter]:!bg-[#122e4a]',
  '[&_.cm-activeLine]:!bg-[#122e4a]',
  '[&_.cm-editor]:!outline-none',
  '[&_.cm-focused]:!outline-none',
  '[&_.cm-scroller]:!overflow-auto',
  '[&_.cm-line]:!px-4',
].join(' ')

async function getTheme() {
  const { tokyoNight } = await import('@uiw/codemirror-theme-tokyo-night')
  return tokyoNight
}

async function getLanguageExtension(codemirrorLang: string) {
  switch (codemirrorLang) {
    case 'python': {
      const { python } = await import('@codemirror/lang-python')
      return python()
    }
    case 'javascript': {
      const { javascript } = await import('@codemirror/lang-javascript')
      return javascript()
    }
    case 'java': {
      const { java } = await import('@codemirror/lang-java')
      return java()
    }
    case 'cpp': {
      const { cpp } = await import('@codemirror/lang-cpp')
      return cpp()
    }
    case 'rust': {
      const { rust } = await import('@codemirror/lang-rust')
      return rust()
    }
    case 'go': {
      const { go } = await import('@codemirror/lang-go')
      return go()
    }
    case 'php': {
      const { php } = await import('@codemirror/lang-php')
      return php()
    }
    default: {
      const { javascript } = await import('@codemirror/lang-javascript')
      return javascript()
    }
  }
}

interface TestCase {
  id: string
  label: string
  stdin: string
  expectedStdout: string
}

interface TestResult {
  id: string
  label: string
  passed: boolean
  actual_stdout: string | null
  expected_stdout: string
  stderr: string | null
  compile_output: string | null
  status: { id: number; description: string } | null
  time: string | null
  memory: number | null
}

type RightTab = 'description' | 'tests' | 'output'
type Difficulty = 'easy' | 'medium' | 'hard'

const DIFFICULTY_CONFIG: Record<
  Difficulty,
  { bg: string; text: string; dot: string; label: string }
> = {
  easy: {
    bg: 'bg-emerald-50',
    text: 'text-emerald-600',
    dot: 'bg-emerald-400',
    label: 'Easy',
  },
  medium: {
    bg: 'bg-amber-50',
    text: 'text-amber-600',
    dot: 'bg-amber-400',
    label: 'Medium',
  },
  hard: {
    bg: 'bg-red-50',
    text: 'text-red-600',
    dot: 'bg-red-400',
    label: 'Hard',
  },
}

const CodePlaygroundComponent: React.FC = (props: any) => {
  const { node, updateAttributes } = props
  const editorState = useEditorProvider() as any
  const session = useLHSession() as any
  const isEditable = editorState?.isEditable ?? true
  const accessToken = session?.data?.tokens?.access_token

  const languageId: number = node.attrs.languageId
  const languageName: string = node.attrs.languageName
  const starterCode: string = node.attrs.starterCode
  const testCases: TestCase[] = node.attrs.testCases || []
  const description: string = node.attrs.description || ''
  const hints: string[] = node.attrs.hints || []
  const difficulty: Difficulty = node.attrs.difficulty || 'medium'

  const [code, setCode] = useState(starterCode)
  const [results, setResults] = useState<TestResult[] | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [extensions, setExtensions] = useState<any[]>([])
  const [showLangDropdown, setShowLangDropdown] = useState(false)
  const [activeTab, setActiveTab] = useState<RightTab>('description')
  const [expandedHints, setExpandedHints] = useState<Set<number>>(new Set())

  React.useEffect(() => {
    const lang = getLanguageById(languageId)
    if (lang) {
      Promise.all([getLanguageExtension(lang.codemirrorLang), getTheme()]).then(
        ([langExt, theme]) => setExtensions([langExt, theme])
      )
    }
  }, [languageId])

  React.useEffect(() => {
    if (!isEditable) {
      setCode(starterCode)
    }
  }, [starterCode, isEditable])

  const handleLanguageChange = useCallback(
    (langId: number) => {
      const lang = PLAYGROUND_LANGUAGES.find((l) => l.id === langId)
      if (!lang) return
      updateAttributes({
        languageId: lang.id,
        languageName: lang.name,
        starterCode: lang.defaultCode,
      })
      setCode(lang.defaultCode)
      setShowLangDropdown(false)
    },
    [updateAttributes]
  )

  const handleStarterCodeChange = useCallback(
    (value: string) => {
      setCode(value)
      if (isEditable) {
        updateAttributes({ starterCode: value })
      }
    },
    [isEditable, updateAttributes]
  )

  const addTestCase = useCallback(() => {
    const newTC: TestCase = {
      id: uuidv4(),
      label: `Test ${testCases.length + 1}`,
      stdin: '',
      expectedStdout: '',
    }
    updateAttributes({ testCases: [...testCases, newTC] })
  }, [testCases, updateAttributes])

  const removeTestCase = useCallback(
    (id: string) => {
      updateAttributes({ testCases: testCases.filter((tc) => tc.id !== id) })
    },
    [testCases, updateAttributes]
  )

  const updateTestCase = useCallback(
    (id: string, field: keyof TestCase, value: string) => {
      updateAttributes({
        testCases: testCases.map((tc) =>
          tc.id === id ? { ...tc, [field]: value } : tc
        ),
      })
    },
    [testCases, updateAttributes]
  )

  const addHint = useCallback(() => {
    updateAttributes({ hints: [...hints, ''] })
  }, [hints, updateAttributes])

  const removeHint = useCallback(
    (index: number) => {
      updateAttributes({ hints: hints.filter((_, i) => i !== index) })
    },
    [hints, updateAttributes]
  )

  const updateHint = useCallback(
    (index: number, value: string) => {
      updateAttributes({
        hints: hints.map((h, i) => (i === index ? value : h)),
      })
    },
    [hints, updateAttributes]
  )

  const toggleHint = useCallback((index: number) => {
    setExpandedHints((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }, [])

  const resetCode = useCallback(() => {
    setCode(starterCode)
    setResults(null)
  }, [starterCode])

  const runCode = useCallback(async () => {
    if (isRunning || !accessToken) return
    setIsRunning(true)
    setResults(null)

    try {
      if (testCases.length === 0) {
        const resp = await fetch(`${getAPIUrl()}code/execute`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            language_id: languageId,
            source_code: code,
            stdin: '',
          }),
        })
        const data = await resp.json()
        setResults([
          {
            id: 'single',
            label: 'Output',
            passed: data.status?.id === 3,
            actual_stdout: data.stdout,
            expected_stdout: '',
            stderr: data.stderr,
            compile_output: data.compile_output,
            status: data.status,
            time: data.time,
            memory: data.memory,
          },
        ])
        setActiveTab('output')
      } else {
        const resp = await fetch(`${getAPIUrl()}code/execute-batch`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            language_id: languageId,
            source_code: code,
            test_cases: testCases.map((tc) => ({
              id: tc.id,
              label: tc.label,
              stdin: tc.stdin,
              expected_stdout: tc.expectedStdout,
            })),
          }),
        })
        const data = await resp.json()
        setResults(data.results)
        setActiveTab('output')
      }
    } catch (err) {
      console.error('Code execution error:', err)
    } finally {
      setIsRunning(false)
    }
  }, [isRunning, accessToken, testCases, languageId, code])

  const passedCount = results?.filter((r) => r.passed).length ?? 0
  const totalCount = results?.length ?? 0
  const allPassed = results && totalCount > 0 && passedCount === totalCount

  const consoleStdout = results
    ?.map((r) => r.actual_stdout)
    .filter(Boolean)
    .join('\n')
  const consoleStderr = results
    ?.map((r) => r.stderr)
    .filter(Boolean)
    .join('\n')
  const consoleCompile = results
    ?.map((r) => r.compile_output)
    .filter(Boolean)
    .join('\n')
  const executionTime = results?.[0]?.time

  const diff = DIFFICULTY_CONFIG[difficulty]

  const tabs: { id: RightTab; label: string; icon: React.ReactNode; badge?: React.ReactNode }[] = [
    { id: 'description', label: 'Description', icon: <FileText size={13} /> },
    {
      id: 'tests',
      label: 'Test Cases',
      icon: <FlaskConical size={13} />,
      badge:
        results && testCases.length > 0 ? (
          <span
            className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none ${
              allPassed
                ? 'bg-emerald-100 text-emerald-600'
                : 'bg-red-100 text-red-600'
            }`}
          >
            {passedCount}/{totalCount}
          </span>
        ) : null,
    },
    {
      id: 'output',
      label: 'Output',
      icon: <Terminal size={13} />,
      badge: results ? (
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
      ) : null,
    },
  ]

  // ── Tab: Description ──────────────────────────────────────────
  const renderDescriptionTab = () => (
    <div className="p-5 space-y-5 overflow-y-auto h-full">
      {isEditable ? (
        <>
          <div>
            <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-2 block">
              Challenge Description
            </label>
            <textarea
              value={description}
              onChange={(e) =>
                updateAttributes({ description: e.target.value })
              }
              className="w-full text-[13px] text-neutral-700 bg-white border border-neutral-200 rounded-xl p-3.5 outline-none focus:border-neutral-300 focus:ring-2 focus:ring-neutral-100 resize-none transition-all leading-relaxed"
              rows={5}
              placeholder="Describe the coding challenge..."
            />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-2 block">
              Difficulty
            </label>
            <div className="flex gap-2">
              {(['easy', 'medium', 'hard'] as Difficulty[]).map((d) => {
                const c = DIFFICULTY_CONFIG[d]
                return (
                  <button
                    key={d}
                    onClick={() => updateAttributes({ difficulty: d })}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[12px] font-semibold transition-all border ${
                      difficulty === d
                        ? `${c.bg} ${c.text} border-current/20 nice-shadow`
                        : 'bg-white text-neutral-400 border-neutral-200 hover:bg-neutral-50'
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${difficulty === d ? c.dot : 'bg-neutral-300'}`}
                    />
                    {c.label}
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                Hints
              </label>
              <button
                onClick={addHint}
                className="flex items-center gap-1 text-[11px] font-medium text-neutral-500 hover:text-neutral-700 transition-colors"
              >
                <Plus size={11} /> Add
              </button>
            </div>
            <div className="space-y-2">
              {hints.map((hint, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    value={hint}
                    onChange={(e) => updateHint(i, e.target.value)}
                    className="flex-1 text-[12px] text-neutral-700 bg-white border border-neutral-200 rounded-xl px-3 py-2.5 outline-none focus:border-neutral-300 transition-colors"
                    placeholder={`Hint ${i + 1}...`}
                  />
                  <button
                    onClick={() => removeHint(i)}
                    className="p-2 hover:bg-red-50 rounded-xl transition-colors"
                  >
                    <Trash2 size={12} className="text-red-400" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
          {description ? (
            <div className="text-[13px] text-neutral-600 leading-relaxed whitespace-pre-wrap">
              {description}
            </div>
          ) : (
            <div className="text-[13px] text-neutral-400 italic text-center py-8">
              No description provided.
            </div>
          )}
          {hints.length > 0 && (
            <div className="space-y-2">
              <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
                <Lightbulb size={12} className="text-amber-400" /> Hints
              </span>
              {hints.map((hint, i) => (
                <button
                  key={i}
                  onClick={() => toggleHint(i)}
                  className="w-full text-left group"
                >
                  <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-amber-50/70 border border-amber-100/80 hover:bg-amber-50 transition-colors">
                    <Lightbulb
                      size={13}
                      className="text-amber-400 flex-shrink-0"
                    />
                    <span className="text-[12px] font-medium text-amber-700 flex-1">
                      Hint {i + 1}
                    </span>
                    <ChevronRight
                      size={12}
                      className={`text-amber-300 transition-transform ${expandedHints.has(i) ? 'rotate-90' : ''}`}
                    />
                  </div>
                  {expandedHints.has(i) && (
                    <div className="mt-2 ml-9 mr-3 text-[12px] text-neutral-600 leading-relaxed pb-1">
                      {hint}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )

  // ── Tab: Test Cases ───────────────────────────────────────────
  const renderTestsTab = () => (
    <div className="p-5 space-y-3 overflow-y-auto h-full">
      {isEditable && (
        <div className="flex justify-end mb-1">
          <button
            onClick={addTestCase}
            className="flex items-center gap-1 text-[11px] font-medium text-neutral-500 hover:text-neutral-700 transition-colors"
          >
            <Plus size={12} /> Add Test Case
          </button>
        </div>
      )}
      {testCases.length === 0 ? (
        <div className="text-[13px] text-neutral-400 text-center py-10">
          {isEditable
            ? 'Add test cases to validate solutions.'
            : 'No test cases available.'}
        </div>
      ) : (
        <div className="space-y-2.5">
          {testCases.map((tc) => {
            const r = results?.find((res) => res.id === tc.id)
            return (
              <div
                key={tc.id}
                className={`rounded-xl border overflow-hidden transition-colors ${
                  r
                    ? r.passed
                      ? 'border-emerald-200/80 bg-emerald-50/30'
                      : 'border-red-200/80 bg-red-50/30'
                    : 'border-neutral-200/80 bg-white'
                } nice-shadow`}
              >
                <div className="flex items-center gap-3 px-4 py-3">
                  {r ? (
                    r.passed ? (
                      <CheckCircle2
                        size={16}
                        className="text-emerald-500 flex-shrink-0"
                      />
                    ) : (
                      <XCircle
                        size={16}
                        className="text-red-500 flex-shrink-0"
                      />
                    )
                  ) : (
                    <CircleDot
                      size={16}
                      className="text-neutral-300 flex-shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    {isEditable ? (
                      <input
                        value={tc.label}
                        onChange={(e) =>
                          updateTestCase(tc.id, 'label', e.target.value)
                        }
                        className="text-[13px] font-semibold text-neutral-700 bg-transparent outline-none w-full"
                        placeholder="Test label"
                      />
                    ) : (
                      <span className="text-[13px] font-semibold text-neutral-700">
                        {tc.label}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {r?.time && (
                      <span className="text-[10px] text-neutral-400 font-mono">
                        {r.time}s
                      </span>
                    )}
                    {isEditable && (
                      <button
                        onClick={() => removeTestCase(tc.id)}
                        className="p-1 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 size={12} className="text-red-400" />
                      </button>
                    )}
                  </div>
                </div>
                {/* Input / Expected fields */}
                <div className="px-4 pb-3.5 space-y-2.5 border-t border-neutral-100/80">
                  <div className="pt-3">
                    <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1 block">
                      Input
                    </label>
                    {isEditable ? (
                      <textarea
                        value={tc.stdin}
                        onChange={(e) =>
                          updateTestCase(tc.id, 'stdin', e.target.value)
                        }
                        className="w-full text-[12px] font-mono text-neutral-700 bg-neutral-50/80 border border-neutral-200/60 rounded-lg p-2.5 outline-none focus:border-neutral-300 resize-none transition-colors"
                        rows={2}
                        placeholder="stdin..."
                      />
                    ) : (
                      <pre className="text-[12px] font-mono text-neutral-600 bg-neutral-50/80 rounded-lg p-2.5 whitespace-pre-wrap">
                        {tc.stdin || '(empty)'}
                      </pre>
                    )}
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1 block">
                      Expected Output
                    </label>
                    {isEditable ? (
                      <textarea
                        value={tc.expectedStdout}
                        onChange={(e) =>
                          updateTestCase(
                            tc.id,
                            'expectedStdout',
                            e.target.value
                          )
                        }
                        className="w-full text-[12px] font-mono text-neutral-700 bg-neutral-50/80 border border-neutral-200/60 rounded-lg p-2.5 outline-none focus:border-neutral-300 resize-none transition-colors"
                        rows={2}
                        placeholder="expected stdout..."
                      />
                    ) : (
                      <pre className="text-[12px] font-mono text-neutral-600 bg-neutral-50/80 rounded-lg p-2.5 whitespace-pre-wrap">
                        {tc.expectedStdout || '(empty)'}
                      </pre>
                    )}
                  </div>
                  {r && !r.passed && r.actual_stdout != null && (
                    <div>
                      <label className="text-[10px] font-semibold text-red-400 uppercase tracking-wider mb-1 block">
                        Your Output
                      </label>
                      <pre className="text-[12px] font-mono text-red-600 bg-red-50/80 border border-red-100 rounded-lg p-2.5 whitespace-pre-wrap">
                        {r.actual_stdout || '(no output)'}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )

  // ── Tab: Output ───────────────────────────────────────────────
  const renderOutputTab = () => (
    <div className="p-5 space-y-4 overflow-y-auto h-full">
      {!results ? (
        <div className="flex flex-col items-center justify-center py-14 text-neutral-300">
          <Terminal size={28} className="mb-3" strokeWidth={1.5} />
          <span className="text-[13px] text-neutral-400">
            Run your code to see output
          </span>
        </div>
      ) : (
        <>
          {/* Terminal output */}
          <div
            className="bg-[#1e1e2e] rounded-xl overflow-hidden nice-shadow"
          >
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/5">
              <div className="flex gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
              </div>
              <span className="text-[10px] font-mono text-neutral-500 ml-2">
                output
              </span>
            </div>
            <div className="p-4">
              <div className="flex items-center gap-2 mb-2 opacity-60">
                <span className="text-[11px] font-mono text-neutral-500">
                  $
                </span>
                <span className="text-[11px] font-mono text-neutral-400">
                  {languageName.toLowerCase().replace(/\s+/g, '')} solution
                </span>
              </div>
              {consoleStdout && (
                <pre className="text-[13px] font-mono text-white/90 whitespace-pre-wrap leading-relaxed">
                  {consoleStdout}
                </pre>
              )}
              {consoleStderr && (
                <pre className="text-[12px] font-mono text-red-400 whitespace-pre-wrap mt-2">
                  {consoleStderr}
                </pre>
              )}
              {consoleCompile && (
                <pre className="text-[12px] font-mono text-amber-400 whitespace-pre-wrap mt-2">
                  {consoleCompile}
                </pre>
              )}
              {!consoleStdout && !consoleStderr && !consoleCompile && (
                <pre className="text-[12px] font-mono text-neutral-500 italic">
                  (no output)
                </pre>
              )}
              {executionTime && (
                <div className="flex items-center gap-1.5 mt-3 pt-2.5 border-t border-white/5">
                  <Clock size={11} className="text-neutral-500" />
                  <span className="text-[11px] font-mono text-neutral-500">
                    Executed in{' '}
                    {(parseFloat(executionTime) * 1000).toFixed(0)}ms
                  </span>
                </div>
              )}
              {allPassed && (
                <div className="flex items-center gap-1.5 mt-2">
                  <CheckCircle2 size={12} className="text-emerald-400" />
                  <span className="text-[11px] font-semibold text-emerald-400">
                    All tests passed
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Auto-graded score card */}
          {testCases.length > 0 && !isEditable && (
            <div
              className="bg-white rounded-xl p-4 nice-shadow"
            >
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-[12px] font-semibold text-neutral-400 uppercase tracking-wider">
                  Auto-Graded
                </span>
                <span className="text-[16px] font-bold text-neutral-800">
                  {Math.round((passedCount / totalCount) * 100)}%
                </span>
              </div>
              <div className="w-full h-2 bg-neutral-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${allPassed ? 'bg-emerald-400' : 'bg-amber-400'}`}
                  style={{
                    width: `${(passedCount / totalCount) * 100}%`,
                  }}
                />
              </div>
              <div className="flex items-center gap-1.5 mt-2.5">
                <CheckCircle2
                  size={12}
                  className={
                    allPassed ? 'text-emerald-500' : 'text-amber-500'
                  }
                />
                <span
                  className={`text-[11px] font-medium ${allPassed ? 'text-emerald-600' : 'text-amber-600'}`}
                >
                  {allPassed
                    ? 'All test cases passed'
                    : `${passedCount} of ${totalCount} test cases passed`}
                </span>
              </div>
            </div>
          )}

          {/* Per-result details */}
          {results.map((r) => (
            <div
              key={r.id}
              className={`rounded-xl overflow-hidden nice-shadow ${
                r.passed
                  ? 'bg-emerald-50/20'
                  : 'bg-red-50/20'
              }`}
            >
              <div className="flex items-center gap-2 px-4 py-2.5">
                {r.passed ? (
                  <CheckCircle2
                    size={14}
                    className="text-emerald-500 flex-shrink-0"
                  />
                ) : (
                  <XCircle
                    size={14}
                    className="text-red-500 flex-shrink-0"
                  />
                )}
                <span className="text-[12px] font-semibold text-neutral-700">
                  {r.label}
                </span>
                <span
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                    r.passed
                      ? 'bg-emerald-100 text-emerald-600'
                      : 'bg-red-100 text-red-600'
                  }`}
                >
                  {r.status?.description ||
                    (r.passed ? 'Accepted' : 'Failed')}
                </span>
                <div className="ml-auto flex items-center gap-3">
                  {r.time && (
                    <span className="flex items-center gap-1 text-[10px] text-neutral-400 font-mono">
                      <Clock size={9} /> {r.time}s
                    </span>
                  )}
                  {r.memory && (
                    <span className="flex items-center gap-1 text-[10px] text-neutral-400 font-mono">
                      <MemoryStick size={9} />{' '}
                      {Math.round(r.memory)}KB
                    </span>
                  )}
                </div>
              </div>
              {r.actual_stdout != null && (
                <div className="px-4 pb-3">
                  <label className="text-[9px] font-semibold text-neutral-400 uppercase tracking-wider mb-0.5 block">
                    Output
                  </label>
                  <pre className="text-[11px] font-mono text-neutral-700 bg-white/80 border border-neutral-200/60 rounded-lg p-2.5 overflow-x-auto whitespace-pre-wrap">
                    {r.actual_stdout || '(no output)'}
                  </pre>
                </div>
              )}
              {!r.passed && r.expected_stdout && (
                <div className="px-4 pb-3">
                  <label className="text-[9px] font-semibold text-neutral-400 uppercase tracking-wider mb-0.5 block">
                    Expected
                  </label>
                  <pre className="text-[11px] font-mono text-emerald-700 bg-emerald-50/50 border border-emerald-200/60 rounded-lg p-2.5 overflow-x-auto whitespace-pre-wrap">
                    {r.expected_stdout}
                  </pre>
                </div>
              )}
              {r.stderr && (
                <div className="px-4 pb-3">
                  <pre className="text-[11px] font-mono text-red-600 bg-red-50/50 border border-red-200/60 rounded-lg p-2.5 overflow-x-auto whitespace-pre-wrap">
                    {r.stderr}
                  </pre>
                </div>
              )}
              {r.compile_output && (
                <div className="px-4 pb-3">
                  <pre className="text-[11px] font-mono text-amber-700 bg-amber-50/50 border border-amber-200/60 rounded-lg p-2.5 overflow-x-auto whitespace-pre-wrap">
                    {r.compile_output}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  )

  return (
    <NodeViewWrapper className="block-code-playground">
      <div
        className="rounded-2xl overflow-hidden nice-shadow"
      >
        {/* ── Header ─────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-3 bg-[#091b2e] border-b border-[#163a5c]/60">
          <div className="flex items-center gap-3">
            <Code2 size={16} className="text-teal-400" />
            <span className="text-[13px] font-semibold text-white/90 tracking-tight">
              Code Playground
            </span>
            <span
              className={`inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-full ${diff.bg} ${diff.text}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${diff.dot}`} />
              {diff.label}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {isEditable ? (
              <div className="relative">
                <button
                  onClick={() => setShowLangDropdown(!showLangDropdown)}
                  className="flex items-center gap-1.5 bg-[#122e4a] hover:bg-[#163a5c] text-white/80 font-medium py-1.5 px-3 rounded-lg text-[12px] transition-colors outline-none border border-[#1e4a6e]/50"
                >
                  {languageName}
                  <ChevronDown size={11} className="text-white/40" />
                </button>
                {showLangDropdown && (
                  <div
                    className="absolute right-0 top-full mt-1.5 bg-[#0d2137] rounded-xl py-1 z-50 max-h-60 overflow-y-auto w-44 border border-[#1e4a6e]/60 nice-shadow"
                  >
                    {PLAYGROUND_LANGUAGES.map((lang) => (
                      <button
                        key={lang.id}
                        onClick={() => handleLanguageChange(lang.id)}
                        className={`w-full text-left px-3.5 py-2 text-[12px] transition-colors ${
                          lang.id === languageId
                            ? 'bg-teal-500/15 text-teal-300 font-semibold'
                            : 'text-white/70 hover:bg-[#122e4a]'
                        }`}
                      >
                        {lang.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <span className="text-[12px] font-medium text-white/60 bg-[#122e4a] px-3 py-1.5 rounded-lg border border-[#1e4a6e]/50">
                {languageName}
              </span>
            )}
            {!isEditable && (
              <button
                onClick={resetCode}
                className="flex items-center bg-[#122e4a] hover:bg-[#163a5c] text-white/50 py-1.5 px-2 rounded-lg text-[12px] transition-colors outline-none border border-[#1e4a6e]/50"
                title="Reset code"
              >
                <RotateCcw size={13} />
              </button>
            )}
          </div>
        </div>

        {/* ── Split Layout ───────────────────────────────────── */}
        <div className="flex" style={{ height: 560 }}>
          {/* ── Left: Code + Run ─────────────────────────────── */}
          <div className="flex-1 flex flex-col min-w-0 bg-[#0d2137]">
            <div className={`flex-1 overflow-hidden ${cmClassName}`}>
              {extensions.length > 0 && (
                <CodeMirror
                  value={code}
                  onChange={
                    isEditable
                      ? handleStarterCodeChange
                      : (val: string) => setCode(val)
                  }
                  extensions={extensions}
                  height="100%"
                  style={{ ...cmStyles, height: '100%' }}
                  basicSetup={{
                    lineNumbers: true,
                    foldGutter: false,
                    highlightActiveLine: true,
                  }}
                />
              )}
            </div>
            <div className="flex items-center gap-3 px-5 py-3 bg-[#091b2e] border-t border-[#163a5c]/60">
              <button
                onClick={runCode}
                disabled={isRunning || !accessToken}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold transition-all ${
                  isRunning
                    ? 'bg-[#122e4a] text-white/30 cursor-not-allowed'
                    : allPassed
                      ? 'bg-emerald-500 hover:bg-emerald-600 text-white nice-shadow'
                      : 'bg-teal-500 hover:bg-teal-600 text-white nice-shadow'
                }`}
              >
                {isRunning ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Play size={14} />
                )}
                {isEditable ? 'Test Run' : 'Run Code'}
              </button>
              {allPassed && !isEditable && (
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 size={14} className="text-emerald-400" />
                  <span className="text-[12px] font-semibold text-emerald-400">
                    All tests passed
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* ── Right: Tabbed Panel ──────────────────────────── */}
          <Resizable
            defaultSize={{ width: 380, height: '100%' }}
            minWidth={280}
            maxWidth={600}
            enable={{ left: true }}
            handleStyles={{
              left: {
                width: 8,
                left: -4,
                cursor: 'col-resize',
              },
            }}
            className="border-l border-neutral-200/60 bg-neutral-50/20 relative"
            style={{ display: 'flex', flexDirection: 'column' }}
          >
            {/* Tab bar */}
            <div className="flex items-center border-b border-neutral-200/60 bg-white px-1 shrink-0">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 px-3.5 py-3 text-[12px] font-semibold transition-all relative ${
                    activeTab === tab.id
                      ? 'text-neutral-800'
                      : 'text-neutral-400 hover:text-neutral-600'
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                  {tab.badge && <span className="ml-1">{tab.badge}</span>}
                  {activeTab === tab.id && (
                    <div className="absolute bottom-0 left-3 right-3 h-[2px] bg-neutral-800 rounded-full" />
                  )}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-hidden">
              {activeTab === 'description' && renderDescriptionTab()}
              {activeTab === 'tests' && renderTestsTab()}
              {activeTab === 'output' && renderOutputTab()}
            </div>
          </Resizable>
        </div>
      </div>
    </NodeViewWrapper>
  )
}

export default CodePlaygroundComponent
