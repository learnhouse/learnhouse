import * as p from '@clack/prompts'
import pc from 'picocolors'
import { findInstallDir, readConfig } from '../services/config-store.js'
import { dockerComposePs } from '../services/docker.js'

export async function statusCommand() {
  const dir = findInstallDir()
  const config = readConfig(dir)
  if (!config) {
    p.log.error('No LearnHouse installation found. Run `npx learnhouse setup` first.')
    process.exit(1)
  }

  p.intro(pc.cyan('LearnHouse Status'))

  const protocol = config.useHttps ? 'https' : 'http'
  const portSuffix = (config.useHttps && config.httpPort === 443) || (!config.useHttps && config.httpPort === 80) ? '' : `:${config.httpPort}`
  p.log.info(`URL: ${protocol}://${config.domain}${portSuffix}`)

  try {
    const output = dockerComposePs(config.installDir)
    console.log(output)
  } catch {
    p.log.error('Failed to get status. Is Docker running?')
    process.exit(1)
  }
}
