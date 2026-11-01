import * as p from '@clack/prompts'
import pc from 'picocolors'
import { findInstallDir, readConfig } from '../services/config-store.js'
import { dockerComposeUp } from '../services/docker.js'
import { migrateContentVolume } from '../services/content-volume-migration.js'

export async function startCommand() {
  const dir = findInstallDir()
  const config = readConfig(dir)
  if (!config) {
    p.log.error('No LearnHouse installation found. Run `npx learnhouse setup` first.')
    process.exit(1)
  }

  p.intro(pc.cyan('Starting LearnHouse'))

  // Community only: Enterprise always mounted its content volume.
  if (config.edition !== 'enterprise') {
    try {
      const result = migrateContentVolume(config.installDir, config.deploymentId)
      if (result.status === 'migrated') {
        p.log.success('Preserved existing uploaded content into a persistent volume.')
      } else if (result.status === 'patched_no_data') {
        p.log.info('Added persistent content volume to docker-compose.yml.')
      }
    } catch (err) {
      // Safe to continue: the compose file is only patched after a successful
      // copy, so `up` will not recreate the container that holds the uploads.
      const msg = err instanceof Error ? err.message : String(err)
      p.log.warn(`Could not migrate content volume: ${msg}`)
    }
  }

  try {
    dockerComposeUp(config.installDir)
    p.log.success('LearnHouse is running!')
  } catch {
    p.log.error('Failed to start services. Check Docker output above.')
    process.exit(1)
  }
}
