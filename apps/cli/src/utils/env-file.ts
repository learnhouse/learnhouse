import fs from 'node:fs'
import path from 'node:path'
import { quoteEnvValue } from './env-quote.js'
import { writeFileAtomic } from './fs-atomic.js'

function keyPattern(key: string): string {
  return key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Undo `quoteEnvValue`: strip single quotes (literal) or double quotes (with `\\` / `\"` escapes). */
export function unquoteEnvValue(raw: string): string {
  const v = raw.trim()
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1)
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    return v.slice(1, -1).replace(/\\(["\\])/g, '$1')
  }
  return v
}

export function readEnvVar(installDir: string, key: string): string | undefined {
  const envPath = path.join(installDir, '.env')
  if (!fs.existsSync(envPath)) return undefined
  const m = fs.readFileSync(envPath, 'utf-8').match(new RegExp(`^${keyPattern(key)}=(.*)$`, 'm'))
  if (!m) return undefined
  return unquoteEnvValue(m[1])
}

/**
 * Set one key in the install's .env, quoting the value so compose keeps it
 * literal. Written atomically; the file keeps its (0600) permissions.
 */
export function setEnvVar(installDir: string, key: string, value: string): void {
  if (/[\r\n]/.test(value)) throw new Error(`${key}: value must be a single line`)
  const envPath = path.join(installDir, '.env')
  let txt = fs.readFileSync(envPath, 'utf-8')
  const line = `${key}=${quoteEnvValue(value)}`
  const re = new RegExp(`^${keyPattern(key)}=.*$`, 'm')
  if (re.test(txt)) {
    txt = txt.replace(re, () => line)
  } else {
    txt += (txt.endsWith('\n') ? '' : '\n') + `${line}\n`
  }
  writeFileAtomic(envPath, txt)
}

/** Keys the setup wizard's "Optional Features" step owns (AI, email, S3, OAuth). */
export const FEATURE_ENV_KEYS = [
  'LEARNHOUSE_GEMINI_API_KEY', 'LEARNHOUSE_IS_AI_ENABLED',
  'LEARNHOUSE_EMAIL_PROVIDER', 'LEARNHOUSE_SYSTEM_EMAIL_ADDRESS', 'LEARNHOUSE_RESEND_API_KEY',
  'LEARNHOUSE_SMTP_HOST', 'LEARNHOUSE_SMTP_PORT', 'LEARNHOUSE_SMTP_USERNAME',
  'LEARNHOUSE_SMTP_PASSWORD', 'LEARNHOUSE_SMTP_USE_TLS',
  'LEARNHOUSE_CONTENT_DELIVERY_TYPE', 'LEARNHOUSE_S3_API_BUCKET_NAME', 'LEARNHOUSE_S3_API_ENDPOINT_URL',
  'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_DEFAULT_REGION', 'LEARNHOUSE_S3_API_REGION',
  'LEARNHOUSE_GOOGLE_CLIENT_ID', 'LEARNHOUSE_GOOGLE_CLIENT_SECRET',
]

/** Keys older CLIs wrote that are no longer used and must not be carried forward. */
const RETIRED_ENV_KEYS = new Set(['LEARNHOUSE_COOKIE_DOMAIN'])

function envLines(content: string): Map<string, string> {
  const lines = new Map<string, string>()
  for (const line of content.split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/)
    if (m) lines.set(m[1], line)
  }
  return lines
}

/**
 * Merge a freshly generated .env with the one it replaces, so re-running setup
 * never drops settings. Keys the new file does not write are kept as they
 * were (for example a hand-added AI provider). Keys in `keepExisting` keep
 * their previous value even when the new file writes them: `setup --ci` has
 * no prompts for features, so it must not switch them off.
 */
export function mergeEnvContent(generated: string, previous: string, keepExisting: Iterable<string> = []): string {
  const prev = envLines(previous)
  const keep = new Set(keepExisting)
  const gen = envLines(generated)
  const groupOf = (key: string) => FEATURE_ENV_KEYS.includes(key) ? 'feature' : 'other'

  let out = generated.split('\n').map((line) => {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/)
    return m && keep.has(m[1]) && prev.has(m[1]) ? prev.get(m[1])! : line
  }).join('\n')

  const carried: string[] = []
  for (const [key, line] of prev) {
    if (gen.has(key) || RETIRED_ENV_KEYS.has(key)) continue
    // A feature key the new file leaves out was switched off, unless it is kept.
    if (groupOf(key) === 'feature' && !keep.has(key)) continue
    carried.push(line)
  }
  if (carried.length) {
    if (!out.endsWith('\n')) out += '\n'
    out += [
      '',
      '# =============================================================================',
      '# Kept from the previous configuration',
      '# =============================================================================',
      '',
      ...carried,
      '',
    ].join('\n')
  }
  return out
}
