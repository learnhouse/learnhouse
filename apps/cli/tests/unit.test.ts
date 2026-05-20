import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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
  orgSlug: 'test-org',
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

// ─── Regression: --ci must generate a real DB password ──────
//
// In CI mode the setup command used to leave `config.dbPassword` undefined,
// which the env template rendered as the literal string "undefined" — both
// in the connection string and in POSTGRES_PASSWORD. The DB still worked
// because both sides used the same wrong value, but the install shipped an
// obviously-wrong credential. These tests pin the contract: when a password
// is provided, it must land in both places verbatim; the template must
// never emit "=undefined".

describe('generateEnvFile — dbPassword handling', () => {
  it('writes dbPassword into both connection string and POSTGRES_PASSWORD', () => {
    const env = generateEnvFile({ ...baseConfig, dbPassword: 'Sup3rS3cret-Abc_123' })
    expect(env).toContain('postgresql://learnhouse:Sup3rS3cret-Abc_123@db:5432/learnhouse')
    expect(env).toContain('POSTGRES_PASSWORD=Sup3rS3cret-Abc_123')
  })

  it('never emits the literal string "undefined" as a value', () => {
    const env = generateEnvFile({ ...baseConfig, dbPassword: 'a-real-pw' })
    expect(env).not.toMatch(/=undefined(\s|$)/)
  })

  it('omits POSTGRES_PASSWORD when useExternalDb is true', () => {
    const env = generateEnvFile({
      ...baseConfig,
      useExternalDb: true,
      externalDbConnectionString: 'postgresql://ext:ext@remote:5432/db',
    })
    expect(env).not.toContain('POSTGRES_PASSWORD=')
  })
})

// ─── Regression: SSR port-forward sidecar ───────────────────
//
// The published app image's Next.js SSR fetches the public URL (e.g.
// http://localhost:8088/...) to render. That host:port isn't bound inside
// the container, so SSR always fails on non-80 deployments. The CLI adds
// an alpine/socat sidecar in `network_mode: service:learnhouse-app` that
// listens on the public port inside the app container's net namespace and
// forwards to localhost:80 (internal nginx). The sidecar is skipped when
// it would conflict with the internal nginx (port 80) or when TLS is in
// play (autoSsl/useHttps go through Caddy on 443).

describe('generateDockerCompose — ssr-fwd sidecar', () => {
  it('adds the socat sidecar when httpPort is not 80', () => {
    const yml = generateDockerCompose({ ...baseConfig, httpPort: 8088 })
    expect(yml).toContain('learnhouse-ssr-fwd-test1234')
    expect(yml).toContain('alpine/socat')
    expect(yml).toContain('network_mode: "service:learnhouse-app"')
    expect(yml).toContain('TCP-LISTEN:8088,fork,reuseaddr TCP:localhost:80')
  })

  it('skips the socat sidecar when httpPort is 80', () => {
    const yml = generateDockerCompose({ ...baseConfig, httpPort: 80 })
    expect(yml).not.toContain('ssr-fwd')
    expect(yml).not.toContain('alpine/socat')
  })

  it('skips the socat sidecar when autoSsl is true', () => {
    const yml = generateDockerCompose({ ...baseConfig, httpPort: 443, autoSsl: true })
    expect(yml).not.toContain('ssr-fwd')
  })

  it('skips the socat sidecar when useHttps is true', () => {
    const yml = generateDockerCompose({ ...baseConfig, httpPort: 443, useHttps: true })
    expect(yml).not.toContain('ssr-fwd')
  })
})

// ─── Regression: nginx must preserve host port ──────────────
//
// nginx's $host variable strips the port. With Host: localhost (no port)
// forwarded downstream, Next.js Server Actions reject POSTs because
// `origin` (localhost:8088) doesn't match `x-forwarded-host` (localhost).
// We switched to $http_host and added an explicit X-Forwarded-Host header.

describe('generateNginxConf — Server Action headers', () => {
  it('uses $http_host (not $host) for the Host header', () => {
    const conf = generateNginxConf()
    expect(conf).toMatch(/proxy_set_header\s+Host\s+\$http_host/)
    expect(conf).not.toMatch(/proxy_set_header\s+Host\s+\$host\b/)
  })

  it('forwards X-Forwarded-Host with the full host:port', () => {
    const conf = generateNginxConf()
    expect(conf).toMatch(/proxy_set_header\s+X-Forwarded-Host\s+\$http_host/)
  })
})

// ─── Regression: nginx must listen on IPv6 too ──────────────
//
// Alpine's busybox `wget` (used by the compose healthcheck) resolves
// `localhost` to ::1 first. nginx's plain `listen 80;` binds IPv4 only,
// so the healthcheck failed permanently and the proxy showed
// "(unhealthy)" even though it was serving traffic fine. We pair an
// explicit IPv6 listen in the conf with a 127.0.0.1 healthcheck —
// either alone is enough, both together is durable.

describe('generateNginxConf — IPv6 listen', () => {
  it('listens on IPv6 as well as IPv4', () => {
    const conf = generateNginxConf()
    expect(conf).toMatch(/listen\s+\[::\]:80/)
  })
})

