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
import { devCommand } from '../src/commands/dev.js'
import { updateCommand } from '../src/commands/update.js'
import { statusCommand } from '../src/commands/status.js'
import { healthCommand } from '../src/commands/health.js'
import { envCommand } from '../src/commands/env.js'
import { restoreCommand } from '../src/commands/restore.js'

const COMMANDS: { name: string; desc: string }[] = [
  { name: 'setup', desc: 'Interactive setup wizard' },
  { name: 'start', desc: 'Start services' },
  { name: 'stop', desc: 'Stop services' },
  { name: 'update', desc: 'Update to latest or specific version' },
  { name: 'status', desc: 'Show service status' },
  { name: 'health', desc: 'Run health checks' },
  { name: 'logs', desc: 'Stream logs' },
  { name: 'config', desc: 'Show configuration' },
  { name: 'env', desc: 'Edit environment variables' },
  { name: 'backup', desc: 'Backup database' },
  { name: 'restore', desc: 'Restore database from backup' },
  { name: 'deployments', desc: 'Manage deployments & resources' },
  { name: 'doctor', desc: 'Diagnose issues' },
  { name: 'shell', desc: 'Container shell access' },
  { name: 'dev', desc: 'Development mode' },
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
  .description('The official LearnHouse CLI — deploy, manage, and operate your LearnHouse instance')
  .version(VERSION)
  .action(showWelcome)

program
  .command('setup')
  .description('Interactive setup wizard for LearnHouse')
  .option('--ci', 'Non-interactive mode with defaults (for CI/automation)')
  .option('--name <name>', 'Installation name (default: "default")')
  .option('--domain <domain>', 'Domain name (default: "localhost")')
  .option('--port <port>', 'HTTP port (default: 80)', parseInt)
  .option('--admin-email <email>', 'Admin email (default: "admin@school.dev")')
  .option('--admin-password <password>', 'Admin password (required in --ci mode)')
  .option('--channel <channel>', 'Release channel: stable or dev (default: "stable")')
  .option('--no-start', 'Skip starting services after setup')
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

program
  .command('update')
  .description('Update LearnHouse to latest or a specific version')
  .option('-v, --version <version>', 'Target version (e.g. 1.0.0)')
  .option('--migrate', 'Run database migrations automatically')
  .option('--no-migrate', 'Skip database migrations')
  .action(updateCommand)

program
  .command('status')
  .description('Show service status')
  .action(statusCommand)

program
  .command('health')
  .description('Run health checks')
  .action(healthCommand)

program
  .command('env')
  .description('Edit environment variables')
  .action(envCommand)

program
  .command('restore')
  .description('Restore database from a backup archive')
  .argument('<archive>', 'Path to backup archive')
  .action(restoreCommand)

program
  .command('dev')
  .description('Start development environment (DB + Redis in Docker, API + Web locally)')
  .option('--ee', 'Enable Enterprise Edition features (keeps ee/ folder)')
  .action(devCommand)

// Non-blocking update check — runs in background, prints warning if outdated
const updateCheck = checkForUpdates()

program.parseAsync().then(() => updateCheck.catch(() => {}))
