#!/usr/bin/env node
// Generates the SDK's OpenAPI snapshot and TypeScript types from the FastAPI
// source in apps/api. Nothing in src/generated is written by hand.
//
//   node scripts/generate.mjs            regenerate openapi.json + src/generated/schema.ts
//   node scripts/generate.mjs --check    fail (exit 1) if the committed output is stale
//   node scripts/generate.mjs --from x   use an existing raw schema file instead of running Python
//   node scripts/generate.mjs --with-ee  include routes mounted by the EE folder (off by default)
//
// The schema is produced offline: the FastAPI app is imported and app.openapi()
// is dumped, no server or database needed. Python is resolved in this order:
//   1. $LEARNHOUSE_API_PYTHON
//   2. apps/api/.venv/bin/python
//   3. `uv run --frozen --project apps/api python` (venv kept in packages/sdk/.cache)

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const sdkDir = resolve(here, '..')
const repoRoot = resolve(sdkDir, '..', '..')
const apiDir = join(repoRoot, 'apps', 'api')
const openapiOut = join(sdkDir, 'openapi.json')
const schemaOut = join(sdkDir, 'src', 'generated', 'schema.ts')

// Route prefixes that are not part of the public API surface.
const EXCLUDED_PREFIXES = [
  '/api/v1/internal',
  '/api/v1/cloud_internal',
  '/api/v1/dev',
  '/api/v1/demo',
  '/api/v1/ee',
  '/api/v1/admin',
]

const args = process.argv.slice(2)
const check = args.includes('--check')
const withEe = args.includes('--with-ee')
const fromIdx = args.indexOf('--from')
const fromFile = fromIdx >= 0 ? resolve(process.cwd(), args[fromIdx + 1] ?? '') : null

function fail(msg) {
  console.error(`[generate] ${msg}`)
  process.exit(1)
}

function resolvePython() {
  if (process.env.LEARNHOUSE_API_PYTHON) {
    return { cmd: process.env.LEARNHOUSE_API_PYTHON, prefix: [], env: {} }
  }
  const venvPython = join(apiDir, '.venv', 'bin', 'python')
  if (existsSync(venvPython)) return { cmd: venvPython, prefix: [], env: {} }
  const uv = spawnSync('uv', ['--version'], { encoding: 'utf8' })
  if (uv.status === 0) {
    return {
      cmd: 'uv',
      prefix: ['run', '--quiet', '--frozen', '--project', apiDir, 'python'],
      env: { UV_PROJECT_ENVIRONMENT: join(sdkDir, '.cache', 'api-venv') },
    }
  }
  fail(
    'No Python found for apps/api. Set LEARNHOUSE_API_PYTHON, create apps/api/.venv, or install uv.',
  )
}

function dumpSchemaFromSource() {
  const work = mkdtempSync(join(tmpdir(), 'lh-sdk-openapi-'))
  const out = join(work, 'openapi.raw.json')
  const py = resolvePython()
  const code = [
    'import json, sys',
    'from app import app',
    'json.dump(app.openapi(), open(sys.argv[1], "w"))',
  ].join('\n')

  // A minimal, explicit environment keeps the output independent of whatever
  // LEARNHOUSE_* variables the developer happens to have exported (deployment
  // mode, dev mode, ...), so `--check` gives the same answer locally and in CI.
  const passthrough = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'SYSTEMROOT', 'UV_CACHE_DIR']
  const env = {}
  for (const k of passthrough) if (process.env[k] !== undefined) env[k] = process.env[k]
  Object.assign(env, py.env, {
    PYTHONDONTWRITEBYTECODE: '1',
    // Only used to satisfy config validation at import time; never a real secret.
    LEARNHOUSE_AUTH_JWT_SECRET_KEY: 'openapi-schema-generation-only-not-a-secret',
  })
  if (!withEe) env.LEARNHOUSE_DISABLE_EE = '1'

  const res = spawnSync(py.cmd, [...py.prefix, '-c', code, out], {
    cwd: apiDir,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (res.status !== 0 || !existsSync(out)) {
    console.error(res.stdout)
    console.error(res.stderr)
    fail(`schema dump failed (python: ${py.cmd})`)
  }
  const raw = JSON.parse(readFileSync(out, 'utf8'))
  rmSync(work, { recursive: true, force: true })
  return raw
}

function isExcluded(path) {
  return EXCLUDED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))
}

