import * as p from '@clack/prompts'
import pc from 'picocolors'
import { findInstallDir, readConfig } from '../services/config-store.js'
import { dockerComposeUp } from '../services/docker.js'

export async function startCommand() {
  const dir = findInstallDir()
  const config = readConfig(dir)
  if (!config) {
    p.log.error('No LearnHouse installation found in the current directory.')
    p.log.info('Run `npx learnhouse` to set up a new installation.')
    process.exit(1)
  }

  p.intro(pc.cyan('Starting LearnHouse'))
  try {
    dockerComposeUp(config.installDir)
    p.log.success('LearnHouse is running!')
  } catch {
    p.log.error('Failed to start services. Check Docker output above.')
    process.exit(1)
  }
}
