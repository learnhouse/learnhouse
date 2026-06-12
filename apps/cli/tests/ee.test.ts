import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { cli } from './helpers.js'
import type { SetupConfig } from '../src/types.js'
import {
  generateEeDockerCompose,
  generateEeCaddyfile,
  generateEeEnv,
  generateEeLocalTlsOverride,
  generatePgvectorInit,
  generateEeSecret,
  generateEeSecrets,
  escapeEnvValue,
  isAgency,
  eeDomainVar,
} from '../src/templates/ee.js'
import { writeConfig } from '../src/services/config-store.js'
import { quoteEnvValue } from '../src/utils/env-quote.js'

function baseEe(overrides: Partial<SetupConfig> = {}): SetupConfig {
  return {
    deploymentId: 'abcd1234',
    installDir: '/tmp/x',
    channel: 'stable',
    edition: 'enterprise',
    licenseKey: 'lh_live_TESTKEY',
    eeTenancy: 'single',
    eeImageTag: 'prod',
    eeLocalTls: false,
    acmeEmail: 'ops@acme.com',
    domain: 'learn.acme.com',
    useHttps: true,
    httpPort: 443,
    autoSsl: true,
    useExternalDb: false,
    useAiDatabase: true,
    useExternalRedis: false,
    orgName: 'Default Organization',
    orgSlug: 'default',
    adminEmail: 'admin@acme.com',
    adminPassword: 'sup3rsecret',
    aiEnabled: false,
    emailEnabled: false,
    s3Enabled: false,
    googleOAuthEnabled: false,
    unsplashEnabled: false,
    ...overrides,
  }
}

describe('EE secrets', () => {
  it('generateEeSecret is URL-safe and long enough', () => {
    for (let i = 0; i < 50; i++) {
      const s = generateEeSecret()
      expect(s).not.toMatch(/[+/=]/)
      expect(s.length).toBeGreaterThanOrEqual(32)
    }
  })
  it('generateEeSecrets returns three distinct secrets', () => {
    const s = generateEeSecrets()
    expect(new Set([s.dbPassword, s.jwtSecret, s.collabKey]).size).toBe(3)
  })
  it('escapeEnvValue doubles $ for compose interpolation', () => {
    expect(escapeEnvValue('p@ss$word')).toBe('p@ss$$word')
    expect(escapeEnvValue('nodollar')).toBe('nodollar')
  })
})

describe('EE helpers', () => {
  it('isAgency / eeDomainVar', () => {
    expect(isAgency(baseEe({ eeTenancy: 'single' }))).toBe(false)
    expect(isAgency(baseEe({ eeTenancy: 'agency' }))).toBe(true)
    expect(eeDomainVar(baseEe({ eeTenancy: 'single' }))).toBe('DOMAIN')
    expect(eeDomainVar(baseEe({ eeTenancy: 'agency' }))).toBe('AGENCY_DOMAIN')
  })
})

describe('generateEeDockerCompose (single)', () => {
  const yml = generateEeDockerCompose(baseEe())
  it('uses the EE registry images', () => {
    expect(yml).toContain('images.learnhouse.app/enterprise-backend:${EE_IMAGE_TAG:-prod}')
    expect(yml).toContain('images.learnhouse.app/enterprise-frontend:${EE_IMAGE_TAG:-prod}')
    expect(yml).toContain('images.learnhouse.app/enterprise-collab:${EE_IMAGE_TAG:-prod}')
  })
  it('namespaces project by deploymentId', () => {
    expect(yml).toContain('name: learnhouse-abcd1234')
  })
  it('has all six services', () => {
    for (const svc of ['db:', 'redis:', 'caddy:', 'api:', 'web:', 'collab:']) {
      expect(yml).toContain(`  ${svc}`)
    }
  })
  it('is single-tenant', () => {
    expect(yml).toContain('LEARNHOUSE_TENANCY: single')
    expect(yml).toContain('NEXT_PUBLIC_LEARNHOUSE_MULTI_ORG: "false"')
    expect(yml).not.toContain('LEARNHOUSE_TENANCY: multi')
  })
  it('uses the DOMAIN var for caddy', () => {
    expect(yml).toContain('DOMAIN: ${DOMAIN:?DOMAIN is required}')
  })
  it('declares the five named volumes', () => {
    for (const v of ['db_data:', 'api_data:', 'api_content:', 'caddy_data:', 'caddy_config:']) {
      expect(yml).toContain(v)
    }
  })
  it('forces HOSTNAME 0.0.0.0 for the loopback healthcheck', () => {
    expect(yml).toContain('HOSTNAME: 0.0.0.0')
  })
  it('honors a custom image tag', () => {
    const y = generateEeDockerCompose(baseEe({ eeImageTag: 'v1.2.3' }))
    expect(y).toContain('enterprise-backend:${EE_IMAGE_TAG:-v1.2.3}')
  })
})

