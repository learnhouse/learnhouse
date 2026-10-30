import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Runs the real script against a throwaway package root (BUMP_VERSION_ROOT),
// never the CLI's own package.json / constants.ts.
const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'bump-version.js')

describe('bump-version.js', () => {
  let root: string
  const pkgPath = () => path.join(root, 'package.json')
  const constPath = () => path.join(root, 'src', 'constants.ts')

  function seed(version: string, constants = `export const VERSION = '${version}'\nexport const OTHER = 1\n`) {
    fs.writeFileSync(pkgPath(), JSON.stringify({ name: 'learnhouse', version }, null, 2) + '\n')
    fs.writeFileSync(constPath(), constants)
  }

  function bump(arg?: string) {
    const r = spawnSync(process.execPath, [SCRIPT, ...(arg ? [arg] : [])], {
      env: { ...process.env, BUMP_VERSION_ROOT: root },
      encoding: 'utf-8',
    })
    return { status: r.status, out: `${r.stdout}${r.stderr}` }
  }

  const pkgVersion = () => JSON.parse(fs.readFileSync(pkgPath(), 'utf-8')).version
  const constVersion = () => fs.readFileSync(constPath(), 'utf-8').match(/export const VERSION = '([^']+)'/)?.[1]

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-bump-'))
    fs.mkdirSync(path.join(root, 'src'))
  })
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }) })

  it.each([
    ['1.5.1', undefined, '1.5.2'], // default is patch
    ['1.5.1', 'patch', '1.5.2'],
    ['1.5.1', 'minor', '1.6.0'],
    ['1.5.1', 'major', '2.0.0'],
    ['1.5.1-beta.1', 'patch', '1.5.1'],
    ['1.5.1-beta.1', 'minor', '1.6.0'],
    ['1.5.1-beta.1', 'major', '2.0.0'],
    ['1.6.0-rc.1', 'minor', '1.6.0'],
    ['1.6.0-rc.1', 'major', '2.0.0'],
    ['2.0.0-rc.1', 'major', '2.0.0'],
    ['1.5.1', '1.6.0', '1.6.0'],
    ['1.5.1', '1.6.0-beta.2', '1.6.0-beta.2'],
  ])('%s + %s -> %s, in both files', (from, arg, to) => {
    seed(from)
    const r = bump(arg)
    expect(r.status, r.out).toBe(0)
    expect(pkgVersion()).toBe(to)
    expect(constVersion()).toBe(to)
    expect(r.out).toContain(`${from} → ${to}`)
    expect(fs.readFileSync(constPath(), 'utf-8')).toContain('export const OTHER = 1') // rest untouched
  })

  it.each(['1.6.0junk', 'v1.6.0', '1.6', '1.6.0-', 'latest'])('rejects explicit version %s without touching files', (arg) => {
    seed('1.5.1')
    const r = bump(arg)
    expect(r.status).toBe(1)
    expect(r.out).toContain('Invalid version bump')
    expect(pkgVersion()).toBe('1.5.1')
    expect(constVersion()).toBe('1.5.1')
  })

  it('fails without writing anything when constants.ts has no VERSION constant', () => {
    seed('1.5.1', 'export const VERSION = "1.5.1"\n') // double quotes: pattern no longer matches
    const r = bump('minor')
    expect(r.status).toBe(1)
    expect(r.out).toContain('Could not find')
    expect(pkgVersion()).toBe('1.5.1')
  })

  it('fails when the current package.json version is not semver', () => {
    seed('not-a-version')
    const r = bump('patch')
    expect(r.status).toBe(1)
    expect(r.out).toContain('not valid semver')
    expect(pkgVersion()).toBe('not-a-version')
  })
})
