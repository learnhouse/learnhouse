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

export function findInstallDir(): string {
  // Check current dir, then look for learnhouse.config.json
  const cwd = process.cwd()
  if (fs.existsSync(path.join(cwd, CONFIG_FILENAME))) return cwd
  const subDir = path.join(cwd, 'learnhouse')
  if (fs.existsSync(path.join(subDir, CONFIG_FILENAME))) return subDir
  return cwd
}
