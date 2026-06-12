import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import pc from 'picocolors'
import * as p from '../utils/prompt.js'
import type { EeTenancy, SetupConfig } from '../types.js'
import { validateDomain, validateEmail, validatePassword } from '../utils/validators.js'
import { getPublicIp } from '../utils/network.js'
import { writeConfig, readConfig } from '../services/config-store.js'
import {
  dockerLogin,
  dockerComposePull,
  dockerComposeUpRetry,
  isDockerInstalled,
  isDockerRunning,
  dockerComposeWorks,
  installDockerLinux,
  isTcpPortListening,
} from '../services/docker.js'
import { waitForEeReady } from '../services/health.js'
import {
  EE_DEFAULT_IMAGE_TAG,
  EE_REGISTRY,
  EE_REGISTRY_USERNAME,
} from '../constants.js'
import {
  generateEeCaddyfile,
  generateEeDockerCompose,
  generateEeEnv,
  generateEeLocalTlsOverride,
  generatePgvectorInit,
  generateCaddyDockerfile,
  generateEeSecrets,
  isAgency,
  isExternalDb,
  isCloudflareDns,
  type EeSecrets,
} from '../templates/ee.js'

export interface EeSetupOptions {
  ci?: boolean
  name?: string
  installDir?: string
  license?: string
  domain?: string
  tenancy?: string
  acmeEmail?: string
  adminEmail?: string
  adminPassword?: string
  eeImageTag?: string
  localTls?: boolean
  externalDb?: string
  dnsProvider?: string
  cfApiToken?: string
  dockerIpv6?: boolean
  start?: boolean
}

function normalizeDomain(input: string): string {
  return input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
}

/** Ensure Docker + the compose plugin are present and the daemon is up.
 *  On a fresh Linux server with no Docker, offer/auto-install it (get.docker.com). */
async function ensureDockerReady(interactive: boolean): Promise<void> {
  const die = (m: string): never => {
    interactive ? p.log.error(m) : console.error(`Error: ${m}`)
    process.exit(1)
    throw new Error(m)
  }
  const checkRunning = (): void => {
    let running = false
    try { running = isDockerRunning() } catch (e) { die((e as Error).message) }
    if (!running) die('Docker is installed but the daemon is not running. Start Docker and re-run.')
  }

  if (isDockerInstalled() && dockerComposeWorks()) { checkRunning(); return }
  if (isDockerInstalled() && !dockerComposeWorks()) {
    die('Docker is installed but the `docker compose` plugin is missing. Install docker-compose-plugin and re-run.')
  }
  if (process.platform !== 'linux') {
    die('Docker (with the compose plugin) is required. Install Docker Desktop: https://docs.docker.com/get-docker/')
  }
  if (interactive) {
    const ok = await p.confirm({ message: 'Docker is not installed. Install Docker Engine now (via get.docker.com)?', initialValue: true })
    if (p.isCancel(ok) || !ok) die('Docker is required. Install it (https://docs.docker.com/engine/install/) and re-run.')
  } else {
    console.log('Docker not found — installing Docker Engine (get.docker.com)…')
  }
  try { installDockerLinux() } catch (e) {
    die(`Docker installation failed: ${(e as Error)?.message ?? String(e)}. Install it manually and re-run.`)
  }
  if (!isDockerInstalled() || !dockerComposeWorks()) die('Docker still not working after install. Check `systemctl status docker`.')
  checkRunning()
}

/** EE always binds 80 + 443 (Caddy). On a first deploy, fail early with a clear
 *  message instead of a cryptic compose "port is already allocated" error. */
async function ensurePortsFree(interactive: boolean): Promise<void> {
  const busy = [80, 443].filter((port) => isTcpPortListening(port))
  if (busy.length) {
    const m = `Port(s) ${busy.join(' & ')} already in use — Caddy needs 80 and 443. Stop the other web server (nginx/apache/etc.) and re-run.`
    interactive ? p.log.error(m) : console.error(`Error: ${m}`)
    process.exit(1)
  }
}

/** Reuse existing secrets on redeploy so an initialized DB keeps working. */
function readExistingSecrets(installDir: string): Partial<EeSecrets> {
  const envPath = path.join(installDir, '.env')
  if (!fs.existsSync(envPath)) return {}
  const txt = fs.readFileSync(envPath, 'utf-8')
  const get = (k: string): string | undefined => {
    const m = txt.match(new RegExp(`^${k}=(.*)$`, 'm'))
    return m ? m[1].replace(/\$\$/g, '$') : undefined
  }
  return {
    dbPassword: get('DB_PASSWORD'),
    jwtSecret: get('LEARNHOUSE_AUTH_JWT_SECRET_KEY'),
    collabKey: get('COLLAB_INTERNAL_KEY'),
  }
}

