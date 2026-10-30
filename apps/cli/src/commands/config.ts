import * as p from '@clack/prompts'
import pc from 'picocolors'
import { findInstallDir, readConfig } from '../services/config-store.js'
import { publicUrl } from '../services/stack.js'

export async function configCommand() {
  const dir = findInstallDir()
  const config = readConfig(dir)
  if (!config) {
    p.log.error('No LearnHouse installation found. Run `npx learnhouse setup` first.')
    process.exit(1)
  }

  p.intro(pc.cyan('LearnHouse Configuration'))

  p.log.message([
    `  ${pc.dim('Version:')}      ${config.version}`,
    `  ${pc.dim('Created:')}      ${config.createdAt}`,
    `  ${pc.dim('Directory:')}    ${config.installDir}`,
    `  ${pc.dim('Edition:')}      ${config.edition === 'enterprise' ? `Enterprise (${config.eeTenancy || 'single'})` : 'Community'}`,
    `  ${pc.dim('URL:')}          ${publicUrl(config)}`,
    `  ${pc.dim('Org slug:')}     ${config.orgSlug}`,
  ].join('\n'))

  p.log.info(pc.dim(`Full config: ${dir}/learnhouse.config.json`))
  p.log.info(pc.dim(`Environment: ${config.installDir}/.env (contains secrets)`))
}
