/*
 Running code for the Code playground block, kept free of React so it can be
 unit tested (tests/editor-blocks-embeds.test.mjs).

 The limits mirror apps/api/src/routers/code_execution.py. The server enforces
 them anyway; checking first lets the block say what's wrong instead of
 showing a raw 422.
*/

export const LIMITS = {
  /** MAX_BATCH_TEST_CASES: author tests + hidden tests + the learner's own. */
  tests: 50,
  /** MAX_SOURCE_CODE_CHARS / MAX_STDIN_CHARS. */
  codeChars: 64 * 1024,
  stdinChars: 64 * 1024,
  /** MAX_ADDITIONAL_FILES / MAX_ADDITIONAL_FILE_CHARS. */
  files: 20,
  fileChars: 128 * 1024,
  /** The time-limit setting (seconds), the range the AI exercise fence accepts. */
  timeLimitMinS: 1,
  timeLimitMaxS: 60,
} as const

export interface TestCase {
  id: string
  label: string
  stdin: string
  expectedStdout: string
  /** Hidden from learners: they see whether it passed, not its input/output. */
  hidden?: boolean
}

export interface TestResult {
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

export interface AdditionalFile {
  name: string
  content: string
}

/** Judge0 status ids the UI words differently. */
export const STATUS = { accepted: 3, wrongAnswer: 4, timeLimit: 5, compileError: 6 } as const

/** Stored test cases come from old documents, the AI and hand-edited JSON. */
export function normalizeTestCases(raw: unknown): TestCase[] {
  if (!Array.isArray(raw)) return []
  const out: TestCase[] = []
  const seen = new Set<string>()
  raw.forEach((tc, i) => {
    if (!tc || typeof tc !== 'object') return
    let id = typeof (tc as any).id === 'string' && (tc as any).id ? (tc as any).id : `test-${i + 1}`
    while (seen.has(id)) id = `${id}-${i + 1}`
    seen.add(id)
    out.push({
      id,
      label: typeof (tc as any).label === 'string' ? (tc as any).label : `Test ${i + 1}`,
      stdin: typeof (tc as any).stdin === 'string' ? (tc as any).stdin : '',
      expectedStdout: typeof (tc as any).expectedStdout === 'string' ? (tc as any).expectedStdout : '',
      ...((tc as any).hidden === true ? { hidden: true } : {}),
    })
  })
  return out
}

export function clampTimeLimitMs(ms: unknown): number {
  const n = typeof ms === 'number' && Number.isFinite(ms) ? ms : 10000
  return Math.round(Math.min(LIMITS.timeLimitMaxS * 1000, Math.max(LIMITS.timeLimitMinS * 1000, n)))
}

export type RunProblem =
  | { kind: 'too_many_tests'; max: number }
  | { kind: 'code_too_long'; max: number }
  | { kind: 'input_too_long'; max: number }
  | { kind: 'too_many_files'; max: number }
  | { kind: 'file_too_long'; name: string; max: number }

/** A request the server would refuse, worded for the learner, or null. */
export function checkRun(code: string, tests: TestCase[], files: AdditionalFile[], stdin = ''): RunProblem | null {
  if (tests.length > LIMITS.tests) return { kind: 'too_many_tests', max: LIMITS.tests }
  if (code.length > LIMITS.codeChars) return { kind: 'code_too_long', max: LIMITS.codeChars }
  if (stdin.length > LIMITS.stdinChars || tests.some((t) => t.stdin.length > LIMITS.stdinChars || t.expectedStdout.length > LIMITS.stdinChars)) {
    return { kind: 'input_too_long', max: LIMITS.stdinChars }
  }
  if (files.length > LIMITS.files) return { kind: 'too_many_files', max: LIMITS.files }
  const big = files.find((f) => f.content.length > LIMITS.fileChars)
  if (big) return { kind: 'file_too_long', name: big.name, max: LIMITS.fileChars }
  return null
}

export type RunError =
  | { kind: 'rate_limited' }
  | { kind: 'unavailable' }
  | { kind: 'auth' }
  | { kind: 'rejected'; message: string }
  | { kind: 'network' }

/** Map a failed response to something the block can explain. */
export function runErrorFrom(status: number, body: unknown): RunError {
  if (status === 429) return { kind: 'rate_limited' }
  if (status === 503 || status === 502 || status === 504) return { kind: 'unavailable' }
  if (status === 401 || status === 403) return { kind: 'auth' }
  const detail = body && typeof body === 'object' ? (body as any).detail : null
  const message = typeof detail === 'string' ? detail : Array.isArray(detail) && typeof detail[0]?.msg === 'string' ? detail[0].msg : ''
  return { kind: 'rejected', message }
}

export interface RunRequest {
  apiUrl: string
  token: string
  activityUuid: string
  languageId: number
  code: string
  files: AdditionalFile[]
  sqliteDbPath?: string
}

export type RunOutcome = { ok: true; results: TestResult[] } | { ok: false; error: RunError }

async function post(url: string, token: string, body: unknown): Promise<{ status: number; data: any } | null> {
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
    let data: any = null
    try {
      data = await resp.json()
    } catch {
      data = null
    }
    return { status: resp.status, data: resp.ok ? data : { __error: true, status: resp.status, body: data } }
  } catch {
    return null
  }
}

