import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import * as p from '@clack/prompts'
import pc from 'picocolors'
import { readConfig, findInstallDir } from '../services/config-store.js'
import { isContainerRunning, dockerExecFromFile } from '../services/docker.js'

export async function restoreCommand(archivePath: string) {
  if (!archivePath) {
    p.log.error('Please provide the path to a backup archive.')
    p.log.info('Usage: npx learnhouse restore <backup-file.tar.gz>')
    process.exit(1)
  }

  if (!fs.existsSync(archivePath)) {
    p.log.error(`Backup file not found: ${archivePath}`)
    process.exit(1)
  }

  const installDir = findInstallDir()
  const config = readConfig(installDir)

  if (!config) {
    p.log.error('No LearnHouse installation found. Run setup first.')
    process.exit(1)
  }

  if (config.useExternalDb) {
    p.log.error('Restore is only supported for local (Docker) databases.')
    p.log.info('For external databases, use your database provider\'s restore tools.')
    process.exit(1)
  }

  const dbContainer = `learnhouse-db-${config.deploymentId}`
  if (!isContainerRunning(dbContainer)) {
    p.log.error('Database container is not running. Start services first.')
    process.exit(1)
  }

  // Confirm before restoring
  p.log.warn(pc.yellow('This will overwrite the current database with the backup data.'))
  const confirm = await p.confirm({
    message: 'Are you sure you want to restore from this backup?',
    initialValue: false,
  })
  if (p.isCancel(confirm) || !confirm) {
    p.cancel('Restore cancelled.')
    process.exit(0)
  }

  // Extract archive to temp directory
  const tmpDir = path.join(installDir, '.restore-tmp')
  fs.mkdirSync(tmpDir, { recursive: true })

  const s = p.spinner()
  s.start('Extracting backup archive')

  try {
    execSync(`tar -xzf "${archivePath}" -C "${tmpDir}"`, { stdio: 'pipe' })
    s.stop('Archive extracted')
  } catch {
    s.stop('Extraction failed')
    fs.rmSync(tmpDir, { recursive: true, force: true })
    p.log.error('Failed to extract backup archive.')
    process.exit(1)
  }

  // Find the database dump inside extracted contents
  const entries = fs.readdirSync(tmpDir)
  const backupFolder = entries.find((e) =>
    fs.existsSync(path.join(tmpDir, e, 'database.sql')),
  )

  if (!backupFolder) {
    p.log.error('No database.sql found in the backup archive.')
    fs.rmSync(tmpDir, { recursive: true, force: true })
    process.exit(1)
  }

  const dumpPath = path.join(tmpDir, backupFolder, 'database.sql')

  // Restore database
  const s2 = p.spinner()
  s2.start('Restoring database')

  try {
    // Drop and recreate the database
    dockerExecFromFile(
      dbContainer,
      'psql -U learnhouse -d learnhouse',
      dumpPath,
    )
    s2.stop('Database restored')
  } catch {
    s2.stop('Database restore failed')
    fs.rmSync(tmpDir, { recursive: true, force: true })
    p.log.error('Failed to restore database. The backup file may be corrupted.')
    process.exit(1)
  }

  // Optionally restore .env
  const envBackup = path.join(tmpDir, backupFolder, '.env')
  if (fs.existsSync(envBackup)) {
    const restoreEnv = await p.confirm({
      message: 'Backup contains a .env file. Restore it? (overwrites current .env)',
      initialValue: false,
    })
    if (!p.isCancel(restoreEnv) && restoreEnv) {
      fs.copyFileSync(envBackup, path.join(installDir, '.env'))
      p.log.info('.env file restored')
    }
  }

  // Clean up
  fs.rmSync(tmpDir, { recursive: true, force: true })

  p.log.success(pc.green(pc.bold('Restore complete!')))
  p.log.info('You may want to restart services: npx learnhouse stop && npx learnhouse start')
}
