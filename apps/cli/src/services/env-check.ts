import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import * as p from '@clack/prompts'
import pc from 'picocolors'

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

interface EnvVar {
  name: string
  description: string
  /** Static string or factory (e.g. to generate a secret). */
  defaultValue: string | (() => string)
  /** If true, the var has NO usable fallback in config.yaml — app won't work without it. */
  required: boolean
}

interface AppEnvSpec {
  label: string
  /** Relative to project root. */
  envFile: string
  vars: EnvVar[]
}

// ────────────────────────────────────────────────────────────────────────────
// Defaults
// ────────────────────────────────────────────────────────────────────────────

function generateJwtSecret(): string {
  return crypto.randomBytes(32).toString('base64url')
}

/**
 * Only vars that are truly required for dev and have NO working yaml fallback.
 *
 * Most API vars fall back to config.yaml which ships sensible localhost
 * defaults — those are intentionally omitted here.
 */
const API_ENV: AppEnvSpec = {
  label: 'API',
  envFile: 'apps/api/.env',
  vars: [
    {
      name: 'LEARNHOUSE_AUTH_JWT_SECRET_KEY',
      required: true,
      description: 'JWT signing secret (min 32 chars)',
      defaultValue: generateJwtSecret,
    },
    {
      name: 'COLLAB_INTERNAL_KEY',
      required: true,
      description: 'Shared key for collab ↔ API auth',
      defaultValue: 'dev-collab-internal-key-change-in-prod',
    },
  ],
}

const WEB_ENV: AppEnvSpec = {
  label: 'Web',
  envFile: 'apps/web/.env.local',
  vars: [
    {
      name: 'NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL',
      required: true,
      description: 'Backend API URL',
      defaultValue: 'http://localhost:1338/',
    },
  ],
}

const COLLAB_ENV: AppEnvSpec = {
  label: 'Collab',
  envFile: 'apps/collab/.env',
  vars: [
    {
      name: 'COLLAB_PORT',
      required: true,
      description: 'WebSocket server port',
      defaultValue: '4000',
    },
    {
      name: 'LEARNHOUSE_API_URL',
      required: true,
      description: 'LearnHouse API base URL',
      defaultValue: 'http://localhost:1338',
    },
    {
      name: 'LEARNHOUSE_AUTH_JWT_SECRET_KEY',
      required: true,
      description: 'JWT secret (must match API)',
      defaultValue: '', // filled from API value at write-time
    },
    {
      name: 'COLLAB_INTERNAL_KEY',
      required: true,
      description: 'Internal key (must match API)',
      defaultValue: '', // filled from API value at write-time
    },
  ],
}

const ALL_APPS = [API_ENV, WEB_ENV, COLLAB_ENV]

// ────────────────────────────────────────────────────────────────────────────
// Env file helpers
// ────────────────────────────────────────────────────────────────────────────

function parseEnvFile(filePath: string): Map<string, string> {
  const vars = new Map<string, string>()
  if (!fs.existsSync(filePath)) return vars

  for (const line of fs.readFileSync(filePath, 'utf-8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue

    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()

    // Strip quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    // Strip inline comments
    const cIdx = value.indexOf(' #')
    if (cIdx !== -1) value = value.slice(0, cIdx).trim()

    vars.set(key, value)
  }
  return vars
}

/** Append new vars to the end of an env file (preserves existing content). */
function appendToEnvFile(filePath: string, newVars: Map<string, string>): void {
  let content = ''
  if (fs.existsSync(filePath)) {
    content = fs.readFileSync(filePath, 'utf-8')
    if (content.length > 0 && !content.endsWith('\n')) content += '\n'
  }

  for (const [key, value] of newVars) {
    content += `${key}=${value}\n`
  }

  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(filePath, content)
}

function resolveDefault(v: EnvVar): string {
  return typeof v.defaultValue === 'function' ? v.defaultValue() : v.defaultValue
}

// ────────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────────

interface Missing {
  app: AppEnvSpec
  envVar: EnvVar
}

/**
 * Scan every app's env file for required variables. If anything is missing,
 * show the list and offer to write sensible dev defaults.
 *
 * Returns `true` when ready to continue, `false` if the user aborted.
 */
export async function checkDevEnv(root: string): Promise<boolean> {
  // Collect missing vars
  const missing: Missing[] = []

  for (const app of ALL_APPS) {
    const existing = parseEnvFile(path.join(root, app.envFile))
    for (const v of app.vars) {
      const val = existing.get(v.name)
      if (v.required && (!val || val.length === 0)) {
        missing.push({ app, envVar: v })
      }
    }
  }

  if (missing.length === 0) {
    p.log.success('Environment files look good')
    return true
  }

  // ── Display ────────────────────────────────────────────────────────────
  p.log.warning(`Found ${missing.length} missing env variable${missing.length > 1 ? 's' : ''}:`)
  console.log()

  const byApp = new Map<string, Missing[]>()
  for (const m of missing) {
    const list = byApp.get(m.app.label) ?? []
    list.push(m)
    byApp.set(m.app.label, list)
  }

  for (const [label, vars] of byApp) {
    console.log(`  ${pc.bold(label)} ${pc.dim(`(${vars[0].app.envFile})`)}`)
    for (const m of vars) {
      console.log(`    ${pc.red('✗')} ${pc.cyan(m.envVar.name)} — ${pc.dim(m.envVar.description)}`)
    }
    console.log()
  }

  // ── Prompt ─────────────────────────────────────────────────────────────
  const action = await p.select({
    message: 'How would you like to proceed?',
    options: [
      { value: 'defaults', label: 'Apply dev defaults and continue', hint: 'writes only the missing vars' },
      { value: 'abort', label: "Abort — I'll set them up manually" },
    ],
  })

  if (p.isCancel(action) || action === 'abort') {
    p.log.info('Set the missing variables and run the command again.')
    return false
  }

  // ── Resolve shared secrets ─────────────────────────────────────────────
  // Generate JWT secret & collab key once, share across API + Collab.
  const apiFile = path.join(root, API_ENV.envFile)
  const apiExisting = parseEnvFile(apiFile)

  const jwtSecret = apiExisting.get('LEARNHOUSE_AUTH_JWT_SECRET_KEY') || generateJwtSecret()
  const collabKey = apiExisting.get('COLLAB_INTERNAL_KEY') || 'dev-collab-internal-key-change-in-prod'

  // ── Write ──────────────────────────────────────────────────────────────
  for (const app of ALL_APPS) {
    const filePath = path.join(root, app.envFile)
    const existing = parseEnvFile(filePath)
    const toWrite = new Map<string, string>()

    for (const v of app.vars) {
      const val = existing.get(v.name)
      if (!v.required || (val && val.length > 0)) continue

      if (v.name === 'LEARNHOUSE_AUTH_JWT_SECRET_KEY') {
        toWrite.set(v.name, jwtSecret)
      } else if (v.name === 'COLLAB_INTERNAL_KEY') {
        toWrite.set(v.name, collabKey)
      } else {
        toWrite.set(v.name, resolveDefault(v))
      }
    }

    if (toWrite.size > 0) {
      appendToEnvFile(filePath, toWrite)
      const names = [...toWrite.keys()].map(k => pc.cyan(k)).join(', ')
      p.log.success(`${pc.bold(app.label)}: wrote ${names} → ${pc.dim(app.envFile)}`)
    }
  }

  console.log()
  return true
}
