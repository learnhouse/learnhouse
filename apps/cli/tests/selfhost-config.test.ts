import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { generateEnvFile, isIpAddress } from '../src/templates/env.js'
import { mergeEnvContent, FEATURE_ENV_KEYS } from '../src/utils/env-file.js'
import { generateDockerCompose } from '../src/templates/docker-compose.js'
import type { SetupConfig } from '../src/types.js'
import { FAKE_DOCKER } from './platform.js'

const CLI_BIN = path.resolve(__dirname, '../dist/bin/learnhouse.js')

function baseConfig(over: Partial<SetupConfig> = {}): SetupConfig {
  return {
    deploymentId: 'abc123',
    installDir: '/tmp/lh',
    channel: 'stable',
    domain: 'learn.school.org',
    useHttps: false,
    httpPort: 80,
    autoSsl: false,
    useExternalDb: false,
    dbPassword: 'pw',
    useAiDatabase: false,
    useExternalRedis: false,
    orgName: 'School',
    orgSlug: 'school',
    adminEmail: 'admin@school.org',
    adminPassword: 'password123',
    aiEnabled: false,
    emailEnabled: false,
    s3Enabled: false,
    googleOAuthEnabled: false,
    ...over,
  }
}

function envMap(content: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) out[m[1]] = m[2]
  }
  return out
}

describe('generateEnvFile: public URL settings', () => {
  it('writes the HTTPS flag in the lowercase form the web app reads', () => {
    expect(envMap(generateEnvFile(baseConfig({ useHttps: true }))).NEXT_PUBLIC_LEARNHOUSE_HTTPS).toBe('true')
    expect(envMap(generateEnvFile(baseConfig())).NEXT_PUBLIC_LEARNHOUSE_HTTPS).toBe('false')
  })

  it('tells the API its public scheme, frontend domain and media URL', () => {
    const env = envMap(generateEnvFile(baseConfig({ useHttps: true })))
    expect(env.LEARNHOUSE_SSL).toBe('true')
    expect(env.LEARNHOUSE_FRONTEND_DOMAIN).toBe('learn.school.org')
    expect(env.LEARNHOUSE_MEDIA_URL).toBe('https://learn.school.org')
    expect(env.LEARNHOUSE_TENANCY).toBe('single')
  })

  it('keeps a non-default port in the frontend domain and media URL', () => {
    const env = envMap(generateEnvFile(baseConfig({ httpPort: 8080 })))
    expect(env.LEARNHOUSE_SSL).toBe('false')
    expect(env.LEARNHOUSE_FRONTEND_DOMAIN).toBe('learn.school.org:8080')
    expect(env.LEARNHOUSE_MEDIA_URL).toBe('http://learn.school.org:8080')
  })

  it('no longer writes a cookie domain (single tenancy ignores it)', () => {
    expect(generateEnvFile(baseConfig())).not.toContain('LEARNHOUSE_COOKIE_DOMAIN')
  })

  it('uses the whole IP address as the top domain', () => {
    const env = envMap(generateEnvFile(baseConfig({ domain: '203.0.113.7' })))
    expect(env.NEXT_PUBLIC_LEARNHOUSE_TOP_DOMAIN).toBe('203.0.113.7')
    expect(env.LEARNHOUSE_FRONTEND_DOMAIN).toBe('203.0.113.7')
  })

  it('writes S3 credentials and region for the S3 client', () => {
    const env = envMap(generateEnvFile(baseConfig({
      s3Enabled: true, s3BucketName: 'b', s3EndpointUrl: 'http://minio:9000',
      s3Region: 'eu-west-1', s3AccessKeyId: 'AKIA1', s3SecretAccessKey: 'shh',
    })))
    expect(env.LEARNHOUSE_CONTENT_DELIVERY_TYPE).toBe('s3api')
    expect(env.AWS_DEFAULT_REGION).toBe('eu-west-1')
    expect(env.LEARNHOUSE_S3_API_REGION).toBe('eu-west-1')
    expect(env.AWS_ACCESS_KEY_ID).toBe('AKIA1')
    expect(env.AWS_SECRET_ACCESS_KEY).toBe('shh')
  })

  it('leaves S3 credentials out when none were given (instance role)', () => {
    const out = generateEnvFile(baseConfig({ s3Enabled: true, s3BucketName: 'b' }))
    expect(out).not.toContain('AWS_ACCESS_KEY_ID')
    expect(out).not.toContain('AWS_DEFAULT_REGION')
  })

  it('isIpAddress', () => {
    expect(isIpAddress('10.0.0.1')).toBe(true)
    expect(isIpAddress('learn.school.org')).toBe(false)
    expect(isIpAddress('localhost')).toBe(false)
  })
})

