// Contract: every endpoint the SDK's resources call exists in the API, with
// that method. The path templates come from the requests themselves (the
// `onRequest` hook sees the template a resource asked for), and are looked up
// in openapi.json, or openapi.admin.json for the Admin API. If the API drops or
// renames a route, regenerating the snapshots (`bun run generate`) makes this
// fail until the SDK follows.
import { describe, expect, it } from 'vitest'
import { createClient } from '../src'
import { CALLS } from './calls'
import { json, mockFetch } from './helpers'

type Spec = { paths: Record<string, Record<string, { parameters?: Array<{ name: string; in: string }> }>> }
// Node built-in, loaded untyped: this package has no @types/node.
const fs = (await import('node:fs' as string)) as { readFileSync(path: URL, encoding: 'utf8'): string }
const load = (f: string): Spec => JSON.parse(fs.readFileSync(new URL(f, import.meta.url), 'utf8'))
const main = load('../openapi.json')
const admin = load('../openapi.admin.json')

function lookup(template: string, method: string) {
  const spec = template.startsWith('/api/v1/admin/') ? admin : main
  return spec.paths[template]?.[method.toLowerCase()]
}

// Routes whose OpenAPI entry leaves a path placeholder undeclared (the handler
// never reads it, so FastAPI documents only the others). The SDK still has to
// fill it in; listed here so a fix in the API shows up as a test to update.
const UNDECLARED_PATH_PARAMS: Record<string, string[]> = {
  'PUT /api/v1/assignments/{assignment_uuid}/tasks/{assignment_task_uuid}/submissions': ['assignment_uuid'],
  'GET /api/v1/assignments/{assignment_uuid}/tasks/{assignment_task_uuid}/submissions/me': ['assignment_uuid'],
  'POST /api/v1/assignments/{assignment_uuid}/tasks/{assignment_task_uuid}/sub_file': ['assignment_uuid'],
}

async function templateOf(run: (c: ReturnType<typeof createClient>) => Promise<unknown>, response: unknown) {
  const seen: Array<{ method: string; path: string }> = []
  const m = mockFetch(json(response ?? {}))
  const lh = createClient({
    baseUrl: 'http://api.test',
    token: 'lh_t',
    fetch: m.fetch,
    retry: false,
    onRequest: (ctx) => {
      seen.push({ method: ctx.method, path: ctx.path })
    },
  })
  await run(lh)
  return seen
}

describe('SDK endpoints exist in the API schema', () => {
  it.each(CALLS)('$name → $method $template', async (c) => {
    const seen = await templateOf(c.run, c.response)
    expect(seen).toEqual([{ method: c.method, path: c.template }])
    const op = lookup(c.template, c.method)
    expect(op, `${c.method} ${c.template} is not in the API schema`).toBeDefined()

    // Every {placeholder} is a declared path parameter (minus known API quirks).
    const placeholders = [...c.template.matchAll(/\{([^}]+)\}/g)].map((x) => x[1])
    const declared = new Set((op?.parameters ?? []).filter((p) => p.in === 'path').map((p) => p.name))
    const quirks = new Set(UNDECLARED_PATH_PARAMS[`${c.method} ${c.template}`] ?? [])
    for (const name of placeholders) {
      if (!quirks.has(name)) expect(declared.has(name), `{${name}} of ${c.template}`).toBe(true)
    }
    for (const name of quirks) expect(declared.has(name), `${c.template} now declares {${name}}`).toBe(false)
  })

  it('the snapshots are non-trivial and the Admin API is kept apart', () => {
    expect(Object.keys(main.paths).length).toBeGreaterThan(500)
    expect(Object.keys(main.paths).some((p) => p.startsWith('/api/v1/admin/'))).toBe(false)
    expect(Object.keys(admin.paths).every((p) => p.startsWith('/api/v1/admin/'))).toBe(true)
    expect(Object.keys(admin.paths).length).toBeGreaterThan(20)
  })

  it('every Admin API route has an SDK method', () => {
    const covered = new Set(CALLS.filter((c) => c.template.startsWith('/api/v1/admin/')).map((c) => `${c.method} ${c.template}`))
    const missing: string[] = []
    for (const [path, item] of Object.entries(admin.paths)) {
      for (const method of Object.keys(item)) {
        const key = `${method.toUpperCase()} ${path}`
        // Browser-facing redirect for links minted by older versions.
        if (path.endsWith('/auth/magic-consume')) continue
        if (!covered.has(key)) missing.push(key)
      }
    }
    expect(missing).toEqual([])
  })
})