function resolveSecrets(installDir: string): EeSecrets {
  const fresh = generateEeSecrets()
  const existing = readExistingSecrets(installDir)
  return {
    dbPassword: existing.dbPassword || fresh.dbPassword,
    jwtSecret: existing.jwtSecret || fresh.jwtSecret,
    collabKey: existing.collabKey || fresh.collabKey,
  }
}

function writeEeFiles(config: SetupConfig, secrets: EeSecrets): void {
  const dir = config.installDir
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'docker-compose.yml'), generateEeDockerCompose(config))
  fs.writeFileSync(path.join(dir, '.env'), generateEeEnv(config, secrets))
  fs.chmodSync(path.join(dir, '.env'), 0o600)
  fs.writeFileSync(path.join(dir, 'Caddyfile'), generateEeCaddyfile(config))
  if (!isExternalDb(config)) {
    fs.writeFileSync(path.join(dir, 'pgvector-init.sql'), generatePgvectorInit())
  }
  if (isCloudflareDns(config)) {
    fs.writeFileSync(path.join(dir, 'caddy.Dockerfile'), generateCaddyDockerfile())
  }
  if (config.eeLocalTls) {
    fs.writeFileSync(path.join(dir, 'docker-compose.override.yml'), generateEeLocalTlsOverride())
  }
  writeConfig(config)
}

function dnsBlock(config: SetupConfig, ip: string): string {
  const lines: string[] = []
  lines.push('')
  lines.push(pc.bold('  DNS records to create at your registrar'))
  lines.push(pc.dim('  ────────────────────────────────────────────────'))
  if (isAgency(config)) {
    lines.push(`  ${config.domain.padEnd(34)} A   ${ip}`)
    lines.push(`  ${('*.' + config.domain).padEnd(34)} A   ${ip}   ${pc.dim('(wildcard — tenant subdomains)')}`)
  } else {
    lines.push(`  ${config.domain.padEnd(34)} A   ${ip}`)
  }
  lines.push('')
  lines.push(`  ${pc.cyan('URL:')}    https://${config.domain}`)
  lines.push(`  ${pc.cyan('Admin:')}  ${config.adminEmail}`)
  lines.push(pc.yellow('  Change the admin password immediately after first login.'))
  if (config.eeLocalTls) {
    lines.push(pc.dim('  TLS: internal CA (self-signed) — browsers warn; map the names above'))
    lines.push(pc.dim('  in /etc/hosts to this server for local/custom-domain testing.'))
  } else {
    lines.push(pc.dim('  Caddy issues a Let’s Encrypt cert once DNS resolves here (~1–2 min).'))
  }
  return lines.join('\n')
}

/** Reuse the existing deploymentId on redeploy so the compose project name (and
 *  therefore the data volumes) stay the same. A new id would orphan the DB. */
function resolveDeploymentId(installDir: string, firstDeploy: boolean): string {
  if (!firstDeploy) {
    const existing = readConfig(installDir)?.deploymentId
    if (existing) return existing
  }
  return crypto.randomBytes(4).toString('hex')
}

function buildConfig(opts: {
  installDir: string
  tenancy: EeTenancy
  license: string
  domain: string
  acmeEmail: string
  adminEmail: string
  adminPassword: string
  eeImageTag: string
  localTls: boolean
  deploymentId: string
  externalDbUrl?: string
  dnsProvider?: 'cloudflare'
  cfApiToken?: string
  dockerIpv6?: boolean
}): SetupConfig {
  return {
    deploymentId: opts.deploymentId,
    installDir: opts.installDir,
    channel: 'stable',
    edition: 'enterprise',
    licenseKey: opts.license,
    eeTenancy: opts.tenancy,
    eeImageTag: opts.eeImageTag,
    eeLocalTls: opts.localTls,
    acmeEmail: opts.acmeEmail,
    domain: opts.domain,
    externalDbUrl: opts.externalDbUrl,
    dnsProvider: opts.dnsProvider,
    cfApiToken: opts.cfApiToken,
    dockerIpv6: opts.dockerIpv6,
    useHttps: true,
    httpPort: 443,
    autoSsl: !opts.localTls,
    useExternalDb: false,
    useAiDatabase: true,
    useExternalRedis: false,
    orgName: 'Default Organization',
    orgSlug: 'default',
    adminEmail: opts.adminEmail,
    adminPassword: opts.adminPassword,
    aiEnabled: false,
    emailEnabled: false,
    s3Enabled: false,
    googleOAuthEnabled: false,
    unsplashEnabled: false,
  }
}

