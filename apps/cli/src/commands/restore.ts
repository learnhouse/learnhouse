import * as p from '../utils/prompt.js'
import pc from 'picocolors'
import { exitOnFailure, restoreBackup } from './backup.js'

export async function restoreCommand(archivePath: string, options: { yes?: boolean } = {}) {
  if (!archivePath) {
    p.log.error('Please provide the path to a backup archive.')
    p.log.info('Usage: npx learnhouse restore <backup-file.tar.gz>')
    process.exit(1)
  }

  p.intro(pc.cyan('LearnHouse Restore'))
  await exitOnFailure(() => restoreBackup(archivePath, options))
}