describe('generateEeDockerCompose (agency)', () => {
  const yml = generateEeDockerCompose(baseEe({ eeTenancy: 'agency' }))
  it('is multi-tenant', () => {
    expect(yml).toContain('LEARNHOUSE_TENANCY: multi')
    expect(yml).toContain('NEXT_PUBLIC_LEARNHOUSE_MULTI_ORG: "true"')
  })
  it('uses AGENCY_DOMAIN + cookie domain', () => {
    expect(yml).toContain('AGENCY_DOMAIN: ${AGENCY_DOMAIN:?AGENCY_DOMAIN is required}')
    expect(yml).toContain('LEARNHOUSE_COOKIE_DOMAIN: .${AGENCY_DOMAIN}')
  })
})

describe('generateEeCaddyfile', () => {
  it('single: routes + email, no on-demand', () => {
    const c = generateEeCaddyfile(baseEe())
    expect(c).toContain('{$DOMAIN} {')
    expect(c).toContain('reverse_proxy api:9000')
    expect(c).toContain('reverse_proxy collab:4000')
    expect(c).toContain('reverse_proxy web:3000')
    expect(c).not.toContain('on_demand')
    expect(c).not.toContain('local_certs')
  })
  it('agency: wildcard site + on-demand TLS gate', () => {
    const c = generateEeCaddyfile(baseEe({ eeTenancy: 'agency' }))
    expect(c).toContain('{$AGENCY_DOMAIN}, *.{$AGENCY_DOMAIN} {')
    expect(c).toContain('on_demand_tls {')
    expect(c).toContain('ask http://api:9000/api/v1/orgs/domains/check')
    expect(c).toContain(':443 {')
  })
  it('local-tls injects local_certs (single + agency)', () => {
    expect(generateEeCaddyfile(baseEe({ eeLocalTls: true }))).toContain('local_certs')
    expect(generateEeCaddyfile(baseEe({ eeTenancy: 'agency', eeLocalTls: true }))).toContain('local_certs')
  })
})

describe('generateEeEnv', () => {
  const secrets = { dbPassword: 'DBPASS', jwtSecret: 'JWTSECRET', collabKey: 'COLLABKEY' }
  it('single: writes the env-var contract', () => {
    const env = generateEeEnv(baseEe(), secrets)
    expect(env).toContain('LEARNHOUSE_LICENSE_KEY=lh_live_TESTKEY')
    expect(env).toContain('DOMAIN=learn.acme.com')
    expect(env).toContain('ACME_EMAIL=ops@acme.com')
    expect(env).toContain('EE_IMAGE_TAG=prod')
    expect(env).toContain('DB_PASSWORD=DBPASS')
    expect(env).toContain('LEARNHOUSE_AUTH_JWT_SECRET_KEY=JWTSECRET')
    expect(env).toContain('COLLAB_INTERNAL_KEY=COLLABKEY')
    expect(env).toContain('LEARNHOUSE_INITIAL_ADMIN_EMAIL=admin@acme.com')
    expect(env).toContain('LEARNHOUSE_INITIAL_ADMIN_PASSWORD=sup3rsecret')
  })
  it('agency: uses AGENCY_DOMAIN', () => {
    const env = generateEeEnv(baseEe({ eeTenancy: 'agency' }), secrets)
    expect(env).toContain('AGENCY_DOMAIN=learn.acme.com')
    expect(env).not.toMatch(/^DOMAIN=/m)
  })
  it('quotes special-char admin password literally (single-quote scheme)', () => {
    const env = generateEeEnv(baseEe({ adminPassword: 'p@ss$word#1' }), secrets)
    expect(env).toContain("LEARNHOUSE_INITIAL_ADMIN_PASSWORD='p@ss$word#1'")
  })
  it('quotes admin email so $ cannot interpolate', () => {
    const env = generateEeEnv(baseEe({ adminEmail: 'a$b@corp.com' }), secrets)
    expect(env).toContain("LEARNHOUSE_INITIAL_ADMIN_EMAIL='a$b@corp.com'")
  })
})

