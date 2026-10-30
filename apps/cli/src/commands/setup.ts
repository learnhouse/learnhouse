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
import { generateEnvFile, type EnvSecrets } from '../templates/env.js'
import { generateNginxConf } from '../templates/nginx.js'
import { generateCaddyfile } from '../templates/caddyfile.js'
import { readConfig, writeConfig } from '../services/config-store.js'
import { dockerComposeRecreate, dockerComposeStop, dockerComposeUp, isDeploymentRunning } from '../services/docker.js'
import { migrateContentVolume } from '../services/content-volume-migration.js'
import { waitForAppHealth, waitForAppOrgSeed } from '../services/health.js'
import { hasComposeService, publicUrl } from '../services/stack.js'
import { checkPort, findAvailablePort } from '../utils/network.js'
import { resolveAppImage } from '../services/version-check.js'
import { readEnvVar } from '../utils/env-file.js'
import { writeFileAtomic } from '../utils/fs-atomic.js'
import {
  validateEmail,
  validateInstallName,
  validatePassword,
  validatePort,
  validateDomain,
  validatePostgresUrl,
  validateRedisUrl,
  validateSlug,
} from '../utils/validators.js'
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

/** What a re-run of setup must keep from an install already in the target directory. */
interface ExistingInstall {
  edition: string
  deploymentId: string
  httpPort: number
  dbPassword?: string
  secrets: Partial<EnvSecrets>
  running: boolean
  /** App image the install runs; a reconfigure keeps it (upgrades go through `update`). */
  image?: string
  /** Connection strings of an external database / Redis (no db / redis service in compose). */
  externalDb?: string
  externalRedis?: string
}

function composeImage(dir: string): string | undefined {
  const composePath = path.join(dir, 'docker-compose.yml')
  if (!fs.existsSync(composePath)) return undefined
  return fs.readFileSync(composePath, 'utf-8').match(/image:\s*(\S*learnhouse\/app:\S+)/)?.[1]
}

function readExistingInstall(dir: string): ExistingInstall | null {
  const config = readConfig(dir)
  if (!config?.deploymentId || !fs.existsSync(path.join(dir, '.env'))) return null
  return {
    edition: config.edition || 'community',
    deploymentId: config.deploymentId,
    httpPort: config.httpPort,
    dbPassword: readEnvVar(dir, 'POSTGRES_PASSWORD'),
    secrets: {
      nextAuthSecret: readEnvVar(dir, 'NEXTAUTH_SECRET'),
      jwtSecret: readEnvVar(dir, 'LEARNHOUSE_AUTH_JWT_SECRET_KEY'),
      collabInternalKey: readEnvVar(dir, 'COLLAB_INTERNAL_KEY'),
    },
    running: isDeploymentRunning(config.deploymentId),
    image: composeImage(dir),
    externalDb: hasComposeService(dir, 'db') ? undefined : readEnvVar(dir, 'LEARNHOUSE_SQL_CONNECTION_STRING'),
    externalRedis: hasComposeService(dir, 'redis') ? undefined : readEnvVar(dir, 'LEARNHOUSE_REDIS_CONNECTION_STRING'),
  }
}

/**
 * Before a reconfigure rewrites docker-compose.yml (which always mounts the
 * content volume) and recreates the app: on installs from before that volume
 * existed, the uploads live in the app container itself, so move them first.
 */
function preserveContent(dir: string, existing: ExistingInstall): void {
  migrateContentVolume(dir, existing.deploymentId, () => dockerComposeStop(dir, 'learnhouse-app'))
}

/** A reconfigure may have rewritten the proxy config; restart the proxy so it reads it. */
function reloadProxy(dir: string): void {
  dockerComposeRecreate(dir, ['nginx', 'caddy'].filter((svc) => hasComposeService(dir, svc)))
}