describe('generateDockerCompose', () => {
  it('points server-side rendering at the API inside the container', () => {
    expect(generateDockerCompose(baseConfig())).toContain('LEARNHOUSE_INTERNAL_API_URL=http://localhost:9000')
  })
})

describe('mergeEnvContent', () => {
  const generated = 'A=new\nLEARNHOUSE_CONTENT_DELIVERY_TYPE=filesystem\n'

  it('keeps keys the new file does not write', () => {
    const out = mergeEnvContent(generated, 'A=old\nLEARNHOUSE_AI_PROVIDER=openai\n')
    expect(envMap(out)).toMatchObject({ A: 'new', LEARNHOUSE_AI_PROVIDER: 'openai' })
    expect(out).toContain('# Kept from the previous configuration')
  })

  it('drops the retired cookie domain', () => {
    expect(mergeEnvContent(generated, 'LEARNHOUSE_COOKIE_DOMAIN=.school.org\n')).not.toContain('COOKIE_DOMAIN')
  })

  it('drops feature settings the new configuration switched off', () => {
    const out = mergeEnvContent(generated, 'LEARNHOUSE_EMAIL_PROVIDER=smtp\nLEARNHOUSE_SMTP_HOST=mail\n')
    expect(out).not.toContain('LEARNHOUSE_EMAIL_PROVIDER')
    expect(out).not.toContain('LEARNHOUSE_SMTP_HOST')
  })

  it('keeps the previous value of kept keys, written or not', () => {
    const previous = 'LEARNHOUSE_CONTENT_DELIVERY_TYPE=s3api\nLEARNHOUSE_S3_API_BUCKET_NAME=b\nA=old\n'
    const env = envMap(mergeEnvContent(generated, previous, FEATURE_ENV_KEYS))
    expect(env).toMatchObject({ A: 'new', LEARNHOUSE_CONTENT_DELIVERY_TYPE: 's3api', LEARNHOUSE_S3_API_BUCKET_NAME: 'b' })
  })

  it('adds nothing when there is nothing to carry', () => {
    expect(mergeEnvContent(generated, 'A=old\n')).toBe(generated)
  })
})

