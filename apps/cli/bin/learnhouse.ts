import { Command } from 'commander'
import { VERSION } from '../src/constants.js'
import { setupCommand } from '../src/commands/setup.js'
import { startCommand } from '../src/commands/start.js'
import { stopCommand } from '../src/commands/stop.js'
import { statusCommand } from '../src/commands/status.js'
import { logsCommand } from '../src/commands/logs.js'
import { updateCommand } from '../src/commands/update.js'
import { configCommand } from '../src/commands/config.js'

const program = new Command()

program
  .name('learnhouse')
  .description('CLI tool for self-hosting LearnHouse')
  .version(VERSION)

program
  .command('setup', { isDefault: true })
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
  .command('status')
  .description('Show status of LearnHouse services')
  .action(statusCommand)

program
  .command('logs')
  .description('Stream logs from LearnHouse services')
  .action(logsCommand)

program
  .command('update')
  .description('Update LearnHouse to the latest version')
  .action(updateCommand)

program
  .command('config')
  .description('Show current LearnHouse configuration')
  .action(configCommand)

program.parse()
