import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as p from '../utils/prompt.js'
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
import { waitForHealth, waitForOrgSeed } from '../services/health.js'
import { checkPort, findAvailablePort } from '../utils/network.js'
import { resolveAppImage } from '../services/version-check.js'
import { validateEmail } from '../utils/validators.js'
import { setupEnterprise, type EeSetupOptions } from './setup-ee.js'

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
  const baseDir = path.join(os.homedir(), '.learnhouse')

  p.log.info(`All installations are stored in ${pc.cyan('~/.learnhouse/<name>')}`)

  const name = await p.text({
    message: 'Name for this installation:',
    placeholder: 'default',
    defaultValue: 'default',
    validate: (value) => {
      if (!value) return 'Name is required'
      if (/[/\\]/.test(value)) return 'Name cannot contain slashes'
      return undefined
    },
  })
  if (p.isCancel(name)) { p.cancel(); process.exit(0) }

  const resolved = path.join(baseDir, name as string)

  // Warn if target already contains a deployment
  if (fs.existsSync(path.join(resolved, 'learnhouse.config.json'))) {
    p.log.warn(`~/.learnhouse/${name} already contains a LearnHouse installation.`)
    const overwrite = await p.confirm({
      message: 'Overwrite existing installation?',
      initialValue: false,
    })
    if (p.isCancel(overwrite) || !overwrite) {
      p.cancel('Setup cancelled.')
      process.exit(0)
    }
  }

  // Ensure the directory exists
  fs.mkdirSync(resolved, { recursive: true })

  return resolved
}