describe('CLI: setup --ci HTTPS, IP domains and reconfigure', () => {
  let home: string

  beforeAll(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-selfhost-')) })
  afterAll(() => { try { fs.rmSync(home, { recursive: true, force: true }) } catch { /* ignore */ } })

  function setup(name: string, args: string[]) {
    return spawnSync('node', [CLI_BIN, 'setup', '--ci', '--name', name, '--admin-password', 'testpassword1', '--no-start', ...args], {
      encoding: 'utf-8', timeout: 30_000,
      env: { ...process.env, HOME: home, USERPROFILE: home, NO_COLOR: '1', CI: '1', LEARNHOUSE_DOCKER_BIN: FAKE_DOCKER },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  }
  const dir = (name: string) => path.join(home, '.learnhouse', name)
  const read = (name: string, file: string) => fs.readFileSync(path.join(dir(name), file), 'utf-8')

  it('rejects an unknown --https mode', () => {
    const r = setup('https-bad', ['--domain', 'learn.school.org', '--port', '9171', '--https', 'yes'])
    expect(r.status).toBe(1)
    expect(r.stdout + r.stderr).toMatch(/auto, manual or off/)
  })

  it('rejects --https on localhost', () => {
    const r = setup('https-local', ['--port', '9171', '--https', 'manual'])
    expect(r.status).toBe(1)
    expect(r.stdout + r.stderr).toMatch(/real --domain/)
  })

  it('rejects --https auto for an IP address', () => {
    const r = setup('https-ip', ['--domain', '203.0.113.7', '--port', '9171', '--https', 'auto', '--ssl-email', 'ops@school.org'])
    expect(r.status).toBe(1)
    expect(r.stdout + r.stderr).toMatch(/IP addresses/)
  })

  it('rejects --https auto without a contact email', () => {
    const r = setup('https-noemail', ['--domain', 'learn.school.org', '--port', '9171', '--https', 'auto'])
    expect(r.status).toBe(1)
    expect(r.stdout + r.stderr).toMatch(/--ssl-email/)
  })

  it('rejects an invalid --ssl-email', () => {
    const r = setup('https-bademail', ['--domain', 'learn.school.org', '--port', '9171', '--https', 'auto', '--ssl-email', 'nope'])
    expect(r.status).toBe(1)
    expect(r.stdout + r.stderr).toMatch(/--ssl-email/)
  })

  it('accepts an IP address as the domain', () => {
    const r = setup('ip', ['--domain', '203.0.113.7', '--port', '9172'])
    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(envMap(read('ip', '.env')).NEXTAUTH_URL).toBe('http://203.0.113.7:9172')
  })

  it('--https manual writes https URLs behind your own proxy', () => {
    const r = setup('manual', ['--domain', 'learn.school.org', '--port', '9173', '--https', 'manual'])
    expect(r.status, r.stdout + r.stderr).toBe(0)
    const env = envMap(read('manual', '.env'))
    expect(env.NEXTAUTH_URL).toBe('https://learn.school.org')
    expect(env.NEXT_PUBLIC_LEARNHOUSE_HTTPS).toBe('true')
    expect(read('manual', 'extra/nginx.prod.conf')).toContain('X-Forwarded-Proto https')
  })

  it('--https auto sets up Caddy with the contact email', () => {
    const r = setup('auto', ['--domain', 'learn.school.org', '--port', '9174', '--https', 'auto', '--ssl-email', 'ops@school.org'])
    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(read('auto', 'extra/Caddyfile')).toContain('email ops@school.org')
    expect(read('auto', 'docker-compose.yml')).toContain('caddy:')
    expect(JSON.parse(read('auto', 'learnhouse.config.json'))).toMatchObject({ useHttps: true, autoSsl: true })
  })

  it('re-running --ci keeps HTTPS, feature settings and hand-added keys', () => {
    expect(setup('rerun', ['--domain', 'learn.school.org', '--port', '9175', '--https', 'auto', '--ssl-email', 'ops@school.org']).status).toBe(0)
    const envPath = path.join(dir('rerun'), '.env')
    const original = fs.readFileSync(envPath, 'utf-8')
    fs.writeFileSync(envPath, original
      .replace('LEARNHOUSE_CONTENT_DELIVERY_TYPE=filesystem', 'LEARNHOUSE_CONTENT_DELIVERY_TYPE=s3api\nLEARNHOUSE_S3_API_BUCKET_NAME=media')
      + 'LEARNHOUSE_AI_PROVIDER=openai\nLEARNHOUSE_COOKIE_DOMAIN=.school.org\n')
    const secret = envMap(original).NEXTAUTH_SECRET

    const r = setup('rerun', ['--domain', 'learn.school.org', '--org-name', 'Renamed'])
    expect(r.status, r.stdout + r.stderr).toBe(0)
    const env = envMap(fs.readFileSync(envPath, 'utf-8'))
    expect(env).toMatchObject({
      NEXTAUTH_SECRET: secret,
      NEXTAUTH_URL: 'https://learn.school.org:9175',
      LEARNHOUSE_CONTENT_DELIVERY_TYPE: 's3api',
      LEARNHOUSE_S3_API_BUCKET_NAME: 'media',
      LEARNHOUSE_AI_PROVIDER: 'openai',
      LEARNHOUSE_INITIAL_ORG_NAME: 'Renamed',
    })
    expect(env.LEARNHOUSE_COOKIE_DOMAIN).toBeUndefined()
    expect(read('rerun', 'extra/Caddyfile')).toContain('email ops@school.org')
    // S3 install: no local content volume
    expect(read('rerun', 'docker-compose.yml')).not.toContain('/app/api/content')
  })
})
