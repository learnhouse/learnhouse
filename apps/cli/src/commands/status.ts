import * as p from '@clack/prompts'
import pc from 'picocolors'
import { findInstallDir, readConfig } from '../services/config-store.js'
import { dockerComposePs } from '../services/docker.js'
import { publicUrl } from '../services/stack.js'

export async function statusCommand() {
  const dir = findInstallDir()
  const config = readConfig(dir)
  if (!config) {
    p.log.error('No LearnHouse installation found. Run `npx learnhouse setup` first.')
    process.exit(1)
  }

  p.intro(pc.cyan('LearnHouse Status'))

  p.log.info(`URL: ${publicUrl(config)}`)

  try {
    const output = dockerComposePs(config.installDir)
    console.log(output)
  } catch {
    p.log.error('Failed to get status. Is Docker running?')
    process.exit(1)
  }
}
