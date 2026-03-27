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
  Database,
  Upload,
  History,
} from 'lucide-react'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { useCourse } from '@components/Contexts/CourseContext'
import { uploadSqliteDb } from '@services/blocks/CodePlayground/sqlite'
import { getAPIUrl } from '@services/config/config'
import { PLAYGROUND_LANGUAGES, getLanguageById } from './languages'
import SubmissionHistory from './SubmissionHistory'
import CodeDiff from './CodeDiff'
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
    case 'sql': {
      const { sql } = await import('@codemirror/lang-sql')
      return sql()
    }
    case 'xml': {
      const { xml } = await import('@codemirror/lang-xml')
      return xml()
    }
    case 'markdown': {
      const { markdown } = await import('@codemirror/lang-markdown')
      return markdown()
    }
    case 'wast': {
      const { wast } = await import('@codemirror/lang-wast')
      return wast()
    }
    case 'sass': {
      const { sass } = await import('@codemirror/lang-sass')
      return sass()
    }
    case 'perl': {
      const { StreamLanguage } = await import('@codemirror/language')
      const { perl } = await import('@codemirror/legacy-modes/mode/perl')
      return StreamLanguage.define(perl)
    }
    case 'r': {
      const { StreamLanguage } = await import('@codemirror/language')
      const { r } = await import('@codemirror/legacy-modes/mode/r')
      return StreamLanguage.define(r)
    }
    case 'haskell': {
      const { StreamLanguage } = await import('@codemirror/language')
      const { haskell } = await import(
        '@codemirror/legacy-modes/mode/haskell'
      )
      return StreamLanguage.define(haskell)
    }
    case 'lua': {
      const { StreamLanguage } = await import('@codemirror/language')
      const { lua } = await import('@codemirror/legacy-modes/mode/lua')
      return StreamLanguage.define(lua)
    }
    case 'clojure': {
      const { StreamLanguage } = await import('@codemirror/language')
      const { clojure } = await import(
        '@codemirror/legacy-modes/mode/clojure'
      )
      return StreamLanguage.define(clojure)
    }
    case 'shell': {
      const { StreamLanguage } = await import('@codemirror/language')
      const { shell } = await import('@codemirror/legacy-modes/mode/shell')
      return StreamLanguage.define(shell)
    }
    case 'pascal': {
      const { StreamLanguage } = await import('@codemirror/language')
      const { pascal } = await import(
        '@codemirror/legacy-modes/mode/pascal'
      )
      return StreamLanguage.define(pascal)
    }
    case 'fortran': {
      const { StreamLanguage } = await import('@codemirror/language')
      const { fortran } = await import(
        '@codemirror/legacy-modes/mode/fortran'
      )
      return StreamLanguage.define(fortran)
    }
    case 'powershell': {
      const { StreamLanguage } = await import('@codemirror/language')
      const { powerShell } = await import(
        '@codemirror/legacy-modes/mode/powershell'
      )
      return StreamLanguage.define(powerShell)
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

type RightTab = 'description' | 'tests' | 'output' | 'history'
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
  const org = useOrg() as any
  const course = useCourse() as any
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
  const sqliteDbPath: string = node.attrs.sqliteDbPath || ''
  const sqliteDbName: string = node.attrs.sqliteDbName || ''
  const timedMode: boolean = node.attrs.timedMode || false
  const timedDurationMs: number = node.attrs.timedDurationMs ?? 300000
  const additionalFiles: { name: string; content: string }[] = node.attrs.additionalFiles || []

  const isSqlLanguage = languageId === 82

  const blockId = node.attrs.id || 'unknown'
  const activityUuid = props.extension?.options?.activity?.activity_uuid || ''

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
  const [solutionView, setSolutionView] = useState<'diff' | 'solution'>('diff')

  // Editor: Advanced settings toggle
  const [showAdvanced, setShowAdvanced] = useState(false)

  // Feature 10: Execution timer
  const [elapsedMs, setElapsedMs] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Feature 14: Confetti
  const [showConfetti, setShowConfetti] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })

  // SQLite upload
  const [isUploadingSqlite, setIsUploadingSqlite] = useState(false)
  const sqliteInputRef = useRef<HTMLInputElement>(null)

  // Feature: Timed Challenge
  const [challengeStarted, setChallengeStarted] = useState(false)
  const [challengeTimeLeft, setChallengeTimeLeft] = useState(timedDurationMs)
  const [challengeExpired, setChallengeExpired] = useState(false)
  const challengeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Student custom test cases
  const [studentTestCases, setStudentTestCases] = useState<TestCase[]>([])

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

  // Feature: Timed Challenge countdown
  useEffect(() => {
    if (!timedMode || !challengeStarted || challengeExpired) return
    challengeTimerRef.current = setInterval(() => {
      setChallengeTimeLeft((prev) => {
        if (prev <= 1000) {
          setChallengeExpired(true)
          if (challengeTimerRef.current) clearInterval(challengeTimerRef.current)
          return 0
        }
        return prev - 1000
      })
    }, 1000)
    return () => {
      if (challengeTimerRef.current) clearInterval(challengeTimerRef.current)
    }
  }, [timedMode, challengeStarted, challengeExpired])

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

  const addStudentTestCase = useCallback(() => {
    setStudentTestCases((prev) => [
      ...prev,
      { id: uuidv4(), label: `My Test ${prev.length + 1}`, stdin: '', expectedStdout: '' },
    ])
  }, [])

  const removeStudentTestCase = useCallback((id: string) => {
    setStudentTestCases((prev) => prev.filter((tc) => tc.id !== id))
  }, [])

  const updateStudentTestCase = useCallback((id: string, field: keyof TestCase, value: string) => {
    setStudentTestCases((prev) =>
      prev.map((tc) => (tc.id === id ? { ...tc, [field]: value } : tc))
    )
  }, [])

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

  const addAdditionalFile = useCallback(() => {
    updateAttributes({
      additionalFiles: [...additionalFiles, { name: 'data.txt', content: '' }],
    })
  }, [additionalFiles, updateAttributes])

  const removeAdditionalFile = useCallback((index: number) => {
    updateAttributes({
      additionalFiles: additionalFiles.filter((_, i) => i !== index),
    })
  }, [additionalFiles, updateAttributes])

  const updateAdditionalFile = useCallback((index: number, field: 'name' | 'content', value: string) => {
    const updated = additionalFiles.map((f, i) =>
      i === index ? { ...f, [field]: value } : f
    )
    updateAttributes({ additionalFiles: updated })
  }, [additionalFiles, updateAttributes])

  const resetCode = useCallback(() => {
    setCode(starterCode)
    setResults(null)
  }, [starterCode])

  const handleSqliteUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !accessToken) return
    setIsUploadingSqlite(true)
    try {
      const activityUuid = props.extension?.options?.activity?.activity_uuid
      const orgUuid = org?.org_uuid
      const courseUuid = course?.courseStructure?.course_uuid
      const blockId = node.attrs.id || uuidv4()
      if (!activityUuid || !orgUuid || !courseUuid) {
        console.error('Missing context for SQLite upload')
        return
      }
      const result = await uploadSqliteDb(
        file, activityUuid, blockId, orgUuid, courseUuid, accessToken
      )
      updateAttributes({
        sqliteDbPath: result.file_path,
        sqliteDbName: result.file_name,
      })
    } catch (err) {
      console.error('SQLite upload error:', err)
    } finally {
      setIsUploadingSqlite(false)
      if (sqliteInputRef.current) sqliteInputRef.current.value = ''
    }
  }, [accessToken, org, course, props.extension, node.attrs.id, updateAttributes])

  const removeSqliteDb = useCallback(() => {
    updateAttributes({ sqliteDbPath: '', sqliteDbName: '' })
  }, [updateAttributes])

  const runCode = useCallback(async () => {
    if (timedMode && challengeExpired && !isEditable) return
    if (isRunning || !accessToken) return
    setIsRunning(true)
    setResults(null)

    const allTestCases = [...testCases, ...studentTestCases]

    // Feature 3: Increment attempt count when running with test cases
    if (allTestCases.length > 0 && !isEditable) {
      setAttemptCount((prev) => prev + 1)
    }

    try {
      if (allTestCases.length === 0) {
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
            ...(isSqlLanguage && sqliteDbPath ? { sqlite_db_path: sqliteDbPath } : {}),
            ...(additionalFiles.length > 0 ? { additional_files: additionalFiles.map((f) => ({ name: f.name, content: f.content })) } : {}),
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

        // Save submission (learner mode only)
        if (!isEditable && activityUuid && accessToken) {
          const allResults = newResults
          const totalTests = allResults.length
          const passedTests = allResults.filter((r: any) => r.passed).length
          const execTime = allResults[0]?.time ? Math.round(parseFloat(allResults[0].time) * 1000) : null
          fetch(`${getAPIUrl()}code/submissions/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
            body: JSON.stringify({
              activity_uuid: activityUuid, block_id: blockId, language_id: languageId,
              source_code: code, results: { items: allResults },
              passed: passedTests === totalTests && totalTests > 0,
              total_tests: totalTests, passed_tests: passedTests, execution_time_ms: execTime,
            }),
          }).catch(console.error)
        }
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
            test_cases: allTestCases.map((tc) => ({
              id: tc.id,
              label: tc.label,
              stdin: tc.stdin,
              expected_stdout: tc.expectedStdout,
            })),
            ...(isSqlLanguage && sqliteDbPath ? { sqlite_db_path: sqliteDbPath } : {}),
            ...(additionalFiles.length > 0 ? { additional_files: additionalFiles.map((f) => ({ name: f.name, content: f.content })) } : {}),
          }),
        })
        const data = await resp.json()
        setResults(data.results)
        setActiveTab('output')

        // Save submission (learner mode only)
        if (!isEditable && activityUuid && accessToken) {
          const allResults = data.results
          const totalTests = allResults.length
          const passedTests = allResults.filter((r: any) => r.passed).length
          const execTime = allResults[0]?.time ? Math.round(parseFloat(allResults[0].time) * 1000) : null
          fetch(`${getAPIUrl()}code/submissions/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
            body: JSON.stringify({
              activity_uuid: activityUuid, block_id: blockId, language_id: languageId,
              source_code: code, results: { items: allResults },
              passed: passedTests === totalTests && totalTests > 0,
              total_tests: totalTests, passed_tests: passedTests, execution_time_ms: execTime,
            }),
          }).catch(console.error)
        }
      }
    } catch (err) {
      console.error('Code execution error:', err)
    } finally {
      setIsRunning(false)
    }
  }, [isRunning, accessToken, testCases, languageId, code, isEditable, isSqlLanguage, sqliteDbPath, activityUuid, blockId, timedMode, challengeExpired])

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
    { id: 'history' as RightTab, icon: <History size={13} />, label: 'History' },
  ]

  const visibleTabs = isEditable ? tabs.filter(t => t.id !== 'history') : tabs

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

          {/* SQLite Database Upload (SQL only) */}
          {isSqlLanguage && (
            <div>
              <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-1.5 block">
                SQLite Database
              </label>
              {sqliteDbPath ? (
                <div className="flex items-center gap-2 bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2.5 nice-shadow">
                  <Database size={14} className="text-neutral-500 shrink-0" />
                  <span className="text-[12px] text-neutral-700 truncate flex-1">{sqliteDbName || 'database.sqlite'}</span>
                  <button
                    onClick={removeSqliteDb}
                    className="p-1 hover:bg-red-50 rounded transition-colors shrink-0"
                  >
                    <Trash2 size={12} className="text-red-400" />
                  </button>
                </div>
              ) : (
                <div
                  onClick={() => sqliteInputRef.current?.click()}
                  className="flex flex-col items-center gap-2 bg-neutral-50 border-2 border-dashed border-neutral-200 rounded-lg px-3 py-4 cursor-pointer hover:border-neutral-300 hover:bg-neutral-100 transition-all"
                >
                  {isUploadingSqlite ? (
                    <Loader2 size={16} className="text-neutral-400 animate-spin" />
                  ) : (
                    <Upload size={16} className="text-neutral-400" />
                  )}
                  <span className="text-[11px] text-neutral-400">
                    {isUploadingSqlite ? 'Uploading...' : 'Upload .sqlite / .db file'}
                  </span>
                </div>
              )}
              <input
                ref={sqliteInputRef}
                type="file"
                accept=".sqlite,.db,.sqlite3"
                onChange={handleSqliteUpload}
                className="hidden"
              />
              <p className="text-[10px] text-neutral-400 mt-1">
                Students' SQL queries will run against this database.
              </p>
            </div>
          )}

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
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-1 block">Timed Challenge</label>
                    <p className="text-[10px] text-neutral-400">Add a countdown timer to the challenge.</p>
                  </div>
                  <button
                    onClick={() => updateAttributes({ timedMode: !timedMode })}
                    className={`w-10 h-5 rounded-full transition-colors ${timedMode ? 'bg-blue-500' : 'bg-neutral-200'}`}
                  >
                    <span className={`block w-4 h-4 rounded-full bg-white transition-transform shadow-sm ${timedMode ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                </div>
                {timedMode && (
                  <div>
                    <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-1 block">Duration (minutes)</label>
                    <input
                      type="number"
                      min={1}
                      max={120}
                      value={Math.round(timedDurationMs / 60000)}
                      onChange={(e) => updateAttributes({ timedDurationMs: (parseInt(e.target.value) || 5) * 60000 })}
                      className="w-full text-[12px] text-neutral-700 bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 outline-none focus:border-neutral-300 transition-colors nice-shadow"
                    />
                  </div>
                )}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">Additional Files</label>
                    <button onClick={addAdditionalFile} className="flex items-center gap-1 text-[11px] font-medium text-neutral-400 hover:text-neutral-600 transition-colors">
                      <Plus size={11} /> Add File
                    </button>
                  </div>
                  <p className="text-[10px] text-neutral-400 mb-2">Files available to the student's code (e.g., data.txt, utils.py).</p>
                  {additionalFiles.map((file, i) => (
                    <div key={i} className="mb-2 rounded-lg border border-neutral-200 p-2.5 bg-neutral-50/50">
                      <div className="flex items-center gap-2 mb-1.5">
                        <input
                          value={file.name}
                          onChange={(e) => updateAdditionalFile(i, 'name', e.target.value)}
                          className="flex-1 text-[11px] font-mono text-neutral-700 bg-white border border-neutral-200 rounded px-2 py-1 outline-none focus:border-neutral-300"
                          placeholder="filename.ext"
                        />
                        <button onClick={() => removeAdditionalFile(i)} className="p-1 hover:bg-red-50 rounded transition-colors">
                          <Trash2 size={11} className="text-red-400" />
                        </button>
                      </div>
                      <textarea
                        value={file.content}
                        onChange={(e) => updateAdditionalFile(i, 'content', e.target.value)}
                        className="w-full text-[11px] font-mono text-neutral-700 bg-white border border-neutral-200 rounded px-2 py-1.5 outline-none focus:border-neutral-300 resize-none"
                        rows={4}
                        placeholder="File contents..."
                      />
                    </div>
                  ))}
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

          {isSqlLanguage && sqliteDbPath && (
            <div className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg text-neutral-500 bg-neutral-50 border border-neutral-100 nice-shadow w-fit">
              <Database size={10} className="text-neutral-400" />
              Runs against: {sqliteDbName || 'database.sqlite'}
            </div>
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

          {additionalFiles.length > 0 && (
            <div className="space-y-1">
              <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">Available Files</span>
              {additionalFiles.map((f, i) => (
                <div key={i} className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-lg text-neutral-500 bg-neutral-50 border border-neutral-100 nice-shadow w-fit">
                  <FileText size={10} className="text-neutral-400" />
                  {f.name}
                </div>
              ))}
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
                <div className="space-y-2">
                  <div className="flex gap-1">
                    <button
                      onClick={() => setSolutionView('diff')}
                      className={`text-[10px] font-semibold px-2 py-1 rounded transition-colors ${solutionView === 'diff' ? 'bg-neutral-200 text-neutral-700' : 'text-neutral-400 hover:text-neutral-600'}`}
                    >
                      Diff
                    </button>
                    <button
                      onClick={() => setSolutionView('solution')}
                      className={`text-[10px] font-semibold px-2 py-1 rounded transition-colors ${solutionView === 'solution' ? 'bg-neutral-200 text-neutral-700' : 'text-neutral-400 hover:text-neutral-600'}`}
                    >
                      Solution
                    </button>
                  </div>
                  {solutionView === 'diff' ? (
                    <CodeDiff studentCode={code} solutionCode={solutionCode} />
                  ) : (
                    <div className={`rounded-lg overflow-hidden border border-neutral-200 nice-shadow ${cmClassName}`}>
                      {solutionExtensions.length > 0 && (
                        <CodeMirror value={solutionCode} extensions={solutionExtensions} editable={false} height="auto" maxHeight="300px" style={cmStyles} basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: false }} />
                      )}
                    </div>
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
      {!isEditable && (
        <div className="mt-4 pt-3 border-t border-neutral-100">
          <div className="flex items-center justify-between mb-2">
            <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
              Your Test Cases
            </label>
            <button
              onClick={addStudentTestCase}
              className="flex items-center gap-1 text-[11px] font-medium text-blue-500 hover:text-blue-600 transition-colors"
            >
              <Plus size={11} /> Add
            </button>
          </div>
          {studentTestCases.length === 0 && (
            <p className="text-[11px] text-neutral-400 italic">Add your own test cases to verify edge cases.</p>
          )}
          {studentTestCases.map((tc) => (
            <div key={tc.id} className="mb-3 rounded-lg border border-blue-100 bg-blue-50/20 p-2.5">
              <div className="flex items-center gap-2 mb-1.5">
                <input
                  value={tc.label}
                  onChange={(e) => updateStudentTestCase(tc.id, 'label', e.target.value)}
                  className="flex-1 text-[12px] font-medium text-neutral-700 bg-white border border-neutral-200 rounded px-2 py-1 outline-none focus:border-blue-300"
                />
                <button onClick={() => removeStudentTestCase(tc.id)} className="p-1 hover:bg-red-50 rounded transition-colors">
                  <Trash2 size={11} className="text-red-400" />
                </button>
              </div>
              <div className="space-y-1.5">
                <div>
                  <label className="text-[9px] font-semibold text-neutral-400 uppercase">Input (stdin)</label>
                  <textarea
                    value={tc.stdin}
                    onChange={(e) => updateStudentTestCase(tc.id, 'stdin', e.target.value)}
                    className="w-full text-[11px] font-mono text-neutral-700 bg-white border border-neutral-200 rounded px-2 py-1.5 outline-none focus:border-blue-300 resize-none"
                    rows={2}
                    placeholder="Input..."
                  />
                </div>
                <div>
                  <label className="text-[9px] font-semibold text-neutral-400 uppercase">Expected Output</label>
                  <textarea
                    value={tc.expectedStdout}
                    onChange={(e) => updateStudentTestCase(tc.id, 'expectedStdout', e.target.value)}
                    className="w-full text-[11px] font-mono text-neutral-700 bg-white border border-neutral-200 rounded px-2 py-1.5 outline-none focus:border-blue-300 resize-none"
                    rows={2}
                    placeholder="Expected output..."
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  // ── Tab: Output ───────────────────────────────────────────────
  const renderSqlTable = (stdout: string) => {
    const lines = stdout.trim().split('\n').filter(Boolean)
    if (lines.length < 1) return null
    const headers = lines[0].split('|')
    const rows = lines.slice(1).map((line) => line.split('|'))
    return (
      <div className="overflow-x-auto rounded-lg border border-white/10 nice-shadow">
        <table className="w-full text-[12px] font-mono">
          <thead>
            <tr className="bg-white/[0.06]">
              {headers.map((h, i) => (
                <th key={i} className="px-3 py-2 text-left text-[11px] font-bold text-neutral-300 uppercase tracking-wider border-b border-white/10">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className={ri % 2 === 0 ? 'bg-white/[0.02]' : 'bg-white/[0.05]'}>
                {row.map((cell, ci) => (
                  <td key={ci} className="px-3 py-1.5 text-white/80 border-b border-white/5">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

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
          {stdout && isSqlLanguage && stdout.includes('|') ? (
            renderSqlTable(stdout)
          ) : stdout ? (
            <pre className="text-[13px] font-mono text-white/90 whitespace-pre-wrap leading-relaxed">{stdout}</pre>
          ) : null}
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
                    {isSqlLanguage && r.actual_stdout && r.actual_stdout.includes('|') ? (
                      <div className="overflow-x-auto rounded-lg border border-neutral-200 nice-shadow">
                        <table className="w-full text-[11px] font-mono">
                          <thead>
                            <tr className="bg-neutral-50">
                              {r.actual_stdout.trim().split('\n')[0].split('|').map((h, i) => (
                                <th key={i} className="px-2.5 py-1.5 text-left text-[10px] font-bold text-neutral-500 uppercase tracking-wider border-b border-neutral-200">
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {r.actual_stdout.trim().split('\n').slice(1).filter(Boolean).map((line, ri) => (
                              <tr key={ri} className={ri % 2 === 0 ? 'bg-white' : 'bg-neutral-50/50'}>
                                {line.split('|').map((cell, ci) => (
                                  <td key={ci} className="px-2.5 py-1 text-neutral-700 border-b border-neutral-100">
                                    {cell}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <pre className="text-[11px] font-mono text-neutral-700 bg-white border border-neutral-100 rounded-lg p-2 whitespace-pre-wrap nice-shadow">{r.actual_stdout || '(no output)'}</pre>
                    )}
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
        <div className="flex relative" style={{ height: 560 }}>
          {timedMode && !isEditable && !challengeStarted && (
            <div className="absolute inset-0 z-20 bg-[#1a1b26]/95 flex flex-col items-center justify-center gap-4">
              <Clock size={32} className="text-neutral-400" />
              <span className="text-[14px] font-semibold text-neutral-200">Timed Challenge</span>
              <span className="text-[12px] text-neutral-400">
                You have {Math.floor(timedDurationMs / 60000)} minutes to complete this challenge.
              </span>
              <button
                onClick={() => { setChallengeStarted(true); setChallengeTimeLeft(timedDurationMs) }}
                className="px-5 py-2.5 bg-white/10 hover:bg-white/15 text-neutral-200 rounded-lg text-[13px] font-semibold transition-all"
              >
                Start Challenge
              </button>
            </div>
          )}
          {/* ── Left: Code ─────────────────────────────────────── */}
          <Resizable
            defaultSize={{ width: '60%', height: '100%' }}
            minWidth={300}
            maxWidth="80%"
            enable={{ right: true }}
            handleStyles={{
              right: {
                width: 8,
                right: -4,
                cursor: 'col-resize',
              },
            }}
            handleClasses={{
              right: 'group',
            }}
            className="flex flex-col min-w-0 bg-[#1a1b26] relative"
          >
            <div className="absolute right-0 top-0 bottom-0 w-[3px] z-10 hover:bg-blue-500/40 transition-colors bg-white/[0.06]" />
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
                {timedMode && challengeStarted && !isEditable && (
                  <span className={`text-[12px] font-mono font-semibold ${challengeTimeLeft < 30000 ? 'text-red-400' : 'text-neutral-400'}`}>
                    {Math.floor(challengeTimeLeft / 60000)}:{String(Math.floor((challengeTimeLeft % 60000) / 1000)).padStart(2, '0')}
                  </span>
                )}
              </div>
            </div>
          </Resizable>

          {/* ── Right: Tabbed Panel ──────────────────────────── */}
          <div
            className="flex-1 min-w-[240px] border-l border-neutral-200/60 bg-white flex flex-col"
          >
            {/* Tab bar */}
            <div className="flex items-center border-b border-neutral-200/60 bg-white px-1 shrink-0">
              {visibleTabs.map((tab) => (
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
              {activeTab === 'history' && (
                <div className="p-5 overflow-y-auto h-full">
                  <SubmissionHistory
                    activityUuid={activityUuid}
                    blockId={blockId}
                    accessToken={accessToken}
                    onRestoreCode={(restoredCode) => setCode(restoredCode)}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </NodeViewWrapper>
  )
}

export default CodePlaygroundComponent
