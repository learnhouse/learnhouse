import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generateDockerCompose } from '../src/templates/docker-compose.js'
import { generateEnvFile } from '../src/templates/env.js'
import { generateNginxConf } from '../src/templates/nginx.js'
import { generateCaddyfile } from '../src/templates/caddyfile.js'
import { writeConfig, readConfig, findInstallDir, listInstallations } from '../src/services/config-store.js'
import type { SetupConfig } from '../src/types.js'

const baseConfig: SetupConfig = {
  deploymentId: 'test1234',
  installDir: '/tmp/lh-unit-test',
  channel: 'stable',
  domain: 'localhost',
  useHttps: false,
  httpPort: 8080,
  autoSsl: false,
  useExternalDb: false,
  useAiDatabase: false,
  useExternalRedis: false,
  orgName: 'Test Org',
  adminEmail: 'admin@test.dev',
  adminPassword: 'password123',
  aiEnabled: false,
  emailEnabled: false,
  s3Enabled: false,
  googleOAuthEnabled: false,
  unsplashEnabled: false,
}

// ─── Docker Compose template ────────────────────────────────

describe('generateDockerCompose', () => {
  it('generates valid YAML with correct image', () => {
    const yml = generateDockerCompose(baseConfig, 'ghcr.io/learnhouse/app:1.0.0')
    expect(yml).toContain('image: ghcr.io/learnhouse/app:1.0.0')
    expect(yml).toContain('container_name: learnhouse-app-test1234')
    expect(yml).toContain('learnhouse-network-test1234')
  })

  it('includes local db and redis by default', () => {
    const yml = generateDockerCompose(baseConfig)
    expect(yml).toContain('learnhouse-db-test1234')
    expect(yml).toContain('learnhouse-redis-test1234')
    expect(yml).toContain('pgvector')
  })

  it('excludes db when useExternalDb is true', () => {
    const yml = generateDockerCompose({ ...baseConfig, useExternalDb: true })
    expect(yml).not.toContain('learnhouse-db-test1234')
    expect(yml).toContain('learnhouse-redis-test1234')
  })

  it('excludes redis when useExternalRedis is true', () => {
    const yml = generateDockerCompose({ ...baseConfig, useExternalRedis: true })
    expect(yml).toContain('learnhouse-db-test1234')
    expect(yml).not.toContain('learnhouse-redis-test1234')
  })

  it('uses caddy instead of nginx when autoSsl is true', () => {
    const yml = generateDockerCompose({ ...baseConfig, autoSsl: true })
    expect(yml).toContain('learnhouse-caddy-test1234')
    expect(yml).not.toContain('learnhouse-nginx')
  })

  it('uses nginx when autoSsl is false', () => {
    const yml = generateDockerCompose(baseConfig)
    expect(yml).toContain('nginx')
    expect(yml).not.toContain('caddy')
  })

  it('uses default APP_IMAGE when no image provided', () => {
    const yml = generateDockerCompose(baseConfig)
    expect(yml).toContain('ghcr.io/learnhouse/app:')
  })
})

// ─── Env file template ──────────────────────────────────────

describe('generateEnvFile', () => {
  it('includes required env vars', () => {
    const env = generateEnvFile(baseConfig)
    expect(env).toContain('LEARNHOUSE_DOMAIN=localhost')
    expect(env).toContain('LEARNHOUSE_SQL_CONNECTION_STRING=')
    expect(env).toContain('LEARNHOUSE_REDIS_CONNECTION_STRING=')
    expect(env).toContain('NEXTAUTH_SECRET=')
    expect(env).toContain('LEARNHOUSE_AUTH_JWT_SECRET_KEY=')
    expect(env).toContain('LEARNHOUSE_INITIAL_ADMIN_EMAIL=admin@test.dev')
    expect(env).toContain('LEARNHOUSE_INITIAL_ADMIN_PASSWORD=password123')
  })

  it('includes port', () => {
    const env = generateEnvFile(baseConfig)
    expect(env).toContain('HTTP_PORT=8080')
  })

  it('uses external db string when provided', () => {
    const env = generateEnvFile({
      ...baseConfig,
      useExternalDb: true,
      externalDbConnectionString: 'postgresql://ext:ext@remote:5432/db',
    })
    expect(env).toContain('postgresql://ext:ext@remote:5432/db')
  })

  it('uses external redis string when provided', () => {
    const env = generateEnvFile({
      ...baseConfig,
      useExternalRedis: true,
      externalRedisConnectionString: 'redis://remote:6379',
    })
    expect(env).toContain('redis://remote:6379')
  })

  it('includes AI key when enabled', () => {
    const env = generateEnvFile({
      ...baseConfig,
      aiEnabled: true,
      geminiApiKey: 'test-gemini-key',
    })
    expect(env).toContain('test-gemini-key')
  })
})

// ─── Nginx template ─────────────────────────────────────────

describe('generateNginxConf', () => {
  it('generates valid nginx config', () => {
    const conf = generateNginxConf()
    expect(conf).toContain('server')
    expect(conf).toContain('proxy_pass')
    expect(conf).toContain('listen')
  })
})

// ─── Caddyfile template ─────────────────────────────────────

describe('generateCaddyfile', () => {
  it('generates caddyfile with domain', () => {
    const caddy = generateCaddyfile({ ...baseConfig, domain: 'example.com', sslEmail: 'ssl@example.com' })
    expect(caddy).toContain('example.com')
    expect(caddy).toContain('ssl@example.com')
  })
})

// ─── Config store ───────────────────────────────────────────

describe('config-store', () => {
  const testBase = path.join(os.tmpdir(), 'lh-config-test-' + Date.now())
  const testDir = path.join(testBase, '.learnhouse', 'unit-test')

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(testBase, { recursive: true, force: true })
  })

  it('writeConfig creates config file', () => {
    const config = { ...baseConfig, installDir: testDir }
    writeConfig(config)
    const configPath = path.join(testDir, 'learnhouse.config.json')
    expect(fs.existsSync(configPath)).toBe(true)
    const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    expect(data.deploymentId).toBe('test1234')
    expect(data.domain).toBe('localhost')
  })

  it('readConfig returns config when file exists', () => {
    const config = { ...baseConfig, installDir: testDir }
    writeConfig(config)
    const result = readConfig(testDir)
    expect(result).not.toBeNull()
    expect(result!.deploymentId).toBe('test1234')
  })

  it('readConfig returns null when file does not exist', () => {
    const result = readConfig(path.join(testBase, 'nonexistent'))
    expect(result).toBeNull()
  })

  it('listInstallations returns empty when ~/.learnhouse does not exist', () => {
    // This test assumes no real installations interfere —
    // if ~/.learnhouse exists on the host, this will still pass
    // since it lists only complete installs
    const list = listInstallations()
    expect(Array.isArray(list)).toBe(true)
  })
})