describe('quoteEnvValue (compose-safe)', () => {
  it('leaves plain values unquoted', () => {
    expect(quoteEnvValue('simple')).toBe('simple')
    expect(quoteEnvValue('a@b.com')).toBe('a@b.com')
  })
  it('single-quotes values with $ / # / spaces / ! (no interpolation, no comment)', () => {
    expect(quoteEnvValue('p@ss$word#1!x')).toBe("'p@ss$word#1!x'")
    expect(quoteEnvValue('Pass with #hash')).toBe("'Pass with #hash'")
    expect(quoteEnvValue('$DB_PASSWORD')).toBe("'$DB_PASSWORD'")
    expect(quoteEnvValue('Trail ')).toBe("'Trail '")
  })
  it('single-quotes a backslash/quote value that has no single quote', () => {
    expect(quoteEnvValue('a"b\\c')).toBe("'a\"b\\c'")
  })
  it('double-quotes values containing a single quote (escaping " )', () => {
    expect(quoteEnvValue("emb'quote")).toBe(`"emb'quote"`)
    expect(quoteEnvValue(`a'b"c`)).toBe(`"a'b\\"c"`)
  })
  it('empty stays empty', () => {
    expect(quoteEnvValue('')).toBe('')
  })
})

describe('generateEeLocalTlsOverride + pgvector', () => {
  it('override disables Node TLS rejection for web/collab', () => {
    const o = generateEeLocalTlsOverride()
    expect(o).toContain('web:')
    expect(o).toContain('collab:')
    expect(o).toContain('NODE_TLS_REJECT_UNAUTHORIZED: "0"')
  })
  it('pgvector init enables the extension', () => {
    expect(generatePgvectorInit()).toContain('CREATE EXTENSION IF NOT EXISTS vector')
  })
})

describe('writeConfig persists EE metadata', () => {
  let dir: string
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-ee-cfg-')) })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })
  it('stores edition/tenancy/localTls for enterprise', () => {
    writeConfig(baseEe({ installDir: dir, eeTenancy: 'agency', eeLocalTls: true }))
    const json = JSON.parse(fs.readFileSync(path.join(dir, 'learnhouse.config.json'), 'utf-8'))
    expect(json.edition).toBe('enterprise')
    expect(json.eeTenancy).toBe('agency')
    expect(json.eeLocalTls).toBe(true)
  })
  it('marks community installs as community', () => {
    writeConfig(baseEe({ installDir: dir, edition: 'community' }))
    const json = JSON.parse(fs.readFileSync(path.join(dir, 'learnhouse.config.json'), 'utf-8'))
    expect(json.edition).toBe('community')
    expect(json.eeTenancy).toBeUndefined()
  })
})

