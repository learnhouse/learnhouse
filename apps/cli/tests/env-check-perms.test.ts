import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Logs are no-ops and the "missing vars" prompt always picks "apply dev defaults".
vi.mock('@clack/prompts', () => {
  const noop = () => {}
  return {
    log: { error: noop, info: noop, success: noop, warn: noop, warning: noop, message: noop, step: noop },
    select: async () => 'defaults',
    isCancel: () => false,
  }
})

import { checkDevEnv } from '../src/services/env-check.js'

const ENV_FILES = ['apps/api/.env', 'apps/web/.env.local', 'apps/collab/.env']
const modeOf = (file: string) => fs.statSync(file).mode & 0o777

describe.skipIf(process.platform === 'win32')('checkDevEnv file permissions', () => {
  let root: string
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-env-perms-'))
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('creates generated env files (which hold secrets) as owner-only', async () => {
    expect(await checkDevEnv(root)).toBe(true)
    for (const rel of ENV_FILES) {
      expect(modeOf(path.join(root, rel))).toBe(0o600)
    }
    expect(fs.readFileSync(path.join(root, 'apps/api/.env'), 'utf-8')).toMatch(/^LEARNHOUSE_AUTH_JWT_SECRET_KEY=.{32,}$/m)
  })

  it('tightens an existing world-readable env file when appending secrets to it', async () => {
    const apiEnv = path.join(root, 'apps/api/.env')
    fs.mkdirSync(path.dirname(apiEnv), { recursive: true })
    fs.writeFileSync(apiEnv, 'EXISTING=1\n', { mode: 0o644 })
    fs.chmodSync(apiEnv, 0o644)

    expect(await checkDevEnv(root)).toBe(true)
    expect(modeOf(apiEnv)).toBe(0o600)
    expect(fs.readFileSync(apiEnv, 'utf-8')).toMatch(/^EXISTING=1\nLEARNHOUSE_AUTH_JWT_SECRET_KEY=/)
  })
})
