import * as p from '@clack/prompts'
import pc from 'picocolors'
import { findInstallDir, readConfig } from '../services/config-store.js'
import { dockerComposeStop } from '../services/docker.js'

export async function stopCommand() {
  const dir = findInstallDir()
  const config = readConfig(dir)
  if (!config) {
    p.log.error('No LearnHouse installation found. Run `npx learnhouse setup` first.')
    process.exit(1)
  }

  p.intro(pc.cyan('Stopping LearnHouse'))
  try {
    // `stop`, not `down`: containers are kept, so `start` resumes them as they
    // were. `down` deletes them, and on installs from before the content volume
    // existed that also deleted every uploaded file in the container.
    dockerComposeStop(config.installDir)
    p.log.success('LearnHouse stopped.')
  } catch {
    p.log.error('Failed to stop services. Check Docker output above.')
    process.exit(1)
  }
}
