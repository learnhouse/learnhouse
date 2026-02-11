import { Command } from 'commander'
import pc from 'picocolors'
import { VERSION } from '../src/constants.js'
import { printBanner } from '../src/ui/banner.js'
import { checkForUpdates } from '../src/services/version-check.js'
import { setupCommand } from '../src/commands/setup.js'
import { startCommand } from '../src/commands/start.js'
import { stopCommand } from '../src/commands/stop.js'
import { logsCommand } from '../src/commands/logs.js'
import { configCommand } from '../src/commands/config.js'
import { backupCommand } from '../src/commands/backup.js'
import { deploymentsCommand } from '../src/commands/deployments.js'
import { doctorCommand } from '../src/commands/doctor.js'
import { shellCommand } from '../src/commands/shell.js'

const COMMANDS: { name: string; desc: string }[] = [
  { name: 'setup', desc: 'Interactive setup wizard' },
  { name: 'start', desc: 'Start services' },
  { name: 'stop', desc: 'Stop services' },
  { name: 'logs', desc: 'Stream logs' },
  { name: 'config', desc: 'Show configuration' },
  { name: 'backup', desc: 'Backup & restore database' },
  { name: 'deployments', desc: 'Manage deployments & resources' },
  { name: 'doctor', desc: 'Diagnose issues' },
  { name: 'shell', desc: 'Container shell access' },
]

async function showWelcome() {
  await printBanner()
  console.log(pc.bold(pc.white('  Available commands:\n')))
  for (const cmd of COMMANDS) {
    console.log(`    ${pc.cyan(cmd.name.padEnd(14))} ${pc.dim(cmd.desc)}`)
  }
  console.log()
  console.log(pc.dim('  Run a command with: npx learnhouse <command>'))
  console.log(pc.dim('  Get started with:   npx learnhouse setup'))
  console.log()
}

const program = new Command()

program
  .name('learnhouse')
  .description('CLI tool for self-hosting LearnHouse')
  .version(VERSION)
  .action(showWelcome)

program
  .command('setup')
  .description('Interactive setup wizard for LearnHouse')
  .action(setupCommand)

program
  .command('start')
  .description('Start LearnHouse services')
  .action(startCommand)

program
  .command('stop')
  .description('Stop LearnHouse services')
  .action(stopCommand)

program
  .command('logs')
  .description('Stream logs from LearnHouse services')
  .action(logsCommand)

program
  .command('config')
  .description('Show current LearnHouse configuration')
  .action(configCommand)

program
  .command('backup')
  .description('Backup & restore LearnHouse database')
  .argument('[archive]', 'Path to backup archive for restore')
  .option('--restore', 'Restore from a backup archive')
  .action(backupCommand)

program
  .command('deployments')
  .description('Manage deployments & resource limits')
  .action(deploymentsCommand)

program
  .command('doctor')
  .description('Diagnose common issues with LearnHouse')
  .action(doctorCommand)

program
  .command('shell')
  .description('Open a shell in a LearnHouse container')
  .action(shellCommand)

// Non-blocking update check — runs in background, prints warning if outdated
const updateCheck = checkForUpdates()

program.parseAsync().then(() => updateCheck.catch(() => {}))
