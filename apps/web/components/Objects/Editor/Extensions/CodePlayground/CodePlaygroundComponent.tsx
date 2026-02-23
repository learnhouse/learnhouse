'use client'
import { NodeViewWrapper } from '@tiptap/react'
import React, { useState, useCallback, useEffect, useRef } from 'react'
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
  Copy,
  ClipboardCheck,
  Lock,
  Eye,
  Settings2,
} from 'lucide-react'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl } from '@services/config/config'
import { PLAYGROUND_LANGUAGES, getLanguageById } from './languages'
import dynamic from 'next/dynamic'
import { v4 as uuidv4 } from 'uuid'
import { Resizable } from 're-resizable'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

const CodeMirror = dynamic(() => import('@uiw/react-codemirror'), {
  ssr: false,
  loading: () => (
    <div className="h-[300px] bg-neutral-900 animate-pulse" />
  ),
})

const ReactConfetti = dynamic(() => import('react-confetti'), { ssr: false })

const cmStyles: React.CSSProperties = {
  fontSize: '14px',
  fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, monospace",
}
const cmClassName = [
  '[&_.cm-editor]:!bg-[#1a1b26]',
  '[&_.cm-gutters]:!bg-[#1a1b26]',
  '[&_.cm-gutters]:!border-r-transparent',
  '[&_.cm-activeLineGutter]:!bg-[#24283b]',
  '[&_.cm-activeLine]:!bg-[#24283b]',
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

// ── Locked Regions (Feature 6) ────────────────────────────────────
function parseLockedRegions(code: string): Set<number> {
  const lines = code.split('\n')
  const locked = new Set<number>()
  let inLocked = false
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '// --- locked ---') {
      inLocked = !inLocked
      locked.add(i)
      continue
    }
    if (inLocked) locked.add(i)
  }
  return locked
}

