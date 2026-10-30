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
