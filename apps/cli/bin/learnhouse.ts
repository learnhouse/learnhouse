import { Command } from 'commander'
import pc from 'picocolors'
import { VERSION } from '../src/constants.js'
import { printBanner } from '../src/ui/banner.js'
import { checkForUpdates, updateCheckEnabled, updateNotice } from '../src/services/version-check.js'
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
import { scaleCommand } from '../src/commands/scale.js'

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
  { name: 'scale', desc: 'Set resource limits (memory) per service' },
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

// Commands that only work in a terminal. Without one, clack prompts hit EOF
// and the process used to exit 0 having done nothing (a CI step "passed").
const INTERACTIVE_ONLY = new Set(['env', 'scale', 'deployments', 'shell'])

const program = new Command()

program
  .name('learnhouse')
  .description('The official LearnHouse CLI: deploy, manage, and operate your LearnHouse instance')
  .version(VERSION)
  .option('--dir <path>', 'Installation directory to act on (default: current dir, else ~/.learnhouse/<name>)')
  .showSuggestionAfterError()
  .hook('preAction', (_program, action) => {
    const dir = program.opts().dir as string | undefined
    if (dir) process.env.LEARNHOUSE_DIR = dir
    const name = action.name()
    const needsTty = INTERACTIVE_ONLY.has(name) || (name === 'setup' && !action.opts().ci)
    if (needsTty && !(process.stdin.isTTY && process.stdout.isTTY)) {
      console.error(`Error: \`learnhouse ${name}\` is interactive and needs a terminal.`)
      if (name === 'setup') console.error('For automation use: npx learnhouse setup --ci --admin-password ... (see --help)')
      process.exit(2)
    }
  })

program
  .command('setup')
  .description('Interactive setup wizard for LearnHouse')
  .option('--ci', 'Non-interactive mode with defaults (for CI/automation)')
  .option('--name <name>', 'Installation name (default: "default")')
  .option('--domain <domain>', 'Domain name (default: "localhost")')
  .option('--port <port>', 'HTTP port (default: 80)')
  .option('--admin-email <email>', 'Admin email (default: "admin@school.dev")')
  .option('--admin-password <password>', 'Admin password (required in --ci mode; or set LEARNHOUSE_ADMIN_PASSWORD)')
  .option('--org-name <name>', 'Organization display name (default: "Default Organization")')
  .option('--org-slug <slug>', 'Organization slug used in URLs (default: "default")')
  .option('--channel <channel>', 'Release channel: stable or dev (default: "stable")')
  .option('--no-start', 'Skip starting services after setup')
  // ── Enterprise Edition ──
  .option('--edition <edition>', 'Edition to deploy: community (default) or enterprise')
  .option('--license <key>', 'EE license key, also the image-registry password (or set LEARNHOUSE_LICENSE_KEY)')
  .option('--tenancy <mode>', 'EE tenancy: single (default) or agency (multi-tenant)')
  .option('--acme-email <email>', "EE: Let's Encrypt contact email (default: admin email)")
  .option('--ee-image-tag <tag>', 'EE image tag (default: "prod")')
  .option('--local-tls', 'EE: use Caddy internal CA (self-signed; testing only)')
  .option('--external-db <uri>', 'Use an external Postgres (e.g. Supabase) instead of the in-container db (or set LEARNHOUSE_EXTERNAL_DB)')
  .option('--external-redis <uri>', 'Community: use an external Redis instead of the in-container redis (or set LEARNHOUSE_EXTERNAL_REDIS)')
  .option('--dns-provider <provider>', 'EE: DNS-01 provider for wildcard certs (cloudflare)')
  .option('--cf-api-token <token>', 'EE: Cloudflare API token (Zone:DNS:Edit) for DNS-01 (or set LEARNHOUSE_CF_API_TOKEN)')
  .option('--docker-ipv6', 'Enable IPv6 on the compose network (needed for IPv6-only external DBs)')
  .option('--install-dir <dir>', 'Override the install directory (default: ~/.learnhouse/<name>)')
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
  .description('Back up the database, .env and uploaded content (or restore with --restore)')
  .argument('[archive]', 'Path to backup archive (with --restore)')
  .option('--restore', 'Restore from a backup archive')
  .option('-y, --yes', 'Restore without asking for confirmation')
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
  .description('Update LearnHouse to latest or a specific version (EE: backs up the DB + runs migrations)')
  // Note: --version is intentionally avoided here because Commander v15 intercepts
  // --version at the root program level, so subcommand --version flags silently
  // become the global version output. Use --to or -v instead.
  .option('-v, --to <version>', 'Target version (e.g. 1.4.2 or v1.4.2; EE default: "prod")')
  .option('--migrate', 'Run database migrations automatically')
  .option('--no-migrate', 'Skip database migrations')
  .option('--no-backup', 'Skip the pre-upgrade database backup (not recommended)')
  .action((opts) => updateCommand({ ...opts, version: opts.to }))

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
  .description('Restore from a backup archive (.tar.gz), or an update dump (.sql.gz)')
  .argument('<archive>', 'Path to backup archive')
  .option('-y, --yes', 'Do not ask for confirmation (required without a terminal)')
  .action(restoreCommand)

program
  .command('scale')
  .description('Set memory limits per service (app, db, redis)')
  .action(scaleCommand)

program
  .command('dev')
  .description('Start development environment (DB + Redis in Docker, API + Web locally)')
  .option('--ee', 'Enable Enterprise Edition features (keeps ee/ folder)')
  .option('--admin-email <email>', 'Admin email (default: admin@school.dev)')
  .option('--admin-password <password>', 'Admin password (skips interactive prompt)')
  .action(devCommand)

// Update check runs alongside the command and is printed only after it,
// never in the middle of a prompt. It never delays exit by more than a moment.
const updateAbort = new AbortController()
const updateCheck = updateCheckEnabled()
  ? checkForUpdates({ print: false, signal: updateAbort.signal })
  : Promise.resolve(null)

async function main() {
  if (process.argv.length <= 2) {
    await showWelcome()
  } else {
    await program.parseAsync()
  }
  let timer: NodeJS.Timeout | undefined
  const latest = await Promise.race([updateCheck, new Promise<null>((r) => { timer = setTimeout(r, 300, null) })])
  clearTimeout(timer)
  updateAbort.abort()
  const notice = updateNotice(latest)
  if (notice) console.error(notice)
}

main().catch((err: unknown) => {
  updateAbort.abort()
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
  if (process.env.LEARNHOUSE_DEBUG && err instanceof Error) console.error(err.stack)
  process.exit(1)
})
