import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import pc from 'picocolors'
import { CONFIG_FILENAME, VERSION } from '../constants.js'
import { isDeploymentRunning } from './docker.js'
import { writeFileAtomic } from '../utils/fs-atomic.js'
import type { LearnHouseConfigJson, SetupConfig } from '../types.js'

/**
 * Deployment ids become compose project names, volume names and container
 * names, so they must stay in compose's own charset. A config file that says
 * otherwise was not written by this CLI and is refused.
 */
const DEPLOYMENT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/

export function isValidDeploymentId(id: unknown): id is string {
  return typeof id === 'string' && DEPLOYMENT_ID_RE.test(id)
}

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
    orgSlug: config.orgSlug || 'default',
    channel: config.channel,
    edition: config.edition || 'community',
    ...(config.edition === 'enterprise'
      ? {
          eeTenancy: config.eeTenancy || 'single',
          eeLocalTls: !!config.eeLocalTls,
          ...(config.dnsProvider ? { dnsProvider: config.dnsProvider } : {}),
          ...(config.dockerIpv6 ? { dockerIpv6: true } : {}),
        }
      : {}),
  }
  writeFileAtomic(
    path.join(config.installDir, CONFIG_FILENAME),
    JSON.stringify(data, null, 2) + '\n',
  )
}

/** Merge fields into an existing learnhouse.config.json (e.g. after `env` changes the port). */
export function updateConfig(dir: string, patch: Partial<LearnHouseConfigJson>): void {
  const current = readConfig(dir)
  if (!current) return
  writeFileAtomic(
    path.join(dir, CONFIG_FILENAME),
    JSON.stringify({ ...current, ...patch }, null, 2) + '\n',
  )
}

export function readConfig(dir?: string): LearnHouseConfigJson | null {
  const configPath = path.join(dir || process.cwd(), CONFIG_FILENAME)
  if (!fs.existsSync(configPath)) return null
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as LearnHouseConfigJson
    if (config.deploymentId !== undefined && !isValidDeploymentId(config.deploymentId)) {
      console.error(pc.yellow(`Ignoring ${configPath}: invalid deploymentId.`))
      return null
    }
    // Trust where the file actually is over the path recorded at setup: a
    // copied or moved install would otherwise act on the original location.
    config.installDir = path.resolve(dir || process.cwd())
    return config
  } catch {
    return null
  }
}

function isCompleteInstall(dir: string): boolean {
  const config = readConfig(dir)
  return !!config?.deploymentId && fs.existsSync(path.join(dir, '.env'))
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
        results.push({ name: entry.name, dir, config: readConfig(dir)! })
      }
    }
  } catch { /* permission errors */ }

  // Sort by most recent first
  results.sort((a, b) => (b.config.createdAt || '').localeCompare(a.config.createdAt || ''))
  return results
}

/**
 * Which install a command acts on, in order:
 *   1. `--dir <path>` / LEARNHOUSE_DIR
 *   2. the current directory, when it holds an install
 *   3. the only install under ~/.learnhouse
 *   4. the only *running* install, else the most recent one (with a notice,
 *      since that is a guess)
 */
export function findInstallDir(): string {
  const override = process.env.LEARNHOUSE_DIR
  if (override) return path.resolve(override)

  const cwd = process.cwd()
  if (isCompleteInstall(cwd)) return cwd

  const installations = listInstallations()
  if (installations.length === 1) return installations[0].dir

  if (installations.length > 1) {
    const running = installations.filter((i) => isDeploymentRunning(i.config.deploymentId))
    if (running.length === 1) return running[0].dir
    const chosen = running[0] ?? installations[0]
    const names = installations.map((i) => i.name).join(', ')
    console.error(pc.dim(
      `Multiple installations found (${names}); using "${path.basename(chosen.dir)}". ` +
      'Pass --dir <path> to choose another.',
    ))
    return chosen.dir
  }

  return cwd
}