function collectRefs(node, into) {
  if (Array.isArray(node)) {
    for (const v of node) collectRefs(v, into)
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref' && typeof v === 'string') into.add(v)
      else collectRefs(v, into)
    }
  }
}

function filterSchema(raw) {
  const paths = {}
  for (const [p, item] of Object.entries(raw.paths ?? {})) {
    if (!isExcluded(p)) paths[p] = item
  }

  // Drop component schemas that only excluded routes referenced.
  const all = raw.components?.schemas ?? {}
  const keep = new Set()
  const queue = new Set()
  collectRefs(paths, queue)
  while (queue.size) {
    const [ref] = queue
    queue.delete(ref)
    const m = /^#\/components\/schemas\/(.+)$/.exec(ref)
    if (!m || keep.has(m[1])) continue
    keep.add(m[1])
    const nested = new Set()
    collectRefs(all[m[1]], nested)
    for (const r of nested) queue.add(r)
  }
  const schemas = {}
  for (const name of Object.keys(all)) if (keep.has(name)) schemas[name] = all[name]

  return {
    ...raw,
    paths,
    components: { ...raw.components, schemas },
  }
}

async function toTypeScript(schema) {
  const { default: openapiTS, astToString } = await import('openapi-typescript')
  const ast = await openapiTS(schema, {
    // A field with a server-side default may still be omitted by the caller,
    // so do not promote defaulted fields to required.
    defaultNonNullable: false,
    alphabetize: false,
  })
  const header = [
    '/**',
    ' * This file is generated by scripts/generate.mjs from the LearnHouse API',
    ` * OpenAPI schema (API version ${schema.info?.version ?? 'unknown'}). Do not edit it by hand.`,
    ' */',
    '',
  ].join('\n')
  return header + astToString(ast)
}

const raw = fromFile ? JSON.parse(readFileSync(fromFile, 'utf8')) : dumpSchemaFromSource()
const filtered = filterSchema(raw)
const openapiText = `${JSON.stringify(filtered, null, 2)}\n`
const schemaText = await toTypeScript(filtered)

const sdkVersion = JSON.parse(readFileSync(join(sdkDir, 'package.json'), 'utf8')).version
if (filtered.info?.version && filtered.info.version !== sdkVersion) {
  console.warn(
    `[generate] warning: API reports version ${filtered.info.version}, SDK package.json is ${sdkVersion}. Run \`bun run sync-version\`.`,
  )
}

const opCount = Object.values(filtered.paths).reduce(
  (n, item) => n + Object.keys(item).filter((m) => ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(m)).length,
  0,
)

if (check) {
  const stale = []
  if (!existsSync(openapiOut) || readFileSync(openapiOut, 'utf8') !== openapiText) stale.push('openapi.json')
  if (!existsSync(schemaOut) || readFileSync(schemaOut, 'utf8') !== schemaText) stale.push('src/generated/schema.ts')
  if (stale.length) {
    fail(`generated output is stale: ${stale.join(', ')}. Run \`bun run generate\` and commit the result.`)
  }
  console.log(`[generate] up to date (${opCount} operations)`)
} else {
  mkdirSync(dirname(schemaOut), { recursive: true })
  writeFileSync(openapiOut, openapiText)
  writeFileSync(schemaOut, schemaText)
  console.log(
    `[generate] wrote openapi.json and src/generated/schema.ts (${Object.keys(filtered.paths).length} paths, ${opCount} operations, ${Object.keys(filtered.components.schemas).length} schemas)`,
  )
}