async function startEe(config: SetupConfig, interactive: boolean, firstDeploy: boolean): Promise<void> {
  const dir = config.installDir
  // On a fresh deploy, fail early if 80/443 are taken (not on redeploy — our own Caddy holds them).
  if (firstDeploy) await ensurePortsFree(interactive)
  // Validate the license by authenticating to the registry BEFORE pulling.
  try {
    dockerLogin(EE_REGISTRY, EE_REGISTRY_USERNAME, config.licenseKey || '')
  } catch (err) {
    const stderr = (err as { stderr?: string })?.stderr ?? ''
    const msg = `Registry login to ${EE_REGISTRY} failed — the license key is invalid or has no EE entitlement.`
    if (interactive) { p.log.error(msg); if (stderr) p.log.message(pc.dim(stderr.trim())) }
    else { console.error(msg); if (stderr) console.error(stderr.trim()) }
    process.exit(1)
  }

  try {
    dockerComposePull(dir)
    dockerComposeUpRetry(dir, 3, (n) => {
      const m = `Start attempt ${n} failed (often first-boot DB health timing); retrying in 15s…`
      interactive ? p.log.warn(m) : console.log(m)
    })
  } catch (err) {
    const stderr = (err as { stderr?: Buffer })?.stderr?.toString?.() ?? ''
    const m = `Failed to pull or start the EE stack. Inspect with \`learnhouse logs\` (cd ${dir} && docker compose logs).`
    if (interactive) { p.log.error(m); if (stderr) p.log.message(pc.dim(stderr.trim().slice(0, 500))) }
    else { console.error(m); if (stderr) console.error(stderr.trim().slice(0, 500)) }
    process.exit(1)
  }

  const ready = await waitForEeReady(dir)
  if (ready === 'ee') {
    interactive ? p.log.success('API is up in EE mode — license active') : console.log('API is up in EE mode — license active')
  } else if (ready === 'oss') {
    const m = 'API is up but in OSS mode — license not active. Check `learnhouse logs`.'
    interactive ? p.log.warn(m) : console.warn(m)
  } else {
    const m = 'Could not confirm EE mode within timeout. The stack may still be starting.'
    interactive ? p.log.warn(m) : console.warn(m)
  }

  const ip = (await getPublicIp()) || '<this-server-public-IP>'
  const block = dnsBlock(config, ip)
  interactive ? p.log.message(block) : console.log(block)
}

