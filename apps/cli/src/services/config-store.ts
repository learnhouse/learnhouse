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
  // Prefer complete installs (has deploymentId + .env), most recent first
  const completeInstalls = candidates.filter(isCompleteInstall)
  if (completeInstalls.length > 0) {
    // Sort by createdAt descending so the newest deployment wins
    completeInstalls.sort((a, b) => {
      try {
        const configA = JSON.parse(fs.readFileSync(path.join(a, CONFIG_FILENAME), 'utf-8'))
        const configB = JSON.parse(fs.readFileSync(path.join(b, CONFIG_FILENAME), 'utf-8'))
        return (configB.createdAt || '').localeCompare(configA.createdAt || '')
      } catch {
        return 0
      }
    })
    return completeInstalls[0]
  }
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

  // 4. Walk up the directory tree — prefer complete installs
  let current = cwd
  let fallbackDir: string | null = null
  while (true) {
    const parent = path.dirname(current)
    if (parent === current) break // reached root
    if (isCompleteInstall(parent)) return parent
    const parentSub = path.join(parent, 'learnhouse')
    if (isCompleteInstall(parentSub)) return parentSub
    // Remember first dir with any config as fallback
    if (!fallbackDir && fs.existsSync(path.join(parent, CONFIG_FILENAME))) {
      fallbackDir = parent
    }
    current = parent
  }
  if (fallbackDir) return fallbackDir

  return cwd
}