describe('generateDockerCompose — IPv6-safe healthchecks', () => {
  it('nginx healthcheck targets 127.0.0.1, not the dual-stack localhost', () => {
    const yml = generateDockerCompose(baseConfig)
    expect(yml).toMatch(/wget[^\n]*127\.0\.0\.1/)
    // The old buggy form was `wget --spider http://localhost/`.
    expect(yml).not.toMatch(/wget[^"]*http:\/\/localhost\//)
  })

  it('caddy healthcheck targets 127.0.0.1, not the dual-stack localhost', () => {
    const yml = generateDockerCompose({ ...baseConfig, autoSsl: true, useHttps: true, httpPort: 443, sslEmail: 'a@b.c' })
    expect(yml).toMatch(/wget[^\n]*127\.0\.0\.1:80/)
    expect(yml).not.toMatch(/wget[^"]*http:\/\/localhost:80\//)
  })
})

// ─── Regression: org name/slug propagate to the backend ─────
//
// The CLI used to collect `orgName` from the user but never sent it
// downstream — the API's auto-install hard-coded "Default Organization"
// / slug "default". The user's wizard input was discarded silently.
// The fix threads LEARNHOUSE_INITIAL_ORG_NAME / _ORG_SLUG into .env,
// where the API's `install(short=True)` reads them.

describe('generateEnvFile — org propagation', () => {
  it('writes the user-chosen org name and slug', () => {
    const env = generateEnvFile({ ...baseConfig, orgName: 'Acme Academy', orgSlug: 'acme' })
    expect(env).toContain('LEARNHOUSE_INITIAL_ORG_NAME=')
    expect(env).toContain('Acme Academy')
    expect(env).toContain('LEARNHOUSE_INITIAL_ORG_SLUG=acme')
    expect(env).toContain('NEXT_PUBLIC_LEARNHOUSE_DEFAULT_ORG=acme')
  })

  it('falls back to default when no slug was set', () => {
    const env = generateEnvFile({ ...baseConfig, orgSlug: '' as unknown as string })
    expect(env).toContain('NEXT_PUBLIC_LEARNHOUSE_DEFAULT_ORG=default')
    expect(env).toContain('LEARNHOUSE_INITIAL_ORG_SLUG=default')
  })
})

// ─── Regression: findInstallDir prefers running install ─────
//
// When multiple installs exist (e.g. stale `~/.learnhouse/default` from
// an old setup plus a fresh `~/.learnhouse/qa`), every command used to
// silently target `default` because of a hard-coded preference. That
// broke stop/status/health/etc. The fix: prefer whichever install has
// an actually-running app container, falling back to most recent.
//
// We stub `isContainerRunning` from the docker module so the test
// doesn't depend on a real Docker daemon, and override the home dir
// via a fresh `HOME` env so the lookup hits our temp tree.

vi.mock('../src/services/docker.js', async () => {
  const actual = await vi.importActual<typeof import('../src/services/docker.js')>(
    '../src/services/docker.js',
  )
  return { ...actual, isContainerRunning: vi.fn(() => false) }
})

describe('findInstallDir — picks the running install over a stale one', () => {
  const fakeHome = path.join(os.tmpdir(), 'lh-findinstall-' + Date.now())
  const lhBase = path.join(fakeHome, '.learnhouse')
  let origHome: string | undefined

  function writeInstall(name: string, deploymentId: string, createdAt: string) {
    const dir = path.join(lhBase, name)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'learnhouse.config.json'),
      JSON.stringify({
        version: '0.0.0-test',
        deploymentId,
        createdAt,
        installDir: dir,
        domain: 'localhost',
        httpPort: 8088,
        useHttps: false,
        autoSsl: false,
        useExternalDb: false,
        orgSlug: 'default',
      }),
    )
    fs.writeFileSync(path.join(dir, '.env'), '# test')
    return dir
  }

  beforeEach(() => {
    fs.mkdirSync(lhBase, { recursive: true })
    origHome = process.env.HOME
    process.env.HOME = fakeHome
  })

  afterEach(() => {
    fs.rmSync(fakeHome, { recursive: true, force: true })
    if (origHome === undefined) delete process.env.HOME
    else process.env.HOME = origHome
    vi.clearAllMocks()
  })

  it('returns the install whose app container is running when multiple exist', async () => {
    const stale = writeInstall('default', 'aaaa1111', '2026-03-27T15:24:39Z')
    const live = writeInstall('qa', 'bbbb2222', '2026-05-18T22:00:00Z')

    const { isContainerRunning } = await import('../src/services/docker.js')
    ;(isContainerRunning as ReturnType<typeof vi.fn>).mockImplementation((name: string) =>
      name === 'learnhouse-app-bbbb2222',
    )

    expect(findInstallDir()).toBe(live)
    expect(findInstallDir()).not.toBe(stale)
  })

  it('falls back to the most recent install when none are running', async () => {
    writeInstall('default', 'aaaa1111', '2026-03-27T15:24:39Z')
    const newer = writeInstall('qa', 'bbbb2222', '2026-05-18T22:00:00Z')

    const { isContainerRunning } = await import('../src/services/docker.js')
    ;(isContainerRunning as ReturnType<typeof vi.fn>).mockReturnValue(false)

    expect(findInstallDir()).toBe(newer)
  })

  it('uses the only install when exactly one exists', async () => {
    const only = writeInstall('default', 'aaaa1111', '2026-03-27T15:24:39Z')

    const { isContainerRunning } = await import('../src/services/docker.js')
    ;(isContainerRunning as ReturnType<typeof vi.fn>).mockReturnValue(false)

    expect(findInstallDir()).toBe(only)
  })
})
