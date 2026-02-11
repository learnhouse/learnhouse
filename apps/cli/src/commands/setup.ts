import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import * as p from '@clack/prompts'
import pc from 'picocolors'
import type { SetupConfig } from '../types.js'
import { printBanner } from '../ui/banner.js'
import { checkPrerequisites } from '../prompts/prerequisites.js'
import { promptDomain } from '../prompts/domain.js'
import { promptOrganization } from '../prompts/organization.js'
import { promptAdmin } from '../prompts/admin.js'
import { promptFeatures } from '../prompts/features.js'
import { generateDockerCompose } from '../templates/docker-compose.js'
import { generateEnvFile } from '../templates/env.js'
import { generateNginxConf } from '../templates/nginx.js'
import { writeConfig } from '../services/config-store.js'
import { dockerComposeUp } from '../services/docker.js'
import { waitForHealth } from '../services/health.js'
import { checkPort } from '../utils/network.js'

export async function setupCommand() {
  printBanner()
  p.intro(pc.cyan('LearnHouse Setup Wizard'))

  // 1. Prerequisites
  await checkPrerequisites()

  // 2. Install directory
  const installDir = await p.text({
    message: 'Where should LearnHouse be installed?',
    placeholder: './learnhouse',
    defaultValue: './learnhouse',
  })
  if (p.isCancel(installDir)) { p.cancel(); process.exit(0) }
  const resolvedDir = path.resolve(installDir as string)

  // 3. Domain configuration
  p.log.step('Domain Configuration')
  const domainConfig = await promptDomain()

  // Check port availability
  const portAvailable = await checkPort(domainConfig.httpPort)
  if (!portAvailable) {
    p.log.warn(`Port ${domainConfig.httpPort} is already in use. You may need to free it before starting.`)
  }

  // 4. Organization
  p.log.step('Organization Setup')
  const orgConfig = await promptOrganization()

  // 5. Admin
  p.log.step('Admin Account')
  const adminConfig = await promptAdmin()

  // 6. Optional features
  p.log.step('Optional Features')
  const featuresConfig = await promptFeatures()

  // Build config with unique deployment ID
  const deploymentId = crypto.randomBytes(4).toString('hex')
  const config: SetupConfig = {
    deploymentId,
    installDir: resolvedDir,
    ...domainConfig,
    ...orgConfig,
    ...adminConfig,
    ...featuresConfig,
  }

  // 7. Summary
  const protocol = config.useHttps ? 'https' : 'http'
  const portSuffix = (config.useHttps && config.httpPort === 443) || (!config.useHttps && config.httpPort === 80) ? '' : `:${config.httpPort}`
  const url = `${protocol}://${config.domain}${portSuffix}`

  p.log.step('Configuration Summary')
  p.log.message([
    `  ${pc.dim('Directory:')}     ${resolvedDir}`,
    `  ${pc.dim('URL:')}           ${url}`,
    `  ${pc.dim('Organization:')} ${config.orgName}`,
    `  ${pc.dim('Admin:')}        ${config.adminEmail}`,
    `  ${pc.dim('AI:')}           ${config.aiEnabled ? 'Enabled' : 'Disabled'}`,
    `  ${pc.dim('Email:')}        ${config.emailEnabled ? 'Enabled' : 'Disabled'}`,
    `  ${pc.dim('S3 Storage:')}   ${config.s3Enabled ? 'Enabled' : 'Disabled'}`,
    `  ${pc.dim('Google OAuth:')} ${config.googleOAuthEnabled ? 'Enabled' : 'Disabled'}`,
    `  ${pc.dim('Unsplash:')}     ${config.unsplashEnabled ? 'Enabled' : 'Disabled'}`,
  ].join('\n'))

  const confirm = await p.confirm({
    message: 'Proceed with this configuration?',
  })
  if (p.isCancel(confirm) || !confirm) {
    p.cancel('Setup cancelled.')
    process.exit(0)
  }

  // 8. Generate files
  const s = p.spinner()
  s.start('Generating configuration files')

  // Create directories
  fs.mkdirSync(resolvedDir, { recursive: true })
  fs.mkdirSync(path.join(resolvedDir, 'extra'), { recursive: true })

  // Write files
  fs.writeFileSync(path.join(resolvedDir, 'docker-compose.yml'), generateDockerCompose(config))
  fs.writeFileSync(path.join(resolvedDir, '.env'), generateEnvFile(config))
  fs.writeFileSync(path.join(resolvedDir, 'extra', 'nginx.prod.conf'), generateNginxConf())
  writeConfig(config)

  s.stop('Configuration files generated')

  // 9. Start services
  const startNow = await p.confirm({
    message: 'Start LearnHouse now?',
    initialValue: true,
  })
  if (p.isCancel(startNow)) { p.cancel(); process.exit(0) }

  if (startNow) {
    p.log.step('Starting LearnHouse')
    const s2 = p.spinner()
    s2.start('Pulling images and starting services (this may take a few minutes)')

    try {
      dockerComposeUp(resolvedDir)
      s2.stop('Services started')
    } catch (err) {
      s2.stop('Failed to start services')
      p.log.error('Docker Compose failed. Check the output above for details.')
      p.log.info(`You can manually start with: cd ${resolvedDir} && docker compose up -d`)
      process.exit(1)
    }

    // 10. Health check
    const s3 = p.spinner()
    s3.start('Waiting for LearnHouse to be ready (up to 3 minutes)')

    const healthy = await waitForHealth(`http://localhost:${config.httpPort}`)

    if (healthy) {
      s3.stop('LearnHouse is ready!')
    } else {
      s3.stop('Health check timed out')
      p.log.warn('LearnHouse may still be starting. Check status with:')
      p.log.message(`  cd ${resolvedDir} && docker compose ps`)
    }

    // 11. Success
    p.log.success(pc.green(pc.bold('LearnHouse is installed!')))
    p.log.message([
      '',
      `  ${pc.cyan('URL:')}       ${url}`,
      `  ${pc.cyan('Admin:')}     ${config.adminEmail}`,
      `  ${pc.cyan('Password:')}  ${config.adminPassword}`,
      '',
      `  ${pc.dim('Management commands:')}`,
      `  ${pc.dim('$')} npx learnhouse start    ${pc.dim('Start services')}`,
      `  ${pc.dim('$')} npx learnhouse stop     ${pc.dim('Stop services')}`,
      `  ${pc.dim('$')} npx learnhouse status   ${pc.dim('View status')}`,
      `  ${pc.dim('$')} npx learnhouse logs     ${pc.dim('View logs')}`,
      `  ${pc.dim('$')} npx learnhouse update   ${pc.dim('Update to latest')}`,
      '',
    ].join('\n'))
  } else {
    p.log.info(`Files have been generated in ${resolvedDir}`)
    p.log.message(`  Start later with: cd ${resolvedDir} && docker compose up -d`)
  }

  p.outro(pc.dim('Happy teaching!'))
}