// ── CI invocation (no docker; --no-start just generates files) ──────────────
describe('setup --ci --edition enterprise (file generation)', () => {
  let dir: string
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-ee-ci-')) })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  const base = (extra: string) =>
    `setup --ci --edition enterprise --install-dir ${dir} ` +
    `--license lh_live_TEST --domain learn.acme.com --acme-email ops@acme.com ` +
    `--admin-email admin@acme.com --admin-password supersecret --no-start ${extra}`

  it('single: generates the full EE file set', () => {
    const r = cli(base(''))
    expect(r.exitCode).toBe(0)
    expect(fs.existsSync(path.join(dir, 'docker-compose.yml'))).toBe(true)
    expect(fs.existsSync(path.join(dir, '.env'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'Caddyfile'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'pgvector-init.sql'))).toBe(true)
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'learnhouse.config.json'), 'utf-8'))
    expect(cfg.edition).toBe('enterprise')
    expect(cfg.eeTenancy).toBe('single')
    const compose = fs.readFileSync(path.join(dir, 'docker-compose.yml'), 'utf-8')
    expect(compose).toContain('LEARNHOUSE_TENANCY: single')
  })

  it('agency + local-tls: multi-tenant compose + override + local_certs', () => {
    const r = cli(base('--tenancy agency --local-tls'))
    expect(r.exitCode).toBe(0)
    expect(fs.existsSync(path.join(dir, 'docker-compose.override.yml'))).toBe(true)
    const compose = fs.readFileSync(path.join(dir, 'docker-compose.yml'), 'utf-8')
    expect(compose).toContain('LEARNHOUSE_TENANCY: multi')
    const caddy = fs.readFileSync(path.join(dir, 'Caddyfile'), 'utf-8')
    expect(caddy).toContain('local_certs')
    const env = fs.readFileSync(path.join(dir, '.env'), 'utf-8')
    expect(env).toContain('AGENCY_DOMAIN=learn.acme.com')
  })

  it('fails without a license key', () => {
    const r = cli(`setup --ci --edition enterprise --install-dir ${dir} --domain learn.acme.com --admin-email admin@acme.com --admin-password supersecret --no-start`)
    expect(r.exitCode).toBe(1)
    expect(r.stderr + r.stdout).toMatch(/--license is required/i)
  })

  it('rejects an invalid tenancy', () => {
    const r = cli(base('--tenancy sideways'))
    expect(r.exitCode).toBe(1)
    expect(r.stderr + r.stdout).toMatch(/tenancy/i)
  })

  it('rejects a reserved admin-email domain', () => {
    const r = cli(`setup --ci --edition enterprise --install-dir ${dir} --license lh_live_TEST --domain learn.acme.com --admin-email admin@example.com --admin-password supersecret --no-start`)
    expect(r.exitCode).toBe(1)
    expect(r.stderr + r.stdout).toMatch(/reserved|admin-email/i)
  })

  it('preserves secrets on redeploy', () => {
    cli(base(''))
    const env1 = fs.readFileSync(path.join(dir, '.env'), 'utf-8')
    const db1 = env1.match(/^DB_PASSWORD=(.*)$/m)?.[1]
    cli(base(''))
    const env2 = fs.readFileSync(path.join(dir, '.env'), 'utf-8')
    const db2 = env2.match(/^DB_PASSWORD=(.*)$/m)?.[1]
    expect(db1).toBeTruthy()
    expect(db2).toBe(db1)
  })

  it('reuses deploymentId on redeploy (so data volumes are not orphaned)', () => {
    cli(base(''))
    const id1 = JSON.parse(fs.readFileSync(path.join(dir, 'learnhouse.config.json'), 'utf-8')).deploymentId
    const composeName1 = fs.readFileSync(path.join(dir, 'docker-compose.yml'), 'utf-8').match(/^name:\s*(\S+)/m)?.[1]
    cli(base(''))
    const id2 = JSON.parse(fs.readFileSync(path.join(dir, 'learnhouse.config.json'), 'utf-8')).deploymentId
    const composeName2 = fs.readFileSync(path.join(dir, 'docker-compose.yml'), 'utf-8').match(/^name:\s*(\S+)/m)?.[1]
    expect(id1).toBeTruthy()
    expect(id2).toBe(id1)
    expect(composeName2).toBe(composeName1)
  })
})