// ─── CI / non-interactive ──────────────────────────────────────────────────
async function setupEnterpriseCi(options: EeSetupOptions): Promise<void> {
  const fail = (m: string): never => { console.error(`Error: ${m}`); process.exit(1); throw new Error(m) }

  if (!options.license) fail('--license is required for --edition enterprise')
  if (!options.domain) fail('--domain is required for --edition enterprise')
  if (!options.adminEmail) fail('--admin-email is required for --edition enterprise')
  if (!options.adminPassword) fail('--admin-password is required for --edition enterprise')

  const tenancy = (options.tenancy || 'single') as EeTenancy
  if (tenancy !== 'single' && tenancy !== 'agency') fail('--tenancy must be "single" or "agency"')

  const domain = normalizeDomain(options.domain!)
  const domErr = validateDomain(domain)
  if (domErr) fail(`--domain "${domain}" — ${domErr}`)

  const emailErr = validateEmail(options.adminEmail!)
  if (emailErr) fail(`--admin-email "${options.adminEmail}" — ${emailErr}`)

  const acmeEmail = options.acmeEmail || options.adminEmail!
  const acmeErr = validateEmail(acmeEmail)
  if (acmeErr) fail(`--acme-email "${acmeEmail}" — ${acmeErr}`)

  const pwErr = validatePassword(options.adminPassword!)
  if (pwErr) fail(`--admin-password — ${pwErr}`)

  if (options.dnsProvider && options.dnsProvider !== 'cloudflare') fail('--dns-provider only supports "cloudflare"')
  if (options.dnsProvider === 'cloudflare' && !options.cfApiToken) fail('--cf-api-token is required with --dns-provider cloudflare')
  if (options.externalDb && !/^postgres(ql)?:\/\//.test(options.externalDb)) fail('--external-db must be a postgresql:// connection URI')

  await ensureDockerReady(false)

  const installName = options.name || 'default'
  const installDir = options.installDir
    ? path.resolve(options.installDir)
    : path.join(os.homedir(), '.learnhouse', installName)
  const firstDeploy = !fs.existsSync(path.join(installDir, '.env'))

  const config = buildConfig({
    installDir,
    tenancy,
    license: options.license!,
    domain,
    acmeEmail,
    adminEmail: options.adminEmail!,
    adminPassword: options.adminPassword!,
    eeImageTag: options.eeImageTag || EE_DEFAULT_IMAGE_TAG,
    localTls: !!options.localTls,
    deploymentId: resolveDeploymentId(installDir, firstDeploy),
    externalDbUrl: options.externalDb,
    dnsProvider: options.dnsProvider as 'cloudflare' | undefined,
    cfApiToken: options.cfApiToken,
    dockerIpv6: !!options.dockerIpv6,
  })

  const secrets = resolveSecrets(installDir)
  console.log(`Setting up LearnHouse Enterprise (${tenancy}) in ${installDir}`)
  try {
    writeEeFiles(config, secrets)
  } catch (err) {
    fail(`could not write configuration files to ${installDir}: ${(err as Error)?.message ?? String(err)}`)
  }
  console.log('Configuration files generated')

  if (options.start === false) {
    console.log(`Files generated. Start with: cd ${installDir} && docker compose up -d`)
    return
  }
  await startEe(config, false, firstDeploy)
}

// ─── Interactive ────────────────────────────────────────────────────────────
async function setupEnterpriseInteractive(options: EeSetupOptions): Promise<void> {
  p.log.step(pc.cyan('Enterprise Edition'))
  await ensureDockerReady(true)

  const exit = <T>(v: T | symbol): T => {
    if (p.isCancel(v)) { p.cancel('Setup cancelled.'); process.exit(0) }
    return v as T
  }

  const tenancy = exit(await p.select({
    message: 'Deployment type',
    options: [
      { value: 'single', label: 'Single tenant', hint: 'one organization on one domain' },
      { value: 'agency', label: 'Agency (multi-tenant)', hint: 'many tenants on a wildcard domain' },
    ],
  })) as EeTenancy

  const license = exit(await p.password({
    message: 'License key (Partners Portal → Licenses)',
    validate: (v) => (v ? undefined : 'License key is required'),
  })) as string

  const domainLabel = tenancy === 'agency'
    ? 'Apex / agency domain (e.g. learn.acme.com — tenants become <slug>.learn.acme.com)'
    : 'Domain (e.g. learn.acme.com)'
  const domainRaw = exit(await p.text({
    message: domainLabel,
    validate: (v) => validateDomain(normalizeDomain(v)),
  })) as string
  const domain = normalizeDomain(domainRaw)

  const acmeEmail = exit(await p.text({
    message: 'Email for Let’s Encrypt expiry notices',
    validate: validateEmail,
  })) as string

  const adminEmail = exit(await p.text({
    message: 'Initial admin email (real domain required)',
    validate: validateEmail,
  })) as string

  const adminPassword = exit(await p.password({
    message: `Initial admin password (min 8 chars)`,
    validate: (v) => validatePassword(v ?? ''),
  })) as string

  const localTls = exit(await p.confirm({
    message: 'Use Caddy internal CA (self-signed) for local/custom-domain testing?',
    initialValue: false,
  })) as boolean

  const installName = options.name || 'default'
  const installDir = options.installDir
    ? path.resolve(options.installDir)
    : path.join(os.homedir(), '.learnhouse', installName)

  const firstDeploy = !fs.existsSync(path.join(installDir, '.env'))
  if (!firstDeploy) {
    const overwrite = exit(await p.confirm({
      message: `An install exists at ${installDir}. Redeploy (keeps DB password + secrets)?`,
      initialValue: true,
    })) as boolean
    if (!overwrite) { p.cancel('Setup cancelled.'); process.exit(0) }
  }

  const config = buildConfig({
    installDir, tenancy, license, domain, acmeEmail, adminEmail, adminPassword,
    eeImageTag: options.eeImageTag || EE_DEFAULT_IMAGE_TAG,
    localTls,
    deploymentId: resolveDeploymentId(installDir, firstDeploy),
    externalDbUrl: options.externalDb,
    dnsProvider: options.dnsProvider as 'cloudflare' | undefined,
    cfApiToken: options.cfApiToken,
    dockerIpv6: !!options.dockerIpv6,
  })

  const secrets = resolveSecrets(installDir)
  const s = p.spinner()
  s.start('Generating configuration files')
  try {
    writeEeFiles(config, secrets)
  } catch (err) {
    s.stop('Failed to generate configuration files')
    p.log.error(`Could not write to ${installDir}: ${(err as Error)?.message ?? String(err)}`)
    process.exit(1)
  }
  s.stop('Configuration files generated')

  const startNow = exit(await p.confirm({ message: 'Start LearnHouse Enterprise now?', initialValue: true })) as boolean
  if (!startNow) {
    p.log.info(`Files generated in ${installDir}`)
    p.log.message(`  Start later with: cd ${installDir} && docker compose up -d`)
    p.outro(pc.dim('Happy teaching!'))
    return
  }

  const s2 = p.spinner()
  s2.start('Authenticating, pulling EE images and starting (a few minutes)')
  try {
    await startEe(config, true, firstDeploy)
    s2.stop('Enterprise stack started')
  } catch (err) {
    s2.stop('Failed to start')
    throw err
  }
  p.outro(pc.dim('Happy teaching!'))
}

export async function setupEnterprise(options: EeSetupOptions): Promise<void> {
  if (options.ci) return setupEnterpriseCi(options)
  return setupEnterpriseInteractive(options)
}