async function stepInstallDir(): Promise<string | typeof BACK> {
  const baseDir = path.join(os.homedir(), '.learnhouse')

  p.log.info(`All installations are stored in ${pc.cyan('~/.learnhouse/<name>')}`)

  const name = await p.text({
    message: 'Name for this installation:',
    placeholder: 'default',
    defaultValue: 'default',
    validate: validateInstallName,
  })
  if (p.isCancel(name)) { p.cancel(); process.exit(0) }

  const resolved = path.join(baseDir, name as string)

  // Warn if target already contains a deployment
  const existing = readExistingInstall(resolved)
  if (existing?.edition === 'enterprise') {
    p.log.error(`~/.learnhouse/${name as string} holds an Enterprise installation. Pick another name.`)
    return BACK
  }
  if (existing) {
    p.log.warn(`~/.learnhouse/${name as string} already contains a LearnHouse installation.`)
    const overwrite = await p.confirm({
      message: 'Reconfigure it? Its deployment, database password and secrets are kept.',
      initialValue: false,
    })
    if (p.isCancel(overwrite) || !overwrite) {
      p.cancel('Setup cancelled.')
      process.exit(0)
    }
  }

  // Ensure the directory exists (owner-only: it will hold .env and backups)
  fs.mkdirSync(resolved, { recursive: true, mode: 0o700 })

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
  port?: number | string
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

/**
 * Secrets can come from the environment instead of flags, so they stay out of
 * `ps` output and shell history. A flag, when given, wins.
 */
export function withSecretsFromEnv(options: SetupOptions, env: NodeJS.ProcessEnv = process.env): SetupOptions {
  return {
    ...options,
    adminPassword: options.adminPassword ?? env.LEARNHOUSE_ADMIN_PASSWORD,
    license: options.license ?? env.LEARNHOUSE_LICENSE_KEY,
    cfApiToken: options.cfApiToken ?? env.LEARNHOUSE_CF_API_TOKEN,
    externalDb: options.externalDb ?? env.LEARNHOUSE_EXTERNAL_DB,
    externalRedis: options.externalRedis ?? env.LEARNHOUSE_EXTERNAL_REDIS,
  }
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

function summaryLines(config: SetupConfig): string {
  return [
    `  ${pc.dim('Directory:')}     ${config.installDir}`,
    `  ${pc.dim('Channel:')}       ${config.channel === 'dev' ? pc.yellow('Dev (:dev)') : pc.green('Stable')}`,
    `  ${pc.dim('URL:')}           ${publicUrl(config)}`,
    `  ${pc.dim('HTTPS:')}         ${config.autoSsl ? 'Auto SSL (Caddy)' : config.useHttps ? 'Manual' : 'Disabled'}`,
    `  ${pc.dim('Database:')}      ${config.useExternalDb ? 'External' : config.useAiDatabase ? 'Local (Docker, AI-enabled)' : 'Local (Docker)'}`,
    `  ${pc.dim('Redis:')}         ${config.useExternalRedis ? 'External' : 'Local (Docker)'}`,
    `  ${pc.dim('Organization:')} ${config.orgName}`,
    `  ${pc.dim('Admin:')}        ${config.adminEmail}`,
    `  ${pc.dim('AI:')}           ${config.aiEnabled ? 'Enabled' : 'Disabled'}`,
    `  ${pc.dim('Email:')}        ${config.emailEnabled ? 'Enabled' : 'Disabled'}`,
    `  ${pc.dim('S3 Storage:')}   ${config.s3Enabled ? 'Enabled' : 'Disabled'}`,
    `  ${pc.dim('Google OAuth:')} ${config.googleOAuthEnabled ? 'Enabled' : 'Disabled'}`,
  ].join('\n')
}

function writeInstallFiles(config: SetupConfig, appImage: string, secrets: Partial<EnvSecrets>): void {
  const dir = config.installDir
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  fs.mkdirSync(path.join(dir, 'extra'), { recursive: true })
  writeFileAtomic(path.join(dir, 'docker-compose.yml'), generateDockerCompose(config, appImage))
  writeFileAtomic(path.join(dir, '.env'), generateEnvFile(config, secrets), 0o600)
  if (config.autoSsl) {
    writeFileAtomic(path.join(dir, 'extra', 'Caddyfile'), generateCaddyfile(config))
  } else {
    writeFileAtomic(path.join(dir, 'extra', 'nginx.prod.conf'), generateNginxConf(config))
  }
  writeConfig(config)
}

function ciFail(message: string): never {
  console.error(`Error: ${message}`)
  process.exit(1)
}

export async function setupCommand(rawOptions: SetupOptions) {
  const options = withSecretsFromEnv(rawOptions)

  if (options.edition !== undefined && !wantsEnterprise(options.edition) && options.edition !== 'community') {
    ciFail(`--edition "${options.edition}": expected community or enterprise`)
  }

  if (wantsEnterprise(options.edition) && options.externalRedis) {
    ciFail('--external-redis is only supported for the Community edition')
  }

  // ─── CI / non-interactive mode ──────────────────────────────
  if (options.ci) {
    if (wantsEnterprise(options.edition)) {
      await setupEnterprise(toEeOptions(options, true))
      return
    }
    if (!options.adminPassword) {
      ciFail('--admin-password (or LEARNHOUSE_ADMIN_PASSWORD) is required in --ci mode')
    }

    const pwErr = validatePassword(options.adminPassword)
    if (pwErr) ciFail(`--admin-password: ${pwErr}`)

    if (options.adminEmail) {
      const emailErr = validateEmail(options.adminEmail)
      if (emailErr) ciFail(`--admin-email "${options.adminEmail}": ${emailErr}`)
    }

    const domain = (options.domain || 'localhost').toLowerCase()
    if (domain !== 'localhost') {
      const domainErr = validateDomain(domain)
      if (domainErr) ciFail(`--domain "${options.domain}": ${domainErr}`)
    }

    let requestedPort: number | undefined
    if (options.port !== undefined) {
      const portErr = validatePort(String(options.port))
      if (portErr) ciFail(`--port ${options.port}: ${portErr}`)
      requestedPort = Number(options.port)
    }

    const installName = options.name || 'default'
    const nameErr = validateInstallName(installName)
    if (nameErr) ciFail(`--name "${installName}": ${nameErr}`)

    if (options.channel !== undefined && options.channel !== 'stable' && options.channel !== 'dev') {
      ciFail(`--channel "${options.channel}": expected stable or dev`)
    }

    const orgSlug = (options.orgSlug || 'default').toLowerCase()
    const slugErr = validateSlug(orgSlug)
    if (slugErr) ciFail(`--org-slug "${options.orgSlug}": ${slugErr}`)

    if (options.externalDb) {
      const err = validatePostgresUrl(options.externalDb)
      if (err) ciFail(`--external-db: ${err}`)
    }
    if (options.externalRedis) {
      const err = validateRedisUrl(options.externalRedis)
      if (err) ciFail(`--external-redis: ${err}`)
    }

    await checkPrerequisites()

    const explicitDir = options.installDir ?? process.env.LEARNHOUSE_DIR
    const resolvedDir = explicitDir
      ? path.resolve(explicitDir)
      : path.join(os.homedir(), '.learnhouse', installName)

    // Re-running setup on an existing install reconfigures it in place: same
    // deployment (compose project + volumes) and the secrets its database and
    // sessions were created with. New ones would orphan the data.
    const existing = readExistingInstall(resolvedDir)
    if (existing?.edition === 'enterprise') {
      ciFail(`${resolvedDir} holds an Enterprise installation; pass --edition enterprise or pick another --name`)
    }
    fs.mkdirSync(resolvedDir, { recursive: true, mode: 0o700 })

    const deploymentId = existing?.deploymentId ?? crypto.randomBytes(4).toString('hex')
    const channel = (options.channel === 'dev' ? 'dev' : 'stable') as 'stable' | 'dev'
    const dbPassword = existing?.dbPassword || crypto.randomBytes(24).toString('base64url')

    // If the user didn't pin a port, prefer 80 (or the existing install's port)
    // but fall back automatically when it's taken; CI shouldn't fail just
    // because the runner has another service on port 80. A port held by this
    // very install's running stack is not "taken".
    let httpPort = requestedPort ?? existing?.httpPort ?? 80
    const ownPort = !!existing?.running && existing.httpPort === httpPort
    if (!ownPort) {
      if (requestedPort === undefined) {
        const available = await findAvailablePort(httpPort)
        if (available && available !== httpPort) {
          console.log(`Port ${httpPort} is in use, falling back to ${available}.`)
          httpPort = available
        } else if (!available) {
          ciFail('No common port is available. Pass --port=<port> explicitly.')
        }
      } else if (!(await checkPort(httpPort))) {
        ciFail(`Port ${httpPort} is already in use. Free it or pass a different --port.`)
      }
    }

    const config: SetupConfig = {
      deploymentId,
      installDir: resolvedDir,
      channel,
      domain,
      useHttps: false,
      httpPort,
      autoSsl: false,
      // External DB/Redis work for the Community stack too: when a connection
      // string is supplied, the in-container service is omitted from the compose.
      useExternalDb: !!(options.externalDb ?? existing?.externalDb),
      externalDbConnectionString: options.externalDb ?? existing?.externalDb,
      dbPassword,
      useAiDatabase: false,
      useExternalRedis: !!(options.externalRedis ?? existing?.externalRedis),
      externalRedisConnectionString: options.externalRedis ?? existing?.externalRedis,
      // Needed when the external DB is IPv6-only.
      dockerIpv6: options.dockerIpv6,
      orgName: options.orgName || 'Default Organization',
      orgSlug,
      adminEmail: options.adminEmail || 'admin@school.dev',
      adminPassword: options.adminPassword!,
      aiEnabled: false,
      emailEnabled: false,
      s3Enabled: false,
      googleOAuthEnabled: false,
    }

    console.log(`${existing ? 'Reconfiguring' : 'Setting up'} LearnHouse in ${resolvedDir}`)

    // A reconfigure keeps the running image: a newer one needs the backup and
    // migrations that `learnhouse update` does.
    const appImage = existing?.image ?? (await resolveAppImage(config.channel)).image
    console.log(`Using image: ${appImage}${existing?.image ? ' (kept; upgrade with `learnhouse update`)' : ''}`)

    if (existing) {
      try {
        preserveContent(resolvedDir, existing)
      } catch (err) {
        ciFail(`could not move uploaded content into a persistent volume: ${(err as Error)?.message ?? err}. Nothing was changed.`)
      }
    }
    writeInstallFiles(config, appImage, existing?.secrets ?? {})

    console.log('Configuration files generated')

    if (options.start !== false) {
      console.log('Starting services...')
      try {
        dockerComposeUp(resolvedDir)
        if (existing) reloadProxy(resolvedDir)
      } catch (err) {
        const stderr = (err as { stderr?: Buffer; message?: string })?.stderr?.toString?.() ?? ''
        const message = (err as { message?: string })?.message ?? ''
        if (/port is already allocated/i.test(stderr) || /address already in use/i.test(stderr) || /port is already allocated/i.test(message)) {
          console.error(`Port ${config.httpPort} is already bound; pass --port=<other> and re-run.`)
        } else {
          console.error('Failed to start services')
        }
        process.exit(1)
      }

      const healthy = await waitForAppHealth(config)
      if (!healthy) {
        console.error('Health check timed out; LearnHouse did not become ready. Run `npx learnhouse logs` to inspect.')
        process.exit(1)
      }
      const seeded = await waitForAppOrgSeed(config, config.orgSlug)
      if (!seeded) {
        console.error('')
        console.error(`API is healthy but organization "${config.orgSlug}" was not seeded.`)
        console.error('Run `npx learnhouse logs` to inspect; pin a different image tag and re-run.')
        console.error('')
        process.exit(1)
      }
      console.log('LearnHouse is ready!')
    }

    console.log(`URL: ${publicUrl(config)}`)
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
        { value: 'community', label: 'Community', hint: 'free, open-source; single organization' },
        { value: 'enterprise', label: 'Enterprise', hint: 'license key; SSO, payments, multi-tenant' },
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
        hint: 'recommended: versioned release or :latest',
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
        if (result === BACK) break
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
  p.log.step('Configuration Summary')
  p.log.message(summaryLines(config))

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

      p.log.step('Updated Configuration Summary')
      p.log.message(summaryLines(config))
    } else {
      confirmed = true
    }
  }

  // Reconfiguring an existing install keeps its deployment and secrets (the
  // database volume was initialized with that password).
  const existing = readExistingInstall(config.installDir)
  if (existing) {
    config.deploymentId = existing.deploymentId
    if (!config.useExternalDb && existing.dbPassword) config.dbPassword = existing.dbPassword
  }

  // Resolve Docker image version
  const s0 = p.spinner()
  s0.start('Resolving LearnHouse image version')
  const resolved = existing?.image ? { image: existing.image, isLatest: false } : await resolveAppImage(config.channel)
  const { image: appImage, isLatest } = resolved
  s0.stop(`Using image: ${appImage}${existing?.image ? ' (kept; upgrade with `npx learnhouse update`)' : ''}`)
  if (isLatest) {
    p.log.warn('No versioned image found, using :latest tag. Pin to a version for stability.')
  }

  // Generate files
  const s = p.spinner()
  s.start('Generating configuration files')

  const finalDir = config.installDir
  try {
    if (existing) preserveContent(finalDir, existing)
    writeInstallFiles(config, appImage, existing?.secrets ?? {})
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

  const finalUrl = publicUrl(config)

  if (startNow) {
    p.log.step('Starting LearnHouse')
    const s2 = p.spinner()
    s2.start('Pulling images and starting services (this may take a few minutes)')

    try {
      dockerComposeUp(finalDir)
      if (existing) reloadProxy(finalDir)
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
          `Port ${config.httpPort} is already bound by another process or container; ` +
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

    const healthy = await waitForAppHealth(config)

    if (healthy) {
      const seeded = await waitForAppOrgSeed(config, config.orgSlug)
      if (seeded) {
        s3.stop('LearnHouse is ready!')
      } else {
        s3.stop(`API is healthy but organization "${config.orgSlug}" was not seeded`)
        p.log.error(
          `\`/api/v1/orgs/slug/${config.orgSlug}\` returns no org. Run \`learnhouse logs\` to inspect, ` +
          'pin a different image tag, and re-run setup.',
        )
        process.exit(1)
      }
    } else {
      s3.stop('Health check timed out')
      p.log.warn('LearnHouse did not respond within 3 minutes; it may still be starting. Check with:')
      p.log.message(`  npx learnhouse status   ${pc.dim('or')}   npx learnhouse logs`)
    }

    // Success (the password is not echoed back: it was just typed, and
    // terminals keep scrollback)
    p.log.success(healthy ? pc.green(pc.bold('LearnHouse is installed!')) : pc.yellow(pc.bold('LearnHouse is installed, but not responding yet.')))
    p.log.message([
      '',
      `  ${pc.cyan('URL:')}       ${finalUrl}`,
      `  ${pc.cyan('Admin:')}     ${config.adminEmail}`,
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
    if (!healthy) process.exitCode = 1
  } else {
    p.log.info(`Files have been generated in ${finalDir}`)
    p.log.message(`  Start later with: cd ${finalDir} && docker compose up -d`)
  }

  p.outro(pc.dim('Happy teaching!'))
}
