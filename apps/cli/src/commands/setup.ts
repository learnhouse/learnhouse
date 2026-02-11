import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import * as p from '@clack/prompts'
import pc from 'picocolors'
import type { SetupConfig } from '../types.js'
import { printBanner } from '../ui/banner.js'
import { checkPrerequisites } from '../prompts/prerequisites.js'
import { promptDomain } from '../prompts/domain.js'
import { promptDatabase } from '../prompts/database.js'
import { promptOrganization } from '../prompts/organization.js'
import { promptAdmin } from '../prompts/admin.js'
import { promptFeatures } from '../prompts/features.js'
import { generateDockerCompose } from '../templates/docker-compose.js'
import { generateEnvFile } from '../templates/env.js'
import { generateNginxConf } from '../templates/nginx.js'
import { generateCaddyfile } from '../templates/caddyfile.js'
import { writeConfig } from '../services/config-store.js'
import { dockerComposeUp } from '../services/docker.js'
import { waitForHealth } from '../services/health.js'
import { checkPort } from '../utils/network.js'
import { resolveAppImage } from '../services/version-check.js'

const STEP_NAMES = [
  'Install Directory',
  'Domain Configuration',
  'Database & Redis',
  'Organization Setup',
  'Admin Account',
  'Optional Features',
]

// Symbol returned by step functions when user wants to go back
const BACK = Symbol('back')

async function confirmOrBack(message: string): Promise<typeof BACK | boolean> {
  if (STEP_NAMES.length === 0) return true
  const result = await p.select({
    message,
    options: [
      { value: 'continue', label: 'Continue' },
      { value: 'back', label: pc.dim('Go back to previous step') },
    ],
  })
  if (p.isCancel(result)) { p.cancel(); process.exit(0) }
  return result === 'back' ? BACK : true
}

async function stepInstallDir(): Promise<string | typeof BACK> {
  const installDir = await p.text({
    message: 'Where should LearnHouse be installed?',
    placeholder: './learnhouse',
    defaultValue: './learnhouse',
  })
  if (p.isCancel(installDir)) { p.cancel(); process.exit(0) }
  return path.resolve(installDir as string)
}

async function stepDomain() {
  p.log.step(pc.cyan(`Step 2/6`) + ' Domain Configuration')
  const config = await promptDomain()
  const portAvailable = await checkPort(config.httpPort)
  if (!portAvailable) {
    p.log.warn(`Port ${config.httpPort} is already in use. You may need to free it before starting.`)
  }
  return config
}

async function stepDatabase() {
  p.log.step(pc.cyan(`Step 3/6`) + ' Database & Redis')
  return await promptDatabase()
}

async function stepOrganization() {
  p.log.step(pc.cyan(`Step 4/6`) + ' Organization Setup')
  return await promptOrganization()
}

async function stepAdmin() {
  p.log.step(pc.cyan(`Step 5/6`) + ' Admin Account')
  return await promptAdmin()
}

async function stepFeatures() {
  p.log.step(pc.cyan(`Step 6/6`) + ' Optional Features')
  return await promptFeatures()
}