async function getLockedRegionExtensions(code: string): Promise<any[]> {
  const cmView = await import('@codemirror/view')
  const cmState = await import('@codemirror/state')

  const lockedLines = parseLockedRegions(code)

  class LockGutterMarker extends cmView.GutterMarker {
    toDOM() {
      const el = document.createElement('span')
      el.textContent = '\u{1F512}'
      el.style.fontSize = '10px'
      el.style.opacity = '0.6'
      return el
    }
  }
  const lockMarker = new LockGutterMarker()

  const lockedField = cmState.StateField.define<Set<number>>({
    create() { return lockedLines },
    update(value: Set<number>) { return value },
  })

  const lockedDecorations = cmView.EditorView.decorations.compute([lockedField], (state: any) => {
    const locked: Set<number> = state.field(lockedField)
    const builder = new (cmState.RangeSetBuilder as any)()
    const lineDeco = cmView.Decoration.line({ class: 'cm-locked-line' })
    for (let i = 1; i <= state.doc.lines; i++) {
      if (locked.has(i - 1)) {
        const line = state.doc.line(i)
        builder.add(line.from, line.from, lineDeco)
      }
    }
    return builder.finish()
  })

  const lockedGutter = cmView.gutter({
    class: 'cm-locked-gutter',
    lineMarker(view: any, line: any) {
      const lineNo = view.state.doc.lineAt(line.from).number - 1
      const locked: Set<number> = view.state.field(lockedField)
      return locked.has(lineNo) ? lockMarker : null
    },
  })

  const changeFilter = cmState.EditorState.changeFilter.of((tr: any) => {
    if (!tr.docChanged) return true
    const locked: Set<number> = tr.startState.field(lockedField)
    const doc = tr.startState.doc
    let allow = true
    tr.changes.iterChangedRanges((fromA: number, toA: number) => {
      const startLine = doc.lineAt(fromA).number - 1
      const endLine = doc.lineAt(Math.min(toA, doc.length)).number - 1
      for (let i = startLine; i <= endLine; i++) {
        if (locked.has(i)) { allow = false; break }
      }
    })
    return allow
  })

  const lockedTheme = cmView.EditorView.theme({
    '.cm-locked-line': {
      backgroundColor: 'rgba(18, 46, 74, 0.4)',
    },
  })

  return [lockedField, lockedDecorations, lockedGutter, changeFilter, lockedTheme]
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
  { bg: string; text: string; dot: string; darkBg: string; darkText: string; label: string }
> = {
  easy: {
    bg: 'bg-emerald-50',
    text: 'text-emerald-600',
    dot: 'bg-emerald-400',
    darkBg: 'bg-emerald-500/15',
    darkText: 'text-emerald-400',
    label: 'Easy',
  },
  medium: {
    bg: 'bg-amber-50',
    text: 'text-amber-600',
    dot: 'bg-amber-400',
    darkBg: 'bg-amber-500/15',
    darkText: 'text-amber-400',
    label: 'Medium',
  },
  hard: {
    bg: 'bg-red-50',
    text: 'text-red-600',
    dot: 'bg-red-400',
    darkBg: 'bg-red-500/15',
    darkText: 'text-red-400',
    label: 'Hard',
  },
}

const COMPLEXITY_OPTIONS = [
  { value: '', label: 'Not set' },
  { value: 'O(1)', label: 'Minimal' },
  { value: 'O(log n)', label: 'Very efficient' },
  { value: 'O(n)', label: 'Efficient' },
  { value: 'O(n log n)', label: 'Moderate' },
  { value: 'O(n²)', label: 'Intensive' },
  { value: 'O(2ⁿ)', label: 'Very intensive' },
]

function getComplexityLabel(value: string): string {
  const opt = COMPLEXITY_OPTIONS.find((o) => o.value === value)
  return opt?.label || value
}

// ── Clipboard copy hook ───────────────────────────────────────────
function useCopyToClipboard() {
  const [copied, setCopied] = useState(false)
  const copy = useCallback((text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [])
  return { copied, copy }
}

// ── Markdown component overrides (light theme for right panel) ───
const markdownComponents = {
  h1: ({ children }: any) => (
    <h1 className="text-lg font-bold text-neutral-800 mt-4 mb-2 first:mt-0">{children}</h1>
  ),
  h2: ({ children }: any) => (
    <h2 className="text-base font-bold text-neutral-800 mt-3 mb-2 first:mt-0">{children}</h2>
  ),
  h3: ({ children }: any) => (
    <h3 className="text-sm font-bold text-neutral-800 mt-2 mb-1 first:mt-0">{children}</h3>
  ),
  p: ({ children }: any) => (
    <p className="text-neutral-600 text-[13px] leading-relaxed mb-2 last:mb-0">{children}</p>
  ),
  strong: ({ children }: any) => (
    <strong className="font-semibold text-neutral-800">{children}</strong>
  ),
  em: ({ children }: any) => (
    <em className="italic text-neutral-600">{children}</em>
  ),
  ul: ({ children }: any) => (
    <ul className="list-disc list-inside text-neutral-600 text-[13px] mb-2 space-y-1 ml-2">{children}</ul>
  ),
  ol: ({ children }: any) => (
    <ol className="list-decimal list-inside text-neutral-600 text-[13px] mb-2 space-y-1 ml-2">{children}</ol>
  ),
  li: ({ children }: any) => (
    <li className="text-neutral-600">{children}</li>
  ),
  code: ({ className, children, ...props }: any) => {
    const isInline = !className
    if (isInline) {
      return (
        <code className="bg-neutral-100 text-rose-600 px-1.5 py-0.5 rounded text-xs font-mono" {...props}>
          {children}
        </code>
      )
    }
    return (
      <code className={`${className} block bg-neutral-50 rounded-lg p-3 text-xs font-mono overflow-x-auto my-2 border border-neutral-200/60`} {...props}>
        {children}
      </code>
    )
  },
  pre: ({ children }: any) => (
    <pre className="bg-neutral-50 rounded-lg overflow-x-auto my-2 border border-neutral-200/60">{children}</pre>
  ),
  blockquote: ({ children }: any) => (
    <blockquote className="border-l-2 border-neutral-300 pl-3 my-2 text-neutral-500 italic">{children}</blockquote>
  ),
  a: ({ href, children }: any) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-teal-600 hover:text-teal-500 underline">
      {children}
    </a>
  ),
  hr: () => <hr className="border-neutral-200 my-3" />,
  table: ({ children }: any) => (
    <div className="overflow-x-auto my-2">
      <table className="min-w-full text-xs border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }: any) => <thead className="bg-neutral-50">{children}</thead>,
  th: ({ children }: any) => (
    <th className="border border-neutral-200 px-2 py-1 text-left text-neutral-700 font-semibold">{children}</th>
  ),
  td: ({ children }: any) => (
    <td className="border border-neutral-200 px-2 py-1 text-neutral-600">{children}</td>
  ),
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
  const solutionCode: string = node.attrs.solutionCode || ''
  const maxAttemptsBeforeReveal: number = node.attrs.maxAttemptsBeforeReveal ?? 3
  const timeComplexity: string = node.attrs.timeComplexity || ''
  const spaceComplexity: string = node.attrs.spaceComplexity || ''
  const timeLimitMs: number = node.attrs.timeLimitMs ?? 10000

  const [code, setCode] = useState(starterCode)
  const [results, setResults] = useState<TestResult[] | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [extensions, setExtensions] = useState<any[]>([])
  const [showLangDropdown, setShowLangDropdown] = useState(false)
  const [activeTab, setActiveTab] = useState<RightTab>('description')
  const [expandedHints, setExpandedHints] = useState<Set<number>>(new Set())

  // Feature 3: Solution Reveal
  const [attemptCount, setAttemptCount] = useState(0)
  const [showSolution, setShowSolution] = useState(false)
  const [solutionExtensions, setSolutionExtensions] = useState<any[]>([])

  // Editor: Advanced settings toggle
  const [showAdvanced, setShowAdvanced] = useState(false)

  // Feature 10: Execution timer
  const [elapsedMs, setElapsedMs] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Feature 14: Confetti
  const [showConfetti, setShowConfetti] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })

  // Feature 17: Copy output
  const outputCopy = useCopyToClipboard()

  // Load CodeMirror extensions
  useEffect(() => {
    const lang = getLanguageById(languageId)
    if (lang) {
      const loadExtensions = async () => {
        const [langExt, theme] = await Promise.all([
          getLanguageExtension(lang.codemirrorLang),
          getTheme(),
        ])
        const exts: any[] = [langExt, theme]

        // Feature 7: Autocomplete
        try {
          const { autocompletion } = await import('@codemirror/autocomplete')
          exts.push(autocompletion())
        } catch {
          // Package not installed yet — skip
        }

        // Feature 6: Locked regions (viewer mode only)
        if (!isEditable && starterCode) {
          const lockedLines = parseLockedRegions(starterCode)
          if (lockedLines.size > 0) {
            const lockedExts = await getLockedRegionExtensions(starterCode)
            exts.push(...lockedExts)
          }
        }

        setExtensions(exts)
      }
      loadExtensions()
    }
  }, [languageId, isEditable, starterCode])

  // Load solution CodeMirror extensions
  useEffect(() => {
    if (showSolution && solutionCode) {
      const lang = getLanguageById(languageId)
      if (lang) {
        Promise.all([getLanguageExtension(lang.codemirrorLang), getTheme()]).then(
          ([langExt, theme]) => setSolutionExtensions([langExt, theme])
        )
      }
    }
  }, [showSolution, solutionCode, languageId])

  useEffect(() => {
    if (!isEditable) {
      setCode(starterCode)
    }
  }, [starterCode, isEditable])

  // Feature 10: Timer effect
  useEffect(() => {
    if (isRunning) {
      setElapsedMs(0)
      timerRef.current = setInterval(() => {
        setElapsedMs((prev) => prev + 100)
      }, 100)
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [isRunning])

  // Feature 14: Confetti size tracking
  useEffect(() => {
    if (containerRef.current) {
      const { offsetWidth, offsetHeight } = containerRef.current
      setContainerSize({ width: offsetWidth, height: offsetHeight })
    }
  }, [results])

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

    // Feature 3: Increment attempt count when running with test cases
    if (testCases.length > 0 && !isEditable) {
      setAttemptCount((prev) => prev + 1)
    }

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
        const newResults: TestResult[] = [
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
        ]
        setResults(newResults)
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
  }, [isRunning, accessToken, testCases, languageId, code, isEditable])

  const passedCount = results?.filter((r) => r.passed).length ?? 0
  const totalCount = results?.length ?? 0
  const allPassed = results && totalCount > 0 && passedCount === totalCount

  // Feature 14: Trigger confetti when all tests pass (learner mode)
  useEffect(() => {
    if (allPassed && !isEditable) {
      setShowConfetti(true)
      if (containerRef.current) {
        setContainerSize({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight,
        })
      }
      const timer = setTimeout(() => setShowConfetti(false), 4000)
      return () => clearTimeout(timer)
    }
  }, [allPassed, isEditable])

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

  // Feature 3: Can reveal solution?
  const canRevealSolution =
    solutionCode &&
    !isEditable &&
    attemptCount >= maxAttemptsBeforeReveal

  // Feature 10: Timer state
  const timerProgress = Math.min((elapsedMs / timeLimitMs) * 100, 100)
  const isTimeLimitExceeded = results?.some((r) => r.status?.id === 5) // Judge0 TLE status
  const timerBarColor = !isRunning && results
    ? isTimeLimitExceeded
      ? 'bg-red-500'
      : 'bg-neutral-800'
    : 'bg-neutral-500'

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
        <span className="w-2 h-2 rounded-full bg-neutral-400 animate-pulse" />
      ) : null,
    },
  ]

  // ── Copy button helper ──────────────────────────────────────────
  const CopyButton: React.FC<{ text: string; className?: string }> = ({ text, className = '' }) => {
    const { copied, copy } = useCopyToClipboard()
    return (
      <button
        onClick={() => copy(text)}
        className={`p-1 rounded-md transition-colors ${copied ? 'text-emerald-400' : 'text-neutral-500 hover:text-neutral-300'} ${className}`}
        title="Copy to clipboard"
      >
        {copied ? <ClipboardCheck size={12} /> : <Copy size={12} />}
      </button>
    )
  }

  // ── Tab: Description ──────────────────────────────────────────
  const renderDescriptionTab = () => (
    <div className="p-5 space-y-4 overflow-y-auto h-full">
      {isEditable ? (
        <>
          <div>
            <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-1.5 block">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => updateAttributes({ description: e.target.value })}
              className="w-full text-[13px] text-neutral-700 bg-neutral-50 border border-neutral-200 rounded-lg p-3 outline-none focus:border-neutral-300 resize-none transition-all leading-relaxed font-mono nice-shadow"
              rows={5}
              placeholder="Describe the challenge... (supports Markdown)"
            />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-1.5 block">
              Difficulty
            </label>
            <div className="flex gap-2">
              {(['easy', 'medium', 'hard'] as Difficulty[]).map((d) => {
                const c = DIFFICULTY_CONFIG[d]
                return (
                  <button
                    key={d}
                    onClick={() => updateAttributes({ difficulty: d })}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all border ${
                      difficulty === d
                        ? `${c.bg} ${c.text} border-current/20 nice-shadow`
                        : 'bg-neutral-50 text-neutral-400 border-neutral-200 hover:bg-neutral-100'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${difficulty === d ? c.dot : 'bg-neutral-300'}`} />
                    {c.label}
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">Hints</label>
              <button onClick={addHint} className="flex items-center gap-1 text-[11px] font-medium text-neutral-400 hover:text-neutral-600 transition-colors">
                <Plus size={11} /> Add
              </button>
            </div>
            {hints.map((hint, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <input
                  value={hint}
                  onChange={(e) => updateHint(i, e.target.value)}
                  className="flex-1 text-[12px] text-neutral-700 bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 outline-none focus:border-neutral-300 transition-colors nice-shadow"
                  placeholder={`Hint ${i + 1}...`}
                />
                <button onClick={() => removeHint(i)} className="p-1.5 hover:bg-red-50 rounded-lg transition-colors">
                  <Trash2 size={12} className="text-red-400" />
                </button>
              </div>
            ))}
          </div>

          {/* Advanced */}
          <div className="border-t border-neutral-100 pt-3">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 text-[11px] font-semibold text-neutral-400 uppercase tracking-wider hover:text-neutral-600 transition-colors w-full"
            >
              <Settings2 size={12} />
              Advanced
              <ChevronRight size={12} className={`ml-auto transition-transform ${showAdvanced ? 'rotate-90' : ''}`} />
            </button>
            {showAdvanced && (
              <div className="mt-3 space-y-3">
                <div>
                  <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-1 block">Solution Code</label>
                  <p className="text-[11px] text-neutral-400 mb-1.5">Revealed to learners after enough attempts.</p>
                  <textarea
                    value={solutionCode}
                    onChange={(e) => updateAttributes({ solutionCode: e.target.value })}
                    className="w-full text-[12px] text-neutral-700 bg-neutral-50 border border-neutral-200 rounded-lg p-3 outline-none focus:border-neutral-300 resize-none transition-all font-mono nice-shadow"
                    rows={4}
                    placeholder="Paste model solution..."
                  />
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-1 block">Attempts to unlock</label>
                    <input type="number" min={1} value={maxAttemptsBeforeReveal} onChange={(e) => updateAttributes({ maxAttemptsBeforeReveal: parseInt(e.target.value) || 3 })} className="w-full text-[12px] text-neutral-700 bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 outline-none focus:border-neutral-300 transition-colors nice-shadow" />
                  </div>
                  <div className="flex-1">
                    <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-1 block">Time Limit</label>
                    <div className="relative">
                      <input type="number" min={1000} step={1000} value={timeLimitMs} onChange={(e) => updateAttributes({ timeLimitMs: parseInt(e.target.value) || 10000 })} className="w-full text-[12px] text-neutral-700 bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 pr-10 outline-none focus:border-neutral-300 transition-colors nice-shadow" />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-neutral-400">ms</span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-1 block">Expected Speed</label>
                    <select value={timeComplexity} onChange={(e) => updateAttributes({ timeComplexity: e.target.value })} className="w-full text-[12px] text-neutral-700 bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 outline-none focus:border-neutral-300 transition-colors appearance-none cursor-pointer nice-shadow">
                      {COMPLEXITY_OPTIONS.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-1 block">Expected Memory</label>
                    <select value={spaceComplexity} onChange={(e) => updateAttributes({ spaceComplexity: e.target.value })} className="w-full text-[12px] text-neutral-700 bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 outline-none focus:border-neutral-300 transition-colors appearance-none cursor-pointer nice-shadow">
                      {COMPLEXITY_OPTIONS.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          {description ? (
            <div className="prose-playground">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={markdownComponents}>
                {description}
              </ReactMarkdown>
            </div>
          ) : (
            <div className="text-[13px] text-neutral-400 italic text-center py-8">No description provided.</div>
          )}

          {(timeComplexity || spaceComplexity) && (
            <div className="flex flex-wrap items-center gap-2">
              {timeComplexity && (
                <span className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-lg text-neutral-500 border border-neutral-100 nice-shadow">
                  <Clock size={10} className="text-neutral-400" />
                  Speed: {getComplexityLabel(timeComplexity)}
                </span>
              )}
              {spaceComplexity && (
                <span className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-lg text-neutral-500 border border-neutral-100 nice-shadow">
                  <MemoryStick size={10} className="text-neutral-400" />
                  Memory: {getComplexityLabel(spaceComplexity)}
                </span>
              )}
            </div>
          )}

          {solutionCode && (
            <div className="space-y-2">
              {canRevealSolution ? (
                <button
                  onClick={() => setShowSolution(!showSolution)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] font-semibold text-neutral-700 bg-neutral-50 border border-neutral-200 hover:bg-neutral-100 transition-colors nice-shadow"
                >
                  <Eye size={13} />
                  {showSolution ? 'Hide Solution' : 'View Solution'}
                </button>
              ) : (
                <div className="flex items-center gap-2 text-[11px] text-neutral-400">
                  <Lock size={11} />
                  <span>Solution available after {maxAttemptsBeforeReveal - attemptCount} more {maxAttemptsBeforeReveal - attemptCount === 1 ? 'attempt' : 'attempts'}</span>
                </div>
              )}
              {showSolution && canRevealSolution && (
                <div className={`rounded-lg overflow-hidden border border-neutral-200 nice-shadow ${cmClassName}`}>
                  {solutionExtensions.length > 0 && (
                    <CodeMirror value={solutionCode} extensions={solutionExtensions} editable={false} height="auto" maxHeight="300px" style={cmStyles} basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: false }} />
                  )}
                </div>
              )}
            </div>
          )}

          {hints.length > 0 && (
            <div className="space-y-2">
              <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
                <Lightbulb size={12} className="text-amber-400" /> Hints
              </span>
              {hints.map((hint, i) => (
                <button key={i} onClick={() => toggleHint(i)} className="w-full text-left">
                  <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-amber-50/60 border border-amber-100 hover:bg-amber-50 transition-colors nice-shadow">
                    <Lightbulb size={12} className="text-amber-400 flex-shrink-0" />
                    <span className="text-[12px] font-medium text-amber-700 flex-1">Hint {i + 1}</span>
                    <ChevronRight size={12} className={`text-amber-300 transition-transform ${expandedHints.has(i) ? 'rotate-90' : ''}`} />
                  </div>
                  {expandedHints.has(i) && (
                    <div className="mt-1.5 ml-8 mr-3 text-[12px] text-neutral-600 leading-relaxed pb-1">{hint}</div>
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
          <button onClick={addTestCase} className="flex items-center gap-1 text-[11px] font-medium text-neutral-400 hover:text-neutral-600 transition-colors">
            <Plus size={12} /> Add Test Case
          </button>
        </div>
      )}
      {testCases.length === 0 ? (
        <div className="text-[13px] text-neutral-400 text-center py-10">
          {isEditable ? 'Add test cases to validate solutions.' : 'No test cases available.'}
        </div>
      ) : (
        <div className="space-y-2.5">
          {testCases.map((tc) => {
            const r = results?.find((res) => res.id === tc.id)
            return (
              <div
                key={tc.id}
                className={`rounded-lg border overflow-hidden transition-colors nice-shadow ${
                  r ? (r.passed ? 'border-emerald-200 bg-emerald-50/30' : 'border-red-200 bg-red-50/30') : 'border-neutral-200 bg-white'
                }`}
              >
                <div className="flex items-center gap-3 px-3.5 py-2.5">
                  {r ? (
                    r.passed ? <CheckCircle2 size={15} className="text-emerald-500 flex-shrink-0" /> : <XCircle size={15} className="text-red-500 flex-shrink-0" />
                  ) : (
                    <CircleDot size={15} className="text-neutral-300 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    {isEditable ? (
                      <input value={tc.label} onChange={(e) => updateTestCase(tc.id, 'label', e.target.value)} className="text-[13px] font-semibold text-neutral-700 bg-transparent outline-none w-full" placeholder="Test label" />
                    ) : (
                      <span className="text-[13px] font-semibold text-neutral-700">{tc.label}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {r?.time && <span className="text-[10px] text-neutral-400 font-mono">{r.time}s</span>}
                    {isEditable && (
                      <button onClick={() => removeTestCase(tc.id)} className="p-1 hover:bg-red-50 rounded-lg transition-colors">
                        <Trash2 size={12} className="text-red-400" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="px-3.5 pb-3 space-y-2 border-t border-neutral-100">
                  <div className="pt-2.5">
                    <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1 block">Input</label>
                    {isEditable ? (
                      <textarea value={tc.stdin} onChange={(e) => updateTestCase(tc.id, 'stdin', e.target.value)} className="w-full text-[12px] font-mono text-neutral-700 bg-neutral-50 border border-neutral-200 rounded-lg p-2.5 outline-none focus:border-neutral-300 resize-none transition-colors" rows={2} placeholder="stdin..." />
                    ) : (
                      <pre className="text-[12px] font-mono text-neutral-600 bg-neutral-50 rounded-lg p-2.5 whitespace-pre-wrap">{tc.stdin || '(empty)'}</pre>
                    )}
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1 block">Expected Output</label>
                    {isEditable ? (
                      <textarea value={tc.expectedStdout} onChange={(e) => updateTestCase(tc.id, 'expectedStdout', e.target.value)} className="w-full text-[12px] font-mono text-neutral-700 bg-neutral-50 border border-neutral-200 rounded-lg p-2.5 outline-none focus:border-neutral-300 resize-none transition-colors" rows={2} placeholder="expected stdout..." />
                    ) : (
                      <pre className="text-[12px] font-mono text-neutral-600 bg-neutral-50 rounded-lg p-2.5 whitespace-pre-wrap">{tc.expectedStdout || '(empty)'}</pre>
                    )}
                  </div>
                  {r && !r.passed && r.actual_stdout != null && (
                    <div>
                      <label className="text-[10px] font-semibold text-red-400 uppercase tracking-wider mb-1 block">Your Output</label>
                      <pre className="text-[12px] font-mono text-red-600 bg-red-50 border border-red-100 rounded-lg p-2.5 whitespace-pre-wrap">{r.actual_stdout || '(no output)'}</pre>
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
  const renderOutputTab = () => {
    const renderTerminal = (stdout: string | null | undefined, stderr: string | null | undefined, compileOut: string | null | undefined, time: string | null | undefined, label: string, copyText: string | null | undefined) => (
      <div className="bg-[#1e1e2e] rounded-lg overflow-hidden nice-shadow">
        <div className="flex items-center gap-2 px-3.5 py-2 border-b border-white/5">
          <div className="flex gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#ff5f57]" />
            <span className="w-2 h-2 rounded-full bg-[#febc2e]" />
            <span className="w-2 h-2 rounded-full bg-[#28c840]" />
          </div>
          <span className="text-[10px] font-mono text-neutral-500 ml-1">{label}</span>
          <div className="ml-auto">{copyText && <CopyButton text={copyText} />}</div>
        </div>
        <div className="p-3.5">
          {stdout && <pre className="text-[13px] font-mono text-white/90 whitespace-pre-wrap leading-relaxed">{stdout}</pre>}
          {stderr && <pre className="text-[12px] font-mono text-red-400 whitespace-pre-wrap mt-2">{stderr}</pre>}
          {compileOut && <pre className="text-[12px] font-mono text-amber-400 whitespace-pre-wrap mt-2">{compileOut}</pre>}
          {!stdout && !stderr && !compileOut && <pre className="text-[12px] font-mono text-neutral-500 italic">(no output)</pre>}
          {time && (
            <div className="flex items-center gap-1.5 mt-3 pt-2 border-t border-white/5">
              <Clock size={10} className="text-neutral-500" />
              <span className="text-[10px] font-mono text-neutral-500">{(parseFloat(time) * 1000).toFixed(0)}ms</span>
            </div>
          )}
        </div>
      </div>
    )

    return (
      <div className="p-5 space-y-3 overflow-y-auto h-full">
        {!results ? (
          <div className="flex flex-col items-center justify-center py-14 text-neutral-300">
            <Terminal size={24} className="mb-2" strokeWidth={1.5} />
            <span className="text-[13px] text-neutral-400">Run your code to see output</span>
          </div>
        ) : (
          <>
            {renderTerminal(consoleStdout, consoleStderr, consoleCompile, executionTime, 'output', consoleStdout)}

            {/* Score */}
            {testCases.length > 0 && !isEditable && results && (
              <div className="rounded-lg p-3.5 border border-neutral-100 nice-shadow">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">Score</span>
                  <span className="text-[15px] font-bold text-neutral-800">{Math.round((passedCount / totalCount) * 100)}%</span>
                </div>
                <div className="w-full h-1.5 bg-neutral-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-500 ${allPassed ? 'bg-emerald-400' : 'bg-amber-400'}`} style={{ width: `${(passedCount / totalCount) * 100}%` }} />
                </div>
                <div className="flex items-center gap-1.5 mt-2">
                  <CheckCircle2 size={11} className={allPassed ? 'text-emerald-500' : 'text-amber-500'} />
                  <span className={`text-[11px] font-medium ${allPassed ? 'text-emerald-600' : 'text-amber-600'}`}>
                    {allPassed ? 'All test cases passed' : `${passedCount} of ${totalCount} passed`}
                  </span>
                </div>
              </div>
            )}

            {/* Per-result */}
            {results?.map((r) => (
              <div key={r.id} className={`rounded-lg border overflow-hidden nice-shadow ${r.passed ? 'border-emerald-100 bg-emerald-50/20' : 'border-red-100 bg-red-50/20'}`}>
                <div className="flex items-center gap-2 px-3.5 py-2">
                  {r.passed ? <CheckCircle2 size={13} className="text-emerald-500" /> : <XCircle size={13} className="text-red-500" />}
                  <span className="text-[12px] font-semibold text-neutral-700">{r.label}</span>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${r.passed ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}`}>
                    {r.status?.description || (r.passed ? 'Accepted' : 'Failed')}
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    {r.time && <span className="text-[10px] text-neutral-400 font-mono">{r.time}s</span>}
                    {r.memory && <span className="text-[10px] text-neutral-400 font-mono">{Math.round(r.memory)}KB</span>}
                  </div>
                </div>
                {r.actual_stdout != null && (
                  <div className="px-3.5 pb-2.5">
                    <div className="flex items-center justify-between mb-0.5">
                      <label className="text-[9px] font-semibold text-neutral-400 uppercase tracking-wider">Output</label>
                      <CopyButton text={r.actual_stdout || ''} />
                    </div>
                    <pre className="text-[11px] font-mono text-neutral-700 bg-white border border-neutral-100 rounded-lg p-2 whitespace-pre-wrap nice-shadow">{r.actual_stdout || '(no output)'}</pre>
                  </div>
                )}
                {!r.passed && r.expected_stdout && (
                  <div className="px-3.5 pb-2.5">
                    <label className="text-[9px] font-semibold text-neutral-400 uppercase tracking-wider mb-0.5 block">Expected</label>
                    <pre className="text-[11px] font-mono text-emerald-700 bg-emerald-50/50 border border-emerald-100 rounded-lg p-2 whitespace-pre-wrap nice-shadow">{r.expected_stdout}</pre>
                  </div>
                )}
                {r.stderr && (
                  <div className="px-3.5 pb-2.5">
                    <pre className="text-[11px] font-mono text-red-600 bg-red-50/50 border border-red-100 rounded-lg p-2 whitespace-pre-wrap nice-shadow">{r.stderr}</pre>
                  </div>
                )}
                {r.compile_output && (
                  <div className="px-3.5 pb-2.5">
                    <pre className="text-[11px] font-mono text-amber-700 bg-amber-50/50 border border-amber-100 rounded-lg p-2 whitespace-pre-wrap nice-shadow">{r.compile_output}</pre>
                  </div>
                )}
              </div>
            ))}
          </>
        )}

      </div>
    )
  }

  return (
    <NodeViewWrapper className="block-code-playground">
      <div
        ref={containerRef}
        className="rounded-2xl overflow-hidden nice-shadow relative"
      >
        {/* Feature 14: Confetti */}
        {showConfetti && (
          <ReactConfetti
            width={containerSize.width}
            height={containerSize.height}
            numberOfPieces={showConfetti ? 1400 : 0}
            recycle={false}
            style={{ position: 'absolute', top: 0, left: 0, zIndex: 50, pointerEvents: 'none' }}
          />
        )}

        {/* ── Split Layout ───────────────────────────────────── */}
        <div className="flex" style={{ height: 560 }}>
          {/* ── Left: Code ─────────────────────────────────────── */}
          <div className="flex-1 flex flex-col min-w-0 bg-[#1a1b26]">
            {/* Header bar — dark */}
            <div className="flex items-center justify-between px-4 border-b border-white/[0.06] shrink-0">
              <div className="flex items-center gap-2.5 py-3">
                <Code2 size={14} className="text-neutral-500" />
                <span className="text-[12px] font-semibold text-neutral-300 tracking-tight">
                  Code Playground
                </span>
                <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md ${diff.darkBg} ${diff.darkText}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${diff.dot}`} />
                  {diff.label}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {isEditable ? (
                  <div className="relative">
                    <button
                      onClick={() => setShowLangDropdown(!showLangDropdown)}
                      className="flex items-center gap-1.5 text-neutral-500 hover:text-neutral-300 font-medium py-1.5 px-1 text-[12px] transition-colors outline-none"
                    >
                      {languageName}
                      <ChevronDown size={11} className="text-neutral-500" />
                    </button>
                    {showLangDropdown && (
                      <div className="absolute right-0 top-full mt-1 bg-[#24283b] rounded-lg py-1 z-50 max-h-60 overflow-y-auto w-44 border border-white/[0.08] shadow-xl">
                        {PLAYGROUND_LANGUAGES.map((lang) => (
                          <button
                            key={lang.id}
                            onClick={() => handleLanguageChange(lang.id)}
                            className={`w-full text-left px-3.5 py-2 text-[12px] transition-colors ${
                              lang.id === languageId
                                ? 'bg-white/[0.08] text-neutral-200 font-semibold'
                                : 'text-neutral-400 hover:bg-white/[0.04] hover:text-neutral-300'
                            }`}
                          >
                            {lang.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <span className="text-[12px] font-medium text-neutral-500 px-1 py-1.5">
                    {languageName}
                  </span>
                )}
                {!isEditable && (
                  <button
                    onClick={resetCode}
                    className="flex items-center text-neutral-500 hover:text-neutral-300 py-1.5 px-1 text-[12px] transition-colors outline-none"
                    title="Reset code"
                  >
                    <RotateCcw size={13} />
                  </button>
                )}
              </div>
            </div>
            {/* Editor — dark Tokyo Night theme area */}
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
                    autocompletion: true,
                  }}
                />
              )}
            </div>
            {/* Run bar — dark */}
            <div className="border-t border-white/[0.06]">
              {(isRunning || (results && !isRunning)) && (
                <div className="h-0.5 w-full bg-white/[0.06] overflow-hidden">
                  <div
                    className={`h-full ${timerBarColor} transition-all ${isRunning ? 'duration-100' : 'duration-300'}`}
                    style={{ width: isRunning ? `${timerProgress}%` : '100%' }}
                  />
                </div>
              )}
              <div className="flex items-center gap-3 px-4 py-2.5">
                <button
                  onClick={runCode}
                  disabled={isRunning || !accessToken}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold transition-all ${
                    isRunning
                      ? 'bg-white/[0.06] text-neutral-500 cursor-not-allowed'
                      : 'bg-white/[0.10] hover:bg-white/[0.14] text-neutral-200'
                  }`}
                >
                  {isRunning ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Play size={14} />
                  )}
                  {isEditable ? 'Test Run' : 'Run Code'}
                </button>
                {isRunning && (
                  <span className="text-[11px] font-mono text-neutral-500">
                    {(elapsedMs / 1000).toFixed(1)}s / {(timeLimitMs / 1000).toFixed(0)}s
                  </span>
                )}
                {allPassed && !isEditable && !isRunning && (
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 size={13} className="text-emerald-400" />
                    <span className="text-[12px] font-semibold text-emerald-400">All passed</span>
                  </div>
                )}
              </div>
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
            className="border-l border-neutral-200/60 bg-white relative"
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
