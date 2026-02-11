import * as p from '@clack/prompts'
import { findInstallDir, readConfig } from '../services/config-store.js'
import { dockerComposeLogs } from '../services/docker.js'

export async function logsCommand() {
  const dir = findInstallDir()
  const config = readConfig(dir)
  if (!config) {
    p.log.error('No LearnHouse installation found in the current directory.')
    process.exit(1)
  }

  p.log.info('Streaming logs (Ctrl+C to stop)...')
  dockerComposeLogs(config.installDir)
}