function common(req: RunRequest) {
  return {
    activity_uuid: req.activityUuid,
    language_id: req.languageId,
    source_code: req.code,
    ...(req.sqliteDbPath ? { sqlite_db_path: req.sqliteDbPath } : {}),
    ...(req.files.length > 0 ? { additional_files: req.files.map((f) => ({ name: f.name, content: f.content })) } : {}),
  }
}

/** One run with optional stdin: the console. */
export async function executeOnce(req: RunRequest, stdin: string, label: string): Promise<RunOutcome> {
  const res = await post(`${req.apiUrl}code/execute`, req.token, { ...common(req), stdin })
  if (!res) return { ok: false, error: { kind: 'network' } }
  if (res.data?.__error) return { ok: false, error: runErrorFrom(res.status, res.data.body) }
  const d = res.data || {}
  return {
    ok: true,
    results: [{
      id: 'single',
      label,
      passed: d.status?.id === STATUS.accepted,
      actual_stdout: d.stdout ?? null,
      expected_stdout: '',
      stderr: d.stderr ?? null,
      compile_output: d.compile_output ?? null,
      status: d.status ?? null,
      time: d.time ?? null,
      memory: d.memory ?? null,
    }],
  }
}

/** Every test in one batch. */
export async function executeTests(req: RunRequest, tests: TestCase[]): Promise<RunOutcome> {
  const res = await post(`${req.apiUrl}code/execute-batch`, req.token, {
    ...common(req),
    test_cases: tests.map((tc) => ({ id: tc.id, label: tc.label, stdin: tc.stdin, expected_stdout: tc.expectedStdout })),
  })
  if (!res) return { ok: false, error: { kind: 'network' } }
  if (res.data?.__error) return { ok: false, error: runErrorFrom(res.status, res.data.body) }
  const results = Array.isArray(res.data?.results) ? (res.data.results as TestResult[]) : null
  if (!results) return { ok: false, error: { kind: 'rejected', message: '' } }
  return { ok: true, results }
}

export interface RunSummary {
  total: number
  passed: number
  allPassed: boolean
  /** The compiler's complaint, once (every test repeats it). */
  compileOutput: string | null
}

export function summarize(results: TestResult[] | null): RunSummary | null {
  if (!results) return null
  const passed = results.filter((r) => r.passed).length
  const compileOutput = results.find((r) => r.compile_output)?.compile_output ?? null
  return { total: results.length, passed, allPassed: results.length > 0 && passed === results.length, compileOutput }
}

/**
 * What a learner may see of one result. Hidden tests keep their verdict and
 * timing but not their input, expected output or what the program printed for
 * them (which would give the expected answer away on a near miss).
 */
export function visibleResult(result: TestResult, test: TestCase | undefined, isAuthor: boolean): TestResult & { redacted: boolean } {
  if (isAuthor || !test?.hidden) return { ...result, redacted: false }
  return { ...result, actual_stdout: null, expected_stdout: '', stderr: null, redacted: true }
}

/** The language's template, used to tell an untouched starter from real work. */
export function shouldReplaceStarter(current: string, previousTemplate: string | undefined): boolean {
  const trimmed = (current || '').trim()
  return !trimmed || (!!previousTemplate && trimmed === previousTemplate.trim())
}
