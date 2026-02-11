import * as p from '@clack/prompts'
import pc from 'picocolors'
import { findInstallDir, readConfig } from '../services/config-store.js'
import { dockerComposePull, dockerComposeDown, dockerComposeUp } from '../services/docker.js'

export async function updateCommand() {
  const dir = findInstallDir()
  const config = readConfig(dir)
  if (!config) {
    p.log.error('No LearnHouse installation found in the current directory.')
    process.exit(1)
  }

  p.intro(pc.cyan('Updating LearnHouse'))

  const s = p.spinner()
  try {
    s.start('Pulling latest images')
    dockerComposePull(config.installDir)
    s.stop('Images pulled')

    s.start('Restarting services')
    dockerComposeDown(config.installDir)
    dockerComposeUp(config.installDir)
    s.stop('Services restarted')

    p.log.success('LearnHouse has been updated!')
  } catch {
    s.stop('Update failed')
    p.log.error('Failed to update. Check Docker output above.')
    process.exit(1)
  }
}
