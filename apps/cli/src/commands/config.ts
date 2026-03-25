import * as p from '@clack/prompts'
import pc from 'picocolors'
import { findInstallDir, readConfig } from '../services/config-store.js'

export async function configCommand() {
  const dir = findInstallDir()
  const config = readConfig(dir)
  if (!config) {
    p.log.error('No LearnHouse installation found. Run `npx learnhouse setup` first.')
    process.exit(1)
  }

  p.intro(pc.cyan('LearnHouse Configuration'))

  const protocol = config.useHttps ? 'https' : 'http'
  const portSuffix = (config.useHttps && config.httpPort === 443) || (!config.useHttps && config.httpPort === 80) ? '' : `:${config.httpPort}`

  p.log.message([
    `  ${pc.dim('Version:')}      ${config.version}`,
    `  ${pc.dim('Created:')}      ${config.createdAt}`,
    `  ${pc.dim('Directory:')}    ${config.installDir}`,
    `  ${pc.dim('URL:')}          ${protocol}://${config.domain}${portSuffix}`,
    `  ${pc.dim('Org slug:')}     ${config.orgSlug}`,
  ].join('\n'))

  p.log.info(pc.dim(`Full config: ${dir}/learnhouse.config.json`))
  p.log.info(pc.dim(`Environment: ${config.installDir}/.env (contains secrets)`))
}
