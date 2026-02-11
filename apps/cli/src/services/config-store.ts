import fs from 'node:fs'
import path from 'node:path'
import { CONFIG_FILENAME, VERSION } from '../constants.js'
import type { LearnHouseConfigJson, SetupConfig } from '../types.js'

export function writeConfig(config: SetupConfig): void {
  const data: LearnHouseConfigJson = {
    version: VERSION,
    deploymentId: config.deploymentId,
    createdAt: new Date().toISOString(),
    installDir: config.installDir,
    domain: config.domain,
    httpPort: config.httpPort,
    useHttps: config.useHttps,
    autoSsl: config.autoSsl,
    useExternalDb: config.useExternalDb,
    orgSlug: 'default',
  }
  fs.writeFileSync(
    path.join(config.installDir, CONFIG_FILENAME),
    JSON.stringify(data, null, 2) + '\n',
  )
}

export function readConfig(dir?: string): LearnHouseConfigJson | null {
  const configPath = path.join(dir || process.cwd(), CONFIG_FILENAME)
  if (!fs.existsSync(configPath)) return null
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  } catch {
    return null
  }
}

function isCompleteInstall(dir: string): boolean {
  const configPath = path.join(dir, CONFIG_FILENAME)
  if (!fs.existsSync(configPath)) return false
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    return !!config.deploymentId && fs.existsSync(path.join(dir, '.env'))
  } catch {
    return false
  }
}

function collectCandidates(dir: string, depth: number, results: string[]): void {
  if (depth < 0) return
  if (fs.existsSync(path.join(dir, CONFIG_FILENAME))) {
    results.push(dir)
  }
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'backups') continue
      collectCandidates(path.join(dir, entry.name), depth - 1, results)
    }
  } catch { /* permission errors, etc. */ }
}

function pickBest(candidates: string[]): string | null {
  if (candidates.length === 0) return null
  // Prefer complete installs (has deploymentId + .env)
  const complete = candidates.find(isCompleteInstall)
  if (complete) return complete
  return candidates[0]
}

export function findInstallDir(): string {
  const cwd = process.cwd()

  // 1. Check CWD directly
  if (isCompleteInstall(cwd)) return cwd

  // 2. Check ./learnhouse (default install dir)
  const subDir = path.join(cwd, 'learnhouse')
  if (isCompleteInstall(subDir)) return subDir

  // 3. Search downward from CWD, prefer complete installs
  const candidates: string[] = []
  collectCandidates(cwd, 10, candidates)
  const best = pickBest(candidates)
  if (best) return best

  // 4. Walk up the directory tree
  let current = cwd
  while (true) {
    const parent = path.dirname(current)
    if (parent === current) break // reached root
    if (isCompleteInstall(parent)) return parent
    const parentSub = path.join(parent, 'learnhouse')
    if (isCompleteInstall(parentSub)) return parentSub
    // Fall back to any config
    if (fs.existsSync(path.join(parent, CONFIG_FILENAME))) return parent
    current = parent
  }

  return cwd
}
