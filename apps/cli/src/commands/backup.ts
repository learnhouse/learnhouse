import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import * as p from '../utils/prompt.js'
import pc from 'picocolors'
import { readConfig, findInstallDir } from '../services/config-store.js'
import { autoDetectDeploymentId, isContainerRunning, dockerExecToFile, dockerExecFromFile } from '../services/docker.js'

function resolveDbContainer(config: { deploymentId?: string }): string | null {
  const id = config.deploymentId || autoDetectDeploymentId()
  if (!id) return null
  return `learnhouse-db-${id}`
}

async function createBackup() {
  const installDir = findInstallDir()
  const config = readConfig(installDir)

  if (!config) {
    p.log.error('No LearnHouse installation found. Run setup first.')
    process.exit(1)
  }

  if (config.useExternalDb) {
    p.log.error('Backup is only supported for local (Docker) databases.')
    p.log.info('For external databases, use your database provider\'s backup tools.')
    process.exit(1)
  }

  const dbContainer = resolveDbContainer(config)
  if (!dbContainer || !isContainerRunning(dbContainer)) {
    p.log.error('Database container is not running. Start services first.')
    process.exit(1)
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupDir = path.join(installDir, 'backups')
  const backupName = `learnhouse-backup-${timestamp}`
  const tmpDir = path.join(backupDir, backupName)
  const archivePath = path.join(backupDir, `${backupName}.tar.gz`)

  fs.mkdirSync(tmpDir, { recursive: true })

  const s = p.spinner()
  s.start('Creating database dump')

  try {
    const dumpPath = path.join(tmpDir, 'database.sql')
    dockerExecToFile(
      dbContainer,
      'pg_dump -U learnhouse learnhouse',
      dumpPath,
    )
    s.stop('Database dump created')
  } catch (err) {
    s.stop('Database dump failed')
    p.log.error('Failed to create database dump. Check that the database is running.')
    fs.rmSync(tmpDir, { recursive: true, force: true })
    process.exit(1)
  }

  // Copy .env file
  const envPath = path.join(installDir, '.env')
  if (fs.existsSync(envPath)) {
    fs.copyFileSync(envPath, path.join(tmpDir, '.env'))
  }

  // Create tar.gz archive
  const s2 = p.spinner()
  s2.start('Creating archive')

  try {
    execSync(`tar -czf "${archivePath}" -C "${backupDir}" "${backupName}"`, {
      stdio: 'pipe',
    })
    s2.stop('Archive created')
  } catch {
    s2.stop('Archive creation failed')
    p.log.error('Failed to create archive.')
    process.exit(1)
  }

  // Clean up temp directory
  fs.rmSync(tmpDir, { recursive: true, force: true })

  const stats = fs.statSync(archivePath)
  const sizeMb = (stats.size / (1024 * 1024)).toFixed(1)

  p.log.success(pc.green(pc.bold('Backup complete!')))
  p.log.message([
    '',
    `  ${pc.dim('File:')} ${archivePath}`,
    `  ${pc.dim('Size:')} ${sizeMb} MB`,
    '',
    `  ${pc.dim('Restore with:')} npx learnhouse backup --restore ${archivePath}`,
    '',
  ].join('\n'))
}

async function restoreBackup(archivePath: string) {
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

  const dbContainer = resolveDbContainer(config)
  if (!dbContainer || !isContainerRunning(dbContainer)) {
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

export async function backupCommand(archivePath?: string, options?: { restore?: boolean }) {
  // Called with --restore flag
  if (options?.restore && archivePath) {
    p.intro(pc.cyan('LearnHouse Restore'))
    await restoreBackup(archivePath)
    return
  }

  // No flag — prompt for action
  p.intro(pc.cyan('LearnHouse Backup'))

  const action = await p.select({
    message: 'What would you like to do?',
    options: [
      { value: 'create', label: 'Create a backup' },
      { value: 'restore', label: 'Restore from a backup' },
    ],
  })
  if (p.isCancel(action)) { p.cancel(); process.exit(0) }

  if (action === 'create') {
    await createBackup()
  } else {
    const filePath = await p.text({
      message: 'Path to backup archive (.tar.gz)',
      placeholder: './backups/learnhouse-backup-*.tar.gz',
    })
    if (p.isCancel(filePath)) { p.cancel(); process.exit(0) }
    await restoreBackup(filePath as string)
  }
}