async function stepDomain() {
  p.log.step(pc.cyan(`Step 2/6`) + ' Domain Configuration')
  // promptDomain itself now refuses to return a non-privileged port that
  // is in use, so by the time we get here httpPort is either free or a
  // privileged port (≤1024) we have to trust. No extra warning needed.
  return await promptDomain()
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

export interface SetupOptions {
  ci?: boolean
  name?: string
  domain?: string
  port?: number
  adminEmail?: string
  adminPassword?: string
  orgName?: string
  orgSlug?: string
  channel?: string
  start?: boolean
  // Enterprise Edition
  edition?: string
  license?: string
  tenancy?: string
  acmeEmail?: string
  eeImageTag?: string
  localTls?: boolean
  externalDb?: string
  externalRedis?: string
  dnsProvider?: string
  cfApiToken?: string
  dockerIpv6?: boolean
  installDir?: string
}

function wantsEnterprise(edition?: string): boolean {
  return edition === 'enterprise' || edition === 'ee'
}

function toEeOptions(options: SetupOptions, ci: boolean): EeSetupOptions {
  return {
    ci,
    name: options.name,
    installDir: options.installDir,
    license: options.license,
    domain: options.domain,
    tenancy: options.tenancy,
    acmeEmail: options.acmeEmail,
    adminEmail: options.adminEmail,
    adminPassword: options.adminPassword,
    eeImageTag: options.eeImageTag,
    localTls: options.localTls,
    externalDb: options.externalDb,
    dnsProvider: options.dnsProvider,
    cfApiToken: options.cfApiToken,
    dockerIpv6: options.dockerIpv6,
    start: options.start,
  }
}

export async function setupCommand(options: SetupOptions) {
  // ─── CI / non-interactive mode ──────────────────────────────
  if (options.ci) {
    if (wantsEnterprise(options.edition)) {
      await setupEnterprise(toEeOptions(options, true))
      return
    }
    if (!options.adminPassword) {
      console.error('Error: --admin-password is required in --ci mode')
      process.exit(1)
    }

    if (options.adminEmail) {
      const emailErr = validateEmail(options.adminEmail)
      if (emailErr) {
        console.error(`Error: --admin-email "${options.adminEmail}" — ${emailErr}`)
        process.exit(1)
      }
    }

    await checkPrerequisites()

    const installName = options.name || 'default'
    const baseDir = path.join(os.homedir(), '.learnhouse')
    const resolvedDir = path.join(baseDir, installName)
    fs.mkdirSync(resolvedDir, { recursive: true })

    const deploymentId = crypto.randomBytes(4).toString('hex')
    const channel = (options.channel === 'dev' ? 'dev' : 'stable') as 'stable' | 'dev'
    const dbPassword = crypto.randomBytes(24).toString('base64url')

    // If the user didn't pin a port, prefer 80 but fall back automatically
    // when it's taken — CI shouldn't fail just because the runner has another
    // service on port 80.
    let httpPort = options.port || 80
    if (!options.port) {
      const available = await findAvailablePort(httpPort)
      if (available && available !== httpPort) {
        console.log(`Port ${httpPort} is in use — falling back to ${available}.`)
        httpPort = available
      } else if (!available) {
        console.error('No common port is available. Pass --port=<port> explicitly.')
        process.exit(1)
      }
    } else if (!(await checkPort(httpPort))) {
      console.error(`Port ${httpPort} is already in use. Free it or pass a different --port.`)
      process.exit(1)
    }

    const config: SetupConfig = {
      deploymentId,
      installDir: resolvedDir,
      channel,
      domain: options.domain || 'localhost',
      useHttps: false,
      httpPort,
      autoSsl: false,
      // External DB/Redis work for the Community stack too — when a connection
      // string is supplied, the in-container service is omitted from the compose.
      useExternalDb: !!options.externalDb,
      externalDbConnectionString: options.externalDb,
      dbPassword,
      useAiDatabase: false,
      useExternalRedis: !!options.externalRedis,
      externalRedisConnectionString: options.externalRedis,
      // Needed when the external DB is IPv6-only.
      dockerIpv6: options.dockerIpv6,
      orgName: options.orgName || 'Default Organization',
      orgSlug: (options.orgSlug || 'default').toLowerCase(),
      adminEmail: options.adminEmail || 'admin@school.dev',
      adminPassword: options.adminPassword,
      aiEnabled: false,
      emailEnabled: false,
      s3Enabled: false,
      googleOAuthEnabled: false,
      unsplashEnabled: false,
    }

    console.log(`Setting up LearnHouse in ~/.learnhouse/${installName}`)

    const { image: appImage } = await resolveAppImage(config.channel)
    console.log(`Using image: ${appImage}`)

    fs.mkdirSync(resolvedDir, { recursive: true })
    fs.mkdirSync(path.join(resolvedDir, 'extra'), { recursive: true })
    fs.writeFileSync(path.join(resolvedDir, 'docker-compose.yml'), generateDockerCompose(config, appImage))
    fs.writeFileSync(path.join(resolvedDir, '.env'), generateEnvFile(config))
    fs.chmodSync(path.join(resolvedDir, '.env'), 0o600)
    fs.writeFileSync(path.join(resolvedDir, 'extra', 'nginx.prod.conf'), generateNginxConf())
    writeConfig(config)

    console.log('Configuration files generated')

    if (options.start !== false) {
      console.log('Starting services...')
      try {
        dockerComposeUp(resolvedDir)
        const healthy = await waitForHealth(`http://localhost:${config.httpPort}`)
        if (healthy) {
          const seeded = await waitForOrgSeed(`http://localhost:${config.httpPort}`, 'default')
          if (seeded) {
            console.log('LearnHouse is ready!')
          } else {
            console.error('')
            console.error('API is healthy but the default organization was not seeded.')
            console.error('Run `npx learnhouse logs` to inspect; pin a different image tag and re-run.')
            console.error('')
            process.exit(1)
          }
        } else {
          console.log('Health check timed out — services may still be starting')
        }
      } catch (err) {
        const stderr = (err as { stderr?: Buffer; message?: string })?.stderr?.toString?.() ?? ''
        const message = (err as { message?: string })?.message ?? ''
        if (/port is already allocated/i.test(stderr) || /address already in use/i.test(stderr) || /port is already allocated/i.test(message)) {
          console.error(`Port ${config.httpPort} is already bound — pass --port=<other> and re-run.`)
        } else {
          console.error('Failed to start services')
        }
        process.exit(1)
      }
    }

    const portSuffix = config.httpPort === 80 ? '' : `:${config.httpPort}`
    console.log(`URL: http://${config.domain}${portSuffix}`)
    console.log(`Admin: ${config.adminEmail}`)
    console.log(`Install dir: ${resolvedDir}`)
    return
  }

  // ─── Interactive mode ───────────────────────────────────────
  await printBanner()
  p.intro(pc.cyan('LearnHouse Setup Wizard'))

  // Edition selection (Community vs Enterprise)
  let edition = options.edition
  if (!wantsEnterprise(edition) && edition !== 'community') {
    const choice = await p.select({
      message: 'Which edition do you want to deploy?',
      options: [
        { value: 'community', label: 'Community', hint: 'free, open-source — single organization' },
        { value: 'enterprise', label: 'Enterprise', hint: 'license key — SSO, payments, multi-tenant' },
      ],
    })
    if (p.isCancel(choice)) { p.cancel(); process.exit(0) }
    edition = choice as string
  }
  if (wantsEnterprise(edition)) {
    await setupEnterprise(toEeOptions(options, false))
    return
  }

  // Prerequisites (no going back from this)
  await checkPrerequisites()

  // Release channel selection
  const channelChoice = await p.select({
    message: 'Which release channel do you want to use?',
    options: [
      {
        value: 'stable',
        label: 'Stable',
        hint: 'recommended — versioned release or :latest',
      },
      {
        value: 'dev',
        label: 'Dev',
        hint: 'latest development build (:dev tag)',
      },
    ],
  })
  if (p.isCancel(channelChoice)) { p.cancel(); process.exit(0) }
  const channel = channelChoice as 'stable' | 'dev'

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
    channel,
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
    `  ${pc.dim('Channel:')}       ${config.channel === 'dev' ? pc.yellow('Dev (:dev)') : pc.green('Stable')}`,
    `  ${pc.dim('URL:')}           ${url}`,
    `  ${pc.dim('HTTPS:')}         ${config.autoSsl ? 'Auto SSL (Caddy)' : config.useHttps ? 'Manual' : 'Disabled'}`,
    `  ${pc.dim('Database:')}      ${config.useExternalDb ? 'External' : config.useAiDatabase ? 'Local (Docker, AI-enabled)' : 'Local (Docker)'}`,
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
        `  ${pc.dim('Channel:')}       ${config.channel === 'dev' ? pc.yellow('Dev (:dev)') : pc.green('Stable')}`,
        `  ${pc.dim('URL:')}           ${url2}`,
        `  ${pc.dim('HTTPS:')}         ${config.autoSsl ? 'Auto SSL (Caddy)' : config.useHttps ? 'Manual' : 'Disabled'}`,
        `  ${pc.dim('Database:')}      ${config.useExternalDb ? 'External' : config.useAiDatabase ? 'Local (Docker, AI-enabled)' : 'Local (Docker)'}`,
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
  const { image: appImage, isLatest } = await resolveAppImage(config.channel)
  s0.stop(`Using image: ${appImage}`)
  if (isLatest) {
    p.log.warn('No versioned image found — using :latest tag. Pin to a version for stability.')
  }

  // Generate files
  const s = p.spinner()
  s.start('Generating configuration files')

  const finalDir = config.installDir
  try {
    fs.mkdirSync(finalDir, { recursive: true })
    fs.mkdirSync(path.join(finalDir, 'extra'), { recursive: true })

    fs.writeFileSync(path.join(finalDir, 'docker-compose.yml'), generateDockerCompose(config, appImage))
    fs.writeFileSync(path.join(finalDir, '.env'), generateEnvFile(config))
    fs.chmodSync(path.join(finalDir, '.env'), 0o600)

    if (config.autoSsl) {
      fs.writeFileSync(path.join(finalDir, 'extra', 'Caddyfile'), generateCaddyfile(config))
    } else {
      fs.writeFileSync(path.join(finalDir, 'extra', 'nginx.prod.conf'), generateNginxConf())
    }

    writeConfig(config)
  } catch (err: any) {
    s.stop('Failed to generate configuration files')
    p.log.error(err?.message ?? String(err))
    process.exit(1)
  }

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
      const stderr = (err as { stderr?: Buffer; message?: string })?.stderr?.toString?.() ?? ''
      const message = (err as { message?: string })?.message ?? ''
      const portAllocated =
        /port is already allocated/i.test(stderr) ||
        /port is already allocated/i.test(message) ||
        /bind:.*address already in use/i.test(stderr)
      if (portAllocated) {
        p.log.error(
          `Port ${config.httpPort} is already bound by another process or container — ` +
          `Docker couldn't publish to it.`
        )
        p.log.info(
          'Fix one of these and re-run `learnhouse start` (your config is already saved):\n' +
          `  • Stop whatever is using port ${config.httpPort}, or\n` +
          `  • Re-run \`learnhouse setup\` and pick a different port, or\n` +
          `  • Edit HTTP_PORT in ${finalDir}/.env and run \`docker compose up -d\` from there.`
        )
      } else {
        p.log.error('Docker Compose failed. Check the output above for details.')
        p.log.info(`You can manually start with: cd ${finalDir} && docker compose up -d`)
      }
      process.exit(1)
    }

    // Health check
    const s3 = p.spinner()
    s3.start('Waiting for LearnHouse to be ready (up to 3 minutes)')

    const healthy = await waitForHealth(`http://localhost:${config.httpPort}`)

    if (healthy) {
      const seeded = await waitForOrgSeed(`http://localhost:${config.httpPort}`, 'default')
      if (seeded) {
        s3.stop('LearnHouse is ready!')
      } else {
        s3.stop('API is healthy but the default organization was not seeded')
        p.log.error(
          '`/api/v1/orgs/slug/default` returns no org. Run `learnhouse logs` to inspect, ' +
          'pin a different image tag, and re-run setup.',
        )
        process.exit(1)
      }
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