export async function setupCommand() {
  await printBanner()
  p.intro(pc.cyan('LearnHouse Setup Wizard'))

  // Prerequisites (no going back from this)
  await checkPrerequisites()

  // Step results stored here
  let resolvedDir: string = ''
  let domainConfig: Awaited<ReturnType<typeof promptDomain>> | null = null
  let dbConfig: Awaited<ReturnType<typeof promptDatabase>> | null = null
  let orgConfig: Awaited<ReturnType<typeof promptOrganization>> | null = null
  let adminConfig: Awaited<ReturnType<typeof promptAdmin>> | null = null
  let featuresConfig: Awaited<ReturnType<typeof promptFeatures>> | null = null

  let step = 0
  const totalSteps = STEP_NAMES.length

  while (step < totalSteps) {
    switch (step) {
      case 0: {
        p.log.step(pc.cyan(`Step 1/${totalSteps}`) + ' Install Directory')
        const result = await stepInstallDir()
        if (result === BACK) { step = Math.max(0, step - 1); break }
        resolvedDir = result
        step++
        break
      }
      case 1: {
        domainConfig = await stepDomain()
        const nav = await confirmOrBack('Domain configured. Continue?')
        if (nav === BACK) { step--; break }
        step++
        break
      }
      case 2: {
        dbConfig = await stepDatabase()
        const nav = await confirmOrBack('Database configured. Continue?')
        if (nav === BACK) { step--; break }
        step++
        break
      }
      case 3: {
        orgConfig = await stepOrganization()
        const nav = await confirmOrBack('Organization configured. Continue?')
        if (nav === BACK) { step--; break }
        step++
        break
      }
      case 4: {
        adminConfig = await stepAdmin()
        const nav = await confirmOrBack('Admin account configured. Continue?')
        if (nav === BACK) { step--; break }
        step++
        break
      }
      case 5: {
        featuresConfig = await stepFeatures()
        step++
        break
      }
    }
  }

  // Build config with unique deployment ID
  const deploymentId = crypto.randomBytes(4).toString('hex')
  const config: SetupConfig = {
    deploymentId,
    installDir: resolvedDir,
    ...domainConfig!,
    ...dbConfig!,
    ...orgConfig!,
    ...adminConfig!,
    ...featuresConfig!,
  }

  // Summary
  const protocol = config.useHttps ? 'https' : 'http'
  const portSuffix = (config.useHttps && config.httpPort === 443) || (!config.useHttps && config.httpPort === 80) ? '' : `:${config.httpPort}`
  const url = `${protocol}://${config.domain}${portSuffix}`

  p.log.step('Configuration Summary')
  p.log.message([
    `  ${pc.dim('Directory:')}     ${resolvedDir}`,
    `  ${pc.dim('URL:')}           ${url}`,
    `  ${pc.dim('HTTPS:')}         ${config.autoSsl ? 'Auto SSL (Caddy)' : config.useHttps ? 'Manual' : 'Disabled'}`,
    `  ${pc.dim('Database:')}      ${config.useExternalDb ? 'External' : 'Local (Docker)'}`,
    `  ${pc.dim('Redis:')}         ${config.useExternalRedis ? 'External' : 'Local (Docker)'}`,
    `  ${pc.dim('Organization:')} ${config.orgName}`,
    `  ${pc.dim('Admin:')}        ${config.adminEmail}`,
    `  ${pc.dim('AI:')}           ${config.aiEnabled ? 'Enabled' : 'Disabled'}`,
    `  ${pc.dim('Email:')}        ${config.emailEnabled ? 'Enabled' : 'Disabled'}`,
    `  ${pc.dim('S3 Storage:')}   ${config.s3Enabled ? 'Enabled' : 'Disabled'}`,
    `  ${pc.dim('Google OAuth:')} ${config.googleOAuthEnabled ? 'Enabled' : 'Disabled'}`,
    `  ${pc.dim('Unsplash:')}     ${config.unsplashEnabled ? 'Enabled' : 'Disabled'}`,
  ].join('\n'))

  // Confirm or go back to edit a step
  let confirmed = false
  while (!confirmed) {
    const action = await p.select({
      message: 'What would you like to do?',
      options: [
        { value: 'confirm', label: 'Proceed with this configuration' },
        { value: 'edit', label: pc.dim('Go back and edit a step') },
        { value: 'cancel', label: pc.dim('Cancel setup') },
      ],
    })
    if (p.isCancel(action) || action === 'cancel') {
      p.cancel('Setup cancelled.')
      process.exit(0)
    }

    if (action === 'edit') {
      const stepChoice = await p.select({
        message: 'Which step do you want to edit?',
        options: STEP_NAMES.map((name, i) => ({ value: i, label: `${i + 1}. ${name}` })),
      })
      if (p.isCancel(stepChoice)) continue

      const idx = stepChoice as number
      switch (idx) {
        case 0: {
          p.log.step(pc.cyan(`Step 1/${totalSteps}`) + ' Install Directory')
          const result = await stepInstallDir()
          if (result !== BACK) { resolvedDir = result; config.installDir = result }
          break
        }
        case 1: {
          domainConfig = await stepDomain()
          Object.assign(config, domainConfig)
          break
        }
        case 2: {
          dbConfig = await stepDatabase()
          Object.assign(config, dbConfig)
          break
        }
        case 3: {
          orgConfig = await stepOrganization()
          Object.assign(config, orgConfig)
          break
        }
        case 4: {
          adminConfig = await stepAdmin()
          Object.assign(config, adminConfig)
          break
        }
        case 5: {
          featuresConfig = await stepFeatures()
          Object.assign(config, featuresConfig)
          break
        }
      }

      // Re-compute URL for updated summary
      const p2 = config.useHttps ? 'https' : 'http'
      const ps2 = (config.useHttps && config.httpPort === 443) || (!config.useHttps && config.httpPort === 80) ? '' : `:${config.httpPort}`
      const url2 = `${p2}://${config.domain}${ps2}`

      p.log.step('Updated Configuration Summary')
      p.log.message([
        `  ${pc.dim('Directory:')}     ${config.installDir}`,
        `  ${pc.dim('URL:')}           ${url2}`,
        `  ${pc.dim('HTTPS:')}         ${config.autoSsl ? 'Auto SSL (Caddy)' : config.useHttps ? 'Manual' : 'Disabled'}`,
        `  ${pc.dim('Database:')}      ${config.useExternalDb ? 'External' : 'Local (Docker)'}`,
        `  ${pc.dim('Redis:')}         ${config.useExternalRedis ? 'External' : 'Local (Docker)'}`,
        `  ${pc.dim('Organization:')} ${config.orgName}`,
        `  ${pc.dim('Admin:')}        ${config.adminEmail}`,
        `  ${pc.dim('AI:')}           ${config.aiEnabled ? 'Enabled' : 'Disabled'}`,
        `  ${pc.dim('Email:')}        ${config.emailEnabled ? 'Enabled' : 'Disabled'}`,
        `  ${pc.dim('S3 Storage:')}   ${config.s3Enabled ? 'Enabled' : 'Disabled'}`,
        `  ${pc.dim('Google OAuth:')} ${config.googleOAuthEnabled ? 'Enabled' : 'Disabled'}`,
        `  ${pc.dim('Unsplash:')}     ${config.unsplashEnabled ? 'Enabled' : 'Disabled'}`,
      ].join('\n'))
    } else {
      confirmed = true
    }
  }

  // Resolve Docker image version
  const s0 = p.spinner()
  s0.start('Resolving LearnHouse image version')
  const { image: appImage, isLatest } = await resolveAppImage()
  s0.stop(`Using image: ${appImage}`)
  if (isLatest) {
    p.log.warn('No versioned image found — using :latest tag. Pin to a version for stability.')
  }

  // Generate files
  const s = p.spinner()
  s.start('Generating configuration files')

  const finalDir = config.installDir
  fs.mkdirSync(finalDir, { recursive: true })
  fs.mkdirSync(path.join(finalDir, 'extra'), { recursive: true })

  fs.writeFileSync(path.join(finalDir, 'docker-compose.yml'), generateDockerCompose(config, appImage))
  fs.writeFileSync(path.join(finalDir, '.env'), generateEnvFile(config))

  if (config.autoSsl) {
    fs.writeFileSync(path.join(finalDir, 'extra', 'Caddyfile'), generateCaddyfile(config))
  } else {
    fs.writeFileSync(path.join(finalDir, 'extra', 'nginx.prod.conf'), generateNginxConf())
  }

  writeConfig(config)

  s.stop('Configuration files generated')

  // Start services
  const startNow = await p.confirm({
    message: 'Start LearnHouse now?',
    initialValue: true,
  })
  if (p.isCancel(startNow)) { p.cancel(); process.exit(0) }

  const finalProtocol = config.useHttps ? 'https' : 'http'
  const finalPortSuffix = (config.useHttps && config.httpPort === 443) || (!config.useHttps && config.httpPort === 80) ? '' : `:${config.httpPort}`
  const finalUrl = `${finalProtocol}://${config.domain}${finalPortSuffix}`

  if (startNow) {
    p.log.step('Starting LearnHouse')
    const s2 = p.spinner()
    s2.start('Pulling images and starting services (this may take a few minutes)')

    try {
      dockerComposeUp(finalDir)
      s2.stop('Services started')
    } catch (err) {
      s2.stop('Failed to start services')
      p.log.error('Docker Compose failed. Check the output above for details.')
      p.log.info(`You can manually start with: cd ${finalDir} && docker compose up -d`)
      process.exit(1)
    }

    // Health check
    const s3 = p.spinner()
    s3.start('Waiting for LearnHouse to be ready (up to 3 minutes)')

    const healthy = await waitForHealth(`http://localhost:${config.httpPort}`)

    if (healthy) {
      s3.stop('LearnHouse is ready!')
    } else {
      s3.stop('Health check timed out')
      p.log.warn('LearnHouse may still be starting. Check status with:')
      p.log.message(`  cd ${finalDir} && docker compose ps`)
    }

    // Success
    p.log.success(pc.green(pc.bold('LearnHouse is installed!')))
    p.log.message([
      '',
      `  ${pc.cyan('URL:')}       ${finalUrl}`,
      `  ${pc.cyan('Admin:')}     ${config.adminEmail}`,
      `  ${pc.cyan('Password:')}  ${config.adminPassword}`,
      '',
      `  ${pc.dim('Management commands:')}`,
      `  ${pc.dim('$')} npx learnhouse start    ${pc.dim('Start services')}`,
      `  ${pc.dim('$')} npx learnhouse stop     ${pc.dim('Stop services')}`,
      `  ${pc.dim('$')} npx learnhouse logs     ${pc.dim('View logs')}`,
      `  ${pc.dim('$')} npx learnhouse config   ${pc.dim('Show configuration')}`,
      `  ${pc.dim('$')} npx learnhouse backup   ${pc.dim('Backup & restore')}`,
      `  ${pc.dim('$')} npx learnhouse deployments ${pc.dim('Manage deployments')}`,
      `  ${pc.dim('$')} npx learnhouse doctor   ${pc.dim('Diagnose issues')}`,
      `  ${pc.dim('$')} npx learnhouse shell    ${pc.dim('Container shell')}`,
      '',
    ].join('\n'))
  } else {
    p.log.info(`Files have been generated in ${finalDir}`)
    p.log.message(`  Start later with: cd ${finalDir} && docker compose up -d`)
  }

  p.outro(pc.dim('Happy teaching!'))
}
