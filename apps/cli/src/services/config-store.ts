import fs from 'node:fs'
import os from 'node:os'
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

export function listInstallations(): { name: string; dir: string; config: LearnHouseConfigJson }[] {
  const baseDir = path.join(os.homedir(), '.learnhouse')
  if (!fs.existsSync(baseDir)) return []

  const results: { name: string; dir: string; config: LearnHouseConfigJson }[] = []
  try {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const dir = path.join(baseDir, entry.name)
      if (isCompleteInstall(dir)) {
        const config = JSON.parse(fs.readFileSync(path.join(dir, CONFIG_FILENAME), 'utf-8'))
        results.push({ name: entry.name, dir, config })
      }
    }
  } catch { /* permission errors */ }

  // Sort by most recent first
  results.sort((a, b) => (b.config.createdAt || '').localeCompare(a.config.createdAt || ''))
  return results
}

export function findInstallDir(): string {
  const baseDir = path.join(os.homedir(), '.learnhouse')
  const defaultDir = path.join(baseDir, 'default')

  // 1. If only one installation exists, use it
  const installations = listInstallations()
  if (installations.length === 1) return installations[0].dir

  // 2. Check default installation
  if (isCompleteInstall(defaultDir)) return defaultDir

  // 3. Use the most recent installation
  if (installations.length > 0) return installations[0].dir

  // 4. Fallback: check CWD for legacy installs
  const cwd = process.cwd()
  if (isCompleteInstall(cwd)) return cwd

  // No installation found — return cwd so readConfig returns null
  return process.cwd()
}
