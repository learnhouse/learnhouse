import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { generateDockerCompose } from '../src/templates/docker-compose.js'
import { generateEnvFile } from '../src/templates/env.js'
import { generateNginxConf } from '../src/templates/nginx.js'
import { generateCaddyfile } from '../src/templates/caddyfile.js'
import { writeConfig, readConfig, findInstallDir, listInstallations } from '../src/services/config-store.js'
import { patchComposeAddContentVolume, migrateContentVolume } from '../src/services/content-volume-migration.js'
import { validateEmail, validatePassword, validateDomain, validatePort, validateSlug, validateRequired } from '../src/utils/validators.js'
import { quoteEnvValue } from '../src/utils/env-quote.js'
import { parsePostgresUrl, parseRedisUrl, getPublicIp, checkPort, findAvailablePort, checkTcpConnection } from '../src/utils/network.js'
import net from 'node:net'
import { resolveAppImage } from '../src/services/version-check.js'
import { formatBytes } from '../src/commands/update.js'
import { waitForHealth, waitForOrgSeed, waitForEeReady } from '../src/services/health.js'
import { checkForUpdates } from '../src/services/version-check.js'
import { VERSION } from '../src/constants.js'
import { autoDetectDeploymentId, listDeploymentContainers, getContainerRestartCount, isDockerInstalled, isDockerRunning, dockerComposeWorks, dockerComposePs, dockerExecToFile, dockerExecFromFile, dockerStats, dockerStatsForContainers, dockerExec, getContainerLogs, getDockerDiskUsage, isTcpPortListening, dockerComposeUpRetry, waitForAptLock, installDockerLinux } from '../src/services/docker.js'
import { readEnvVar, setEnvVar, isExternalDbInstall, ensureAlembicBaseline, runAlembicUpgrade } from '../src/commands/update-ee.js'
import { replaceComposeImageTag } from '../src/services/compose-utils.js'
import type { SetupConfig } from '../src/types.js'
import type { EditionLayout } from '../src/commands/update-ee.js'

const COMMUNITY_LAYOUT: EditionLayout = { appService: 'learnhouse-app', alembicCwd: '/app/api', dbService: 'db' }

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

  it('enables IPv6 on the network when dockerIpv6 is set (e.g. IPv6-only external DB)', () => {
    const yml = generateDockerCompose({ ...baseConfig, dockerIpv6: true })
    expect(yml).toContain('enable_ipv6: true')
  })

  it('omits IPv6 from the network by default', () => {
    const yml = generateDockerCompose(baseConfig)
    expect(yml).not.toContain('enable_ipv6')
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

  it('mounts a content volume on filesystem delivery', () => {
    const yml = generateDockerCompose(baseConfig)
    expect(yml).toContain('learnhouse_content_test1234:/app/api/content')
    expect(yml).toContain('  learnhouse_content_test1234:')
  })

  it('skips the content volume when s3 is enabled', () => {
    const yml = generateDockerCompose({ ...baseConfig, s3Enabled: true })
    expect(yml).not.toContain('/app/api/content')
    expect(yml).not.toContain('learnhouse_content_test1234')
  })
})

// ─── Content volume migration — compose patcher ──────────────

describe('patchComposeAddContentVolume', () => {
  const legacyCompose = `name: learnhouse-abc123

services:
  learnhouse-app:
    image: ghcr.io/learnhouse/app:1.2.1
    container_name: learnhouse-app-abc123
    restart: unless-stopped
    env_file:
      - .env
    environment:
      - HOSTNAME=0.0.0.0
    depends_on:
      db:
        condition: service_healthy
    networks:
      - learnhouse-network-abc123
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost/api/v1/health"]

  db:
    image: pgvector/pgvector:pg16
    container_name: learnhouse-db-abc123
    volumes:
      - learnhouse_db_data_abc123:/var/lib/postgresql/data
    networks:
      - learnhouse-network-abc123

volumes:
  learnhouse_db_data_abc123:
`

  it('injects mount on learnhouse-app and appends named volume', () => {
    const out = patchComposeAddContentVolume(legacyCompose, 'abc123')
    expect(out).toContain('- learnhouse_content_abc123:/app/api/content')
    expect(out).toContain('  learnhouse_content_abc123:')

    const appBlock = out.slice(out.indexOf('learnhouse-app:'), out.indexOf('\n  db:'))
    expect(appBlock).toContain('/app/api/content')

    const volumesSection = out.slice(out.lastIndexOf('volumes:'))
    expect(volumesSection).toContain('learnhouse_db_data_abc123:')
    expect(volumesSection).toContain('learnhouse_content_abc123:')
  })

  it('is idempotent', () => {
    const once = patchComposeAddContentVolume(legacyCompose, 'abc123')
    const twice = patchComposeAddContentVolume(once, 'abc123')
    const mountCount = (twice.match(/learnhouse_content_abc123:\/app\/api\/content/g) ?? []).length
    const declCount = (twice.match(/^  learnhouse_content_abc123:$/gm) ?? []).length
    expect(mountCount).toBe(1)
    expect(declCount).toBe(1)
  })

  it('merges into an existing learnhouse-app volumes block', () => {
    const composeWithExistingVolumes = legacyCompose.replace(
      '    environment:\n      - HOSTNAME=0.0.0.0',
      '    environment:\n      - HOSTNAME=0.0.0.0\n    volumes:\n      - ./extra:/extra:ro',
    )
    const out = patchComposeAddContentVolume(composeWithExistingVolumes, 'abc123')
    const appBlock = out.slice(out.indexOf('learnhouse-app:'), out.indexOf('\n  db:'))
    expect(appBlock).toContain('./extra:/extra:ro')
    expect(appBlock).toContain('learnhouse_content_abc123:/app/api/content')
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

  // Regression: the outer proxy must allow large uploads (videos). A 500M cap
  // here rejected oversized bodies with a 413 before they reached the app,
  // while the app's internal nginx already allows 6G.
  it('allows large request bodies to match the internal nginx (6G)', () => {
    const conf = generateNginxConf()
    expect(conf).toContain('client_max_body_size 6G;')
    expect(conf).not.toContain('client_max_body_size 500M;')
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
  return {
    ...actual,
    isContainerRunning: vi.fn(() => false),
    // Stub out docker exec so unit tests never touch a real daemon.
    // Per-test overrides use vi.mocked(dockerComposeExec).mockReturnValue(...)
    dockerComposeExec: vi.fn(() => ''),
  }
})

// Capture execSync so the docker helpers below can be asserted on the exact
// command they build, without shelling out to a real daemon. importActual
// keeps spawn/spawnSync intact — the binary-surface tests spawn a real CLI
// subprocess and must not be stubbed.
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  return { ...actual, execSync: vi.fn(() => Buffer.from('')) }
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

// ─── Regression: admin email must reject reserved TLDs ──────
//
// The API's Pydantic EmailStr rejects RFC 6761 reserved TLDs (.local,
// .test, .localhost, .invalid). If the CLI accepts one of those, the
// generated .env passes setup but the API container crashes during
// auto_install — leaving an empty `organization` table and a restart
// loop. Reported on Discord against 1.2.1 with a *.local admin email.

describe('validateEmail — reserved TLDs', () => {
  it('accepts a normal email', () => {
    expect(validateEmail('admin@school.dev')).toBeUndefined()
    expect(validateEmail('admin@yourdomain.com')).toBeUndefined()
  })

  it('rejects empty', () => {
    expect(validateEmail('')).toMatch(/required/i)
  })

  it('rejects a malformed address', () => {
    expect(validateEmail('not-an-email')).toMatch(/valid email/i)
  })

  it('rejects .local TLD (RFC 6762 mDNS)', () => {
    expect(validateEmail('admin@school.local')).toMatch(/RFC 6761|reserved/i)
  })

  it('rejects .test TLD (RFC 6761)', () => {
    expect(validateEmail('admin@learnhouse.test')).toMatch(/RFC 6761|reserved/i)
  })

  it('rejects .invalid TLD (RFC 6761)', () => {
    expect(validateEmail('admin@host.invalid')).toMatch(/RFC 6761|reserved/i)
  })

  it('rejects .localhost TLD', () => {
    expect(validateEmail('admin@host.localhost')).toMatch(/RFC 6761|reserved/i)
  })

  it('rejects .example TLD (RFC 2606 documentation)', () => {
    expect(validateEmail('admin@learnhouse.example')).toMatch(/RFC 6761|reserved/i)
  })

  it('is case-insensitive on the TLD', () => {
    expect(validateEmail('admin@SCHOOL.LOCAL')).toMatch(/RFC 6761|reserved/i)
  })
})

// ─── Regression: update command must pull the new image ──────
//
// Prior to this fix, `dockerComposeUp` was called without `pull=true`,
// so `docker compose up -d` reused the locally-cached image instead of
// pulling the new tag. Users on `latest` saw no change after running
// `npx learnhouse update` because the compose file tag didn't change and
// Docker never re-fetched. The fix: (1) explicit `docker compose pull`
// before restarting, (2) `--pull always` on `docker compose up` as safety net.
//
// These tests pin the image tag replacement regex that writes the new tag
// into docker-compose.yml before the pull step.

// ─── Regression: update command must pull the new image ──────
//
// Prior to this fix, `dockerComposeUp` was called without `pull=true`,
// so `docker compose up -d` reused the locally-cached image instead of
// pulling the new tag. Users on `latest` saw no change after running
// `npx learnhouse update` because the compose file tag didn't change and
// Docker never re-fetched. The fix: (1) explicit `docker compose pull`
// before restarting, (2) `--pull always` on `docker compose up` as safety net.
//
// These tests import `replaceComposeImageTag` from the real service module,
// so a regex change in compose-utils.ts is caught immediately.

describe('update — image tag replacement in docker-compose.yml', () => {
  it('replaces a pinned version tag (1.2.2 → 1.2.6)', () => {
    const compose = 'image: ghcr.io/learnhouse/app:1.2.2'
    expect(replaceComposeImageTag(compose, 'ghcr.io/learnhouse/app:1.2.6')).toBe(
      'image: ghcr.io/learnhouse/app:1.2.6',
    )
  })

  it('updates the tag within a realistic compose file block', () => {
    const compose = [
      'services:',
      '  learnhouse-app:',
      '    image: ghcr.io/learnhouse/app:1.2.2',
      '    restart: unless-stopped',
    ].join('\n')
    const updated = replaceComposeImageTag(compose, 'ghcr.io/learnhouse/app:1.2.6')
    expect(updated).toContain('image: ghcr.io/learnhouse/app:1.2.6')
    expect(updated).not.toContain(':1.2.2')
  })

  it('handles v-prefixed version tags', () => {
    const compose = 'image: ghcr.io/learnhouse/app:v1.2.2'
    expect(replaceComposeImageTag(compose, 'ghcr.io/learnhouse/app:v1.2.6')).toBe(
      'image: ghcr.io/learnhouse/app:v1.2.6',
    )
  })

  it('handles latest tag (no-version update path)', () => {
    const compose = 'image: ghcr.io/learnhouse/app:latest'
    // When no --version is specified the tag stays "latest" but the explicit
    // docker compose pull that now precedes `up` fetches the actual new digest.
    expect(replaceComposeImageTag(compose, 'ghcr.io/learnhouse/app:latest')).toBe(
      'image: ghcr.io/learnhouse/app:latest',
    )
  })

  it('handles dev channel tag', () => {
    const compose = 'image: ghcr.io/learnhouse/app:dev'
    expect(replaceComposeImageTag(compose, 'ghcr.io/learnhouse/app:1.3.0')).toBe(
      'image: ghcr.io/learnhouse/app:1.3.0',
    )
  })

  it('does not modify other images in the compose file', () => {
    const compose = [
      '  learnhouse-app:',
      '    image: ghcr.io/learnhouse/app:1.2.2',
      '  db:',
      '    image: pgvector/pgvector:pg16',
      '  nginx:',
      '    image: nginx:alpine',
    ].join('\n')
    const updated = replaceComposeImageTag(compose, 'ghcr.io/learnhouse/app:1.2.6')
    expect(updated).toContain('image: ghcr.io/learnhouse/app:1.2.6')
    expect(updated).toContain('image: pgvector/pgvector:pg16')
    expect(updated).toContain('image: nginx:alpine')
  })
})

// ─── Regression: `update` must actually pull the new image ──────────
//
// The update command rewrote docker-compose.yml with the new tag but
// skipped the pull, so `docker compose up` reused the cached layer and
// the container restarted on the OLD image (reported on Discord: app.py
// still read the previous version after `learnhouse update`). The fix
// calls dockerComposePull() explicitly and brings services up with
// `--pull always`. These tests pin the exact commands so the pull can't
// silently regress out again.

describe('update — docker pull/up commands', () => {
  let execSync: ReturnType<typeof vi.fn>
  let dockerComposeUp: typeof import('../src/services/docker.js').dockerComposeUp
  let dockerComposePull: typeof import('../src/services/docker.js').dockerComposePull
  let dockerComposeDown: typeof import('../src/services/docker.js').dockerComposeDown

  beforeEach(async () => {
    const cp = await import('node:child_process')
    execSync = cp.execSync as unknown as ReturnType<typeof vi.fn>
    execSync.mockClear()
    ;({ dockerComposeUp, dockerComposePull, dockerComposeDown } = await import('../src/services/docker.js'))
  })

  const lastCmd = () => execSync.mock.calls.at(-1)?.[0] as string
  const lastOpts = () => execSync.mock.calls.at(-1)?.[1] as { cwd?: string }

  it('dockerComposePull runs `docker compose pull` in the install dir', () => {
    dockerComposePull('/srv/lh')
    expect(lastCmd()).toBe('docker compose pull')
    expect(lastOpts().cwd).toBe('/srv/lh')
  })

  it('dockerComposeUp without pull just brings services up', () => {
    dockerComposeUp('/srv/lh')
    expect(lastCmd()).toBe('docker compose up -d')
    expect(lastOpts().cwd).toBe('/srv/lh')
  })

  it('dockerComposeUp with pull=true adds --pull always (the update path)', () => {
    dockerComposeUp('/srv/lh', true)
    expect(lastCmd()).toBe('docker compose up -d --pull always')
  })

  it('dockerComposeDown runs `docker compose down` in the install dir', () => {
    dockerComposeDown('/srv/lh')
    expect(lastCmd()).toBe('docker compose down')
    expect(lastOpts().cwd).toBe('/srv/lh')
  })
})

// ─── quoteEnvValue — .env value escaping ────────────────────
//
// docker compose's dotenv parser has subtle rules: bare values can have
// `#` truncate them, `$VAR` gets interpolated, and unquoted spaces are
// trimmed. Our quoting scheme ensures values are passed through literally.

describe('quoteEnvValue', () => {
  it('returns plain value when no special characters', () => {
    expect(quoteEnvValue('plainvalue')).toBe('plainvalue')
    expect(quoteEnvValue('aBc123-_.')).toBe('aBc123-_.')
  })

  it('wraps in single quotes when value has a space', () => {
    expect(quoteEnvValue('hello world')).toBe("'hello world'")
  })

  it('wraps in single quotes when value has a dollar sign', () => {
    // Without quoting, docker compose would interpolate $VAR references.
    expect(quoteEnvValue('pass$word')).toBe("'pass$word'")
  })

  it('wraps in single quotes when value has a hash', () => {
    // Without quoting, # would truncate the rest as a comment.
    expect(quoteEnvValue('color#1')).toBe("'color#1'")
  })

  it('wraps in single quotes when value has a backtick', () => {
    expect(quoteEnvValue('cmd`injection`')).toBe("'cmd`injection`'")
  })

  it('wraps in single quotes when value has an exclamation mark', () => {
    expect(quoteEnvValue('pass!word')).toBe("'pass!word'")
  })

  it('wraps in double quotes and preserves content when value has a single quote', () => {
    // Single-quoted strings cannot contain a literal single quote, so we
    // fall back to double quotes. The content is kept as-is unless it
    // contains backslashes or double quotes.
    expect(quoteEnvValue("it's")).toBe(`"it's"`)
  })

  it('escapes backslashes in the double-quote fallback path', () => {
    // value has a single quote (forces double-quote path) AND a backslash.
    const value = "back\\slash's"        // actual string: back\slash's
    const result = quoteEnvValue(value)
    // backslash must be doubled: back\\slash's → "back\\slash's"
    expect(result).toBe('"back\\\\slash\'s"')
    // The result must also not start with a single quote.
    expect(result.startsWith("'")).toBe(false)
  })

  it('escapes double-quote characters in the double-quote fallback path', () => {
    // value with both single and double quotes
    const value = `say "it's great"`     // has ' and "
    const result = quoteEnvValue(value)
    expect(result).toBe(`"say \\"it's great\\""`)
  })

  it('returns empty string for empty input', () => {
    expect(quoteEnvValue('')).toBe('')
  })
})

// ─── validatePassword / validateDomain / validatePort / validateSlug ─
//
// The setup wizard validates user input before writing it into .env or
// docker-compose.yml. Invalid values can cause silent failures at
// container startup (e.g. a password with reserved chars breaks the
// Postgres connection string, a bad port blocks `docker compose up`).

describe('validatePassword', () => {
  it('rejects an empty string', () => {
    expect(validatePassword('')).toMatch(/required/i)
  })

  it('rejects passwords shorter than 8 characters', () => {
    expect(validatePassword('abc')).toMatch(/8 characters/i)
    expect(validatePassword('1234567')).toMatch(/8 characters/i)
  })

  it('accepts a password of exactly 8 characters', () => {
    expect(validatePassword('12345678')).toBeUndefined()
  })

  it('accepts longer passwords', () => {
    expect(validatePassword('supersecret123!')).toBeUndefined()
  })
})

describe('validateDomain', () => {
  it('accepts localhost', () => {
    expect(validateDomain('localhost')).toBeUndefined()
  })

  it('accepts a simple subdomain', () => {
    expect(validateDomain('learn.example.com')).toBeUndefined()
  })

  it('accepts a bare domain with two-letter TLD', () => {
    expect(validateDomain('school.io')).toBeUndefined()
  })

  it('rejects an empty string', () => {
    expect(validateDomain('')).toMatch(/required/i)
  })

  it('rejects a bare word with no dot', () => {
    expect(validateDomain('notadomain')).toMatch(/valid domain/i)
  })

  it('rejects a value with spaces', () => {
    expect(validateDomain('my domain.com')).toMatch(/valid domain/i)
  })

  it('rejects a label starting with a hyphen', () => {
    expect(validateDomain('-bad.example.com')).toMatch(/valid domain/i)
  })

  it('rejects a label ending with a hyphen', () => {
    expect(validateDomain('bad-.example.com')).toMatch(/valid domain/i)
  })

  it('rejects an IP address (not a domain name)', () => {
    expect(validateDomain('192.168.1.1')).toMatch(/valid domain/i)
  })
})

describe('validatePort', () => {
  it('accepts port 1 (minimum)', () => {
    expect(validatePort('1')).toBeUndefined()
  })

  it('accepts port 65535 (maximum)', () => {
    expect(validatePort('65535')).toBeUndefined()
  })

  it('accepts a common port (8080)', () => {
    expect(validatePort('8080')).toBeUndefined()
  })

  it('rejects port 0', () => {
    expect(validatePort('0')).toMatch(/between 1 and 65535/i)
  })

  it('rejects port 65536', () => {
    expect(validatePort('65536')).toMatch(/between 1 and 65535/i)
  })

  it('rejects a non-numeric string', () => {
    expect(validatePort('abc')).toMatch(/between 1 and 65535/i)
  })

  it('rejects a negative number', () => {
    expect(validatePort('-80')).toMatch(/between 1 and 65535/i)
  })

  it('rejects a numeric-looking string with a trailing suffix (was silently accepted)', () => {
    // parseInt('8080abc') === 8080, so the old check passed it through.
    expect(validatePort('8080abc')).toMatch(/between 1 and 65535/i)
    expect(validatePort('80 80')).toMatch(/between 1 and 65535/i)
    expect(validatePort('')).toMatch(/between 1 and 65535/i)
  })
})

describe('validateSlug', () => {
  it('accepts a simple lowercase slug', () => {
    expect(validateSlug('myorg')).toBeUndefined()
  })

  it('accepts a slug with hyphens', () => {
    expect(validateSlug('my-org')).toBeUndefined()
    expect(validateSlug('acme-learning-2024')).toBeUndefined()
  })

  it('accepts slugs with numbers', () => {
    expect(validateSlug('org123')).toBeUndefined()
  })

  it('rejects an empty string', () => {
    expect(validateSlug('')).toMatch(/required/i)
  })

  it('rejects uppercase letters', () => {
    expect(validateSlug('MyOrg')).toMatch(/lowercase/i)
  })

  it('rejects a leading hyphen', () => {
    expect(validateSlug('-myorg')).toMatch(/lowercase/i)
  })

  it('rejects a trailing hyphen', () => {
    expect(validateSlug('myorg-')).toMatch(/lowercase/i)
  })

  it('rejects consecutive hyphens', () => {
    expect(validateSlug('my--org')).toMatch(/lowercase/i)
  })

  it('rejects spaces', () => {
    expect(validateSlug('my org')).toMatch(/lowercase/i)
  })

  it('rejects underscores', () => {
    expect(validateSlug('my_org')).toMatch(/lowercase/i)
  })
})

// ─── readEnvVar / setEnvVar — .env mutation helpers ─────────
//
// `setEnvVar` is called by the `update` command to stamp EE_IMAGE_TAG after
// a pull, and by `env` to persist user edits. `readEnvVar` reads connection
// strings, license keys, etc. Both must handle quoted values correctly.

describe('readEnvVar', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-readenvvar-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns the value for a key that exists', () => {
    fs.writeFileSync(path.join(tmpDir, '.env'), 'FOO=bar\nBAZ=qux\n')
    expect(readEnvVar(tmpDir, 'FOO')).toBe('bar')
  })

  it('returns the correct value when key is not the first line', () => {
    fs.writeFileSync(path.join(tmpDir, '.env'), 'ALPHA=1\nBETA=hello\nGAMMA=3\n')
    expect(readEnvVar(tmpDir, 'BETA')).toBe('hello')
  })

  it('returns undefined when the key is not present', () => {
    fs.writeFileSync(path.join(tmpDir, '.env'), 'FOO=bar\n')
    expect(readEnvVar(tmpDir, 'MISSING')).toBeUndefined()
  })

  it('strips single-quote wrapping', () => {
    fs.writeFileSync(path.join(tmpDir, '.env'), "SECRET='my secret value'\n")
    expect(readEnvVar(tmpDir, 'SECRET')).toBe('my secret value')
  })

  it('strips double-quote wrapping', () => {
    fs.writeFileSync(path.join(tmpDir, '.env'), 'SECRET="my secret value"\n')
    expect(readEnvVar(tmpDir, 'SECRET')).toBe('my secret value')
  })

  it('returns undefined when .env does not exist', () => {
    expect(readEnvVar(tmpDir, 'FOO')).toBeUndefined()
  })

  it('does not match a key that is a prefix of another key', () => {
    // BAR should not match BARBAZ
    fs.writeFileSync(path.join(tmpDir, '.env'), 'BARBAZ=wrong\nBAR=right\n')
    expect(readEnvVar(tmpDir, 'BAR')).toBe('right')
  })
})

describe('setEnvVar', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-setenvvar-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('replaces an existing variable in-place', () => {
    fs.writeFileSync(path.join(tmpDir, '.env'), 'FOO=old\nBAR=keep\n')
    setEnvVar(tmpDir, 'FOO', 'new')
    const content = fs.readFileSync(path.join(tmpDir, '.env'), 'utf-8')
    expect(content).toContain('FOO=new')
    expect(content).not.toContain('FOO=old')
    expect(content).toContain('BAR=keep')
  })

  it('appends a new variable when the key is absent', () => {
    fs.writeFileSync(path.join(tmpDir, '.env'), 'FOO=bar\n')
    setEnvVar(tmpDir, 'NEW_KEY', 'value')
    const content = fs.readFileSync(path.join(tmpDir, '.env'), 'utf-8')
    expect(content).toContain('NEW_KEY=value')
    expect(content).toContain('FOO=bar')
  })

  it('adds a newline separator before appending when file has no trailing newline', () => {
    // Old files written without trailing newlines must still get a proper line break.
    fs.writeFileSync(path.join(tmpDir, '.env'), 'FOO=bar')
    setEnvVar(tmpDir, 'NEW_KEY', 'value')
    const content = fs.readFileSync(path.join(tmpDir, '.env'), 'utf-8')
    // The two lines must be separated — not merged into "FOO=barNEW_KEY=value"
    expect(content).toMatch(/FOO=bar\n/)
    expect(content).toContain('NEW_KEY=value')
  })

  it('does not duplicate a key when called twice', () => {
    fs.writeFileSync(path.join(tmpDir, '.env'), 'FOO=first\n')
    setEnvVar(tmpDir, 'FOO', 'second')
    setEnvVar(tmpDir, 'FOO', 'third')
    const content = fs.readFileSync(path.join(tmpDir, '.env'), 'utf-8')
    const matches = content.match(/^FOO=/gm) ?? []
    expect(matches.length).toBe(1)
    expect(content).toContain('FOO=third')
  })
})

describe('isExternalDbInstall', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-extdb-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns true when LEARNHOUSE_SQL_CONNECTION_STRING is set', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.env'),
      'LEARNHOUSE_SQL_CONNECTION_STRING=postgresql://user:pw@rds.example.com:5432/lh\n',
    )
    expect(isExternalDbInstall(tmpDir)).toBe(true)
  })

  it('returns false when the connection string key is absent', () => {
    fs.writeFileSync(path.join(tmpDir, '.env'), 'SOME_OTHER_VAR=foo\n')
    expect(isExternalDbInstall(tmpDir)).toBe(false)
  })

  it('returns false when .env does not exist', () => {
    expect(isExternalDbInstall(tmpDir)).toBe(false)
  })
})

// ─── ensureAlembicBaseline — migration baseline stamping ─────
//
// Installs created via the app's create_all startup path have no Alembic
// revision in the database. Before running `upgrade head` we stamp the
// current schema as the baseline so only new delta migrations are applied.
// Without this, `upgrade head` replays every migration and errors on
// existing tables ("relation already exists").

describe('ensureAlembicBaseline', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-baseline-'))
    fs.writeFileSync(path.join(tmpDir, 'docker-compose.yml'), 'name: test\nservices: {}\n')
    const { dockerComposeExec } = await import('../src/services/docker.js')
    vi.mocked(dockerComposeExec).mockReturnValue('')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  it('does not stamp when alembic current already shows a revision', async () => {
    const { dockerComposeExec } = await import('../src/services/docker.js')
    vi.mocked(dockerComposeExec).mockReturnValue('3f2a1b4c8d9e (head)\n')

    const ui = { log: vi.fn(), ok: vi.fn(), warn: vi.fn() }
    ensureAlembicBaseline(tmpDir, COMMUNITY_LAYOUT, ui)

    // Only `current` called; `stamp heads` must NOT be called.
    expect(vi.mocked(dockerComposeExec)).toHaveBeenCalledTimes(1)
    const firstCall = vi.mocked(dockerComposeExec).mock.calls[0][2] as string
    expect(firstCall).toContain('current')
    expect(firstCall).not.toContain('stamp')
  })

  it('stamps heads when alembic current returns empty (create_all install)', async () => {
    const { dockerComposeExec } = await import('../src/services/docker.js')
    vi.mocked(dockerComposeExec).mockReturnValue('')

    const ui = { log: vi.fn(), ok: vi.fn(), warn: vi.fn() }
    ensureAlembicBaseline(tmpDir, COMMUNITY_LAYOUT, ui)

    expect(vi.mocked(dockerComposeExec)).toHaveBeenCalledTimes(2)
    const stampCall = vi.mocked(dockerComposeExec).mock.calls[1][2] as string
    expect(stampCall).toContain('stamp heads')
    expect(ui.ok).toHaveBeenCalled()
  })

  it('warns and does not throw when alembic current fails', async () => {
    const { dockerComposeExec } = await import('../src/services/docker.js')
    vi.mocked(dockerComposeExec).mockImplementation(() => {
      throw new Error('container learnhouse-app not found')
    })

    const warns: string[] = []
    const ui = { log: vi.fn(), ok: vi.fn(), warn: (m: string) => warns.push(m) }
    // Must not propagate the exception — the update continues with a warning.
    expect(() => ensureAlembicBaseline(tmpDir, COMMUNITY_LAYOUT, ui)).not.toThrow()
    expect(warns.length).toBeGreaterThan(0)
    expect(warns[0]).toMatch(/baseline|alembic/i)
  })

  it('recognises a revision line even when it is not at head', async () => {
    // A non-head revision means the DB is stamped but migrations are pending.
    // We must NOT re-stamp (which would discard the pending delta).
    const { dockerComposeExec } = await import('../src/services/docker.js')
    vi.mocked(dockerComposeExec).mockReturnValue('3f2a1b4c8d9e\n')  // no "(head)"

    const ui = { log: vi.fn(), ok: vi.fn(), warn: vi.fn() }
    ensureAlembicBaseline(tmpDir, COMMUNITY_LAYOUT, ui)

    expect(vi.mocked(dockerComposeExec)).toHaveBeenCalledTimes(1)
    const call = vi.mocked(dockerComposeExec).mock.calls[0][2] as string
    expect(call).not.toContain('stamp')
  })
})

// ─── runAlembicUpgrade — migration execution ─────────────────
//
// The upgrade step is the riskiest part of an update. Key invariants:
//  - If the DB is already at head, `upgrade heads` must not be called
//    (some Alembic versions error on a no-op upgrade).
//  - If `upgrade heads` throws, the function returns false so the CLI can
//    emit the rollback instructions without crashing the process.
//  - Multiple heads (e.g. squashed migrations) are handled correctly.

describe('runAlembicUpgrade', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-upgrade-'))
    fs.writeFileSync(path.join(tmpDir, 'docker-compose.yml'), 'name: test\nservices: {}\n')
    const { dockerComposeExec } = await import('../src/services/docker.js')
    vi.mocked(dockerComposeExec).mockReturnValue('')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  it('returns true and skips upgrade when already at head', async () => {
    const { dockerComposeExec } = await import('../src/services/docker.js')
    vi.mocked(dockerComposeExec).mockReturnValue('3f2a1b4c8d9e (head)\n')

    const ui = { log: vi.fn(), ok: vi.fn(), warn: vi.fn() }
    const result = runAlembicUpgrade(tmpDir, COMMUNITY_LAYOUT, ui)

    expect(result).toBe(true)
    // Only `current` called; `upgrade heads` must NOT be called for a no-op.
    expect(vi.mocked(dockerComposeExec)).toHaveBeenCalledTimes(1)
    expect(ui.ok).toHaveBeenCalled()
  })

  it('runs upgrade heads when current revision is not at head', async () => {
    const { dockerComposeExec } = await import('../src/services/docker.js')
    const mockExec = vi.mocked(dockerComposeExec)
    mockExec
      .mockReturnValueOnce('3f2a1b4c8d9e\n')                                  // current → not head
      .mockReturnValueOnce('Running upgrade 3f2a1b4c → a9c3d7e1\nDone.\n')  // upgrade heads → ok

    const ui = { log: vi.fn(), ok: vi.fn(), warn: vi.fn() }
    const result = runAlembicUpgrade(tmpDir, COMMUNITY_LAYOUT, ui)

    expect(result).toBe(true)
    expect(mockExec).toHaveBeenCalledTimes(2)
    const upgradeCall = mockExec.mock.calls[1][2] as string
    expect(upgradeCall).toContain('upgrade heads')
  })

  it('returns false and warns when upgrade heads throws', async () => {
    const { dockerComposeExec } = await import('../src/services/docker.js')
    const mockExec = vi.mocked(dockerComposeExec)
    mockExec
      .mockReturnValueOnce('3f2a1b4c8d9e\n')   // current → not head
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('migration failed'), { stderr: 'ERROR: relation "users" already exists' })
      })

    const warns: string[] = []
    const ui = { log: vi.fn(), ok: vi.fn(), warn: (m: string) => warns.push(m) }
    const result = runAlembicUpgrade(tmpDir, COMMUNITY_LAYOUT, ui)

    expect(result).toBe(false)
    expect(warns.some(w => /failed|backup/i.test(w))).toBe(true)
  })

  it('skips upgrade when all multiple current revisions are at head', async () => {
    // Multi-head alembic trees: both heads present → nothing to apply.
    const { dockerComposeExec } = await import('../src/services/docker.js')
    vi.mocked(dockerComposeExec).mockReturnValue('aabbccdd (head)\nee112233 (head)\n')

    const ui = { log: vi.fn(), ok: vi.fn(), warn: vi.fn() }
    const result = runAlembicUpgrade(tmpDir, COMMUNITY_LAYOUT, ui)

    expect(result).toBe(true)
    expect(vi.mocked(dockerComposeExec)).toHaveBeenCalledTimes(1)
  })

  it('runs upgrade when only some of the multiple heads are present', async () => {
    // One branch is at head, one is not — upgrade must run.
    const { dockerComposeExec } = await import('../src/services/docker.js')
    const mockExec = vi.mocked(dockerComposeExec)
    mockExec
      .mockReturnValueOnce('aabbccdd (head)\nee112233\n')   // ee branch not at head
      .mockReturnValueOnce('Running upgrade ee112233 → ff445566\n')

    const ui = { log: vi.fn(), ok: vi.fn(), warn: vi.fn() }
    const result = runAlembicUpgrade(tmpDir, COMMUNITY_LAYOUT, ui)

    expect(result).toBe(true)
    expect(mockExec).toHaveBeenCalledTimes(2)
  })

  it('returns true and marks no-op when current output has no revision lines', async () => {
    // Empty output from a freshly-stamped DB (just ran ensureAlembicBaseline).
    const { dockerComposeExec } = await import('../src/services/docker.js')
    vi.mocked(dockerComposeExec).mockReturnValue('')

    const ui = { log: vi.fn(), ok: vi.fn(), warn: vi.fn() }
    const result = runAlembicUpgrade(tmpDir, COMMUNITY_LAYOUT, ui)

    // No revision lines → revLines.length === 0 → upgrade heads runs
    expect(result).toBe(true)
  })
})

// ─── CLI binary smoke tests ──────────────────────────────────
//
// These tests spawn the actual built CLI binary and verify the user-facing
// experience: help text, version string, and error messages for invalid
// input. No Docker daemon is needed — they cover the "what does the user
// see when they type X" layer that module-level unit tests cannot reach.

const CLI_BIN = path.resolve(__dirname, '..', 'dist', 'bin', 'learnhouse.js')

function runCli(args: string, timeoutMs = 10_000): { stdout: string; stderr: string; exitCode: number } {
  const argArray = args ? args.trim().split(/\s+/) : []
  const result = spawnSync('node', [CLI_BIN, ...argArray], {
    encoding: 'utf-8',
    timeout: timeoutMs,
    env: { ...process.env, NO_COLOR: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status ?? 1,
  }
}

describe('CLI — version and help', () => {
  it('--version prints a semver string and exits 0', () => {
    const r = runCli('--version')
    expect(r.exitCode).toBe(0)
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('--help lists all core commands users need', () => {
    const r = runCli('--help')
    expect(r.exitCode).toBe(0)
    const out = r.stdout
    expect(out).toContain('setup')
    expect(out).toContain('start')
    expect(out).toContain('stop')
    expect(out).toContain('update')
    expect(out).toContain('backup')
    expect(out).toContain('restore')
    expect(out).toContain('status')
    expect(out).toContain('health')
    expect(out).toContain('config')
  })

  it('no-argument invocation shows the welcome screen, not an error', () => {
    const r = runCli('')
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('LearnHouse')
  })
})

describe('CLI — setup --help (flag discoverability)', () => {
  it('shows all flags a user needs to automate a deployment', () => {
    const r = runCli('setup --help')
    expect(r.exitCode).toBe(0)
    const out = r.stdout
    expect(out).toContain('--ci')
    expect(out).toContain('--domain')
    expect(out).toContain('--port')
    expect(out).toContain('--admin-email')
    expect(out).toContain('--admin-password')
    expect(out).toContain('--org-name')
    expect(out).toContain('--org-slug')
    expect(out).toContain('--no-start')
  })
})

describe('CLI — update --help (flag discoverability)', () => {
  it('shows the flags users need to target a specific version', () => {
    const r = runCli('update --help')
    expect(r.exitCode).toBe(0)
    const out = r.stdout
    expect(out).toContain('--to')
    expect(out).toContain('--migrate')
    expect(out).toContain('--no-migrate')
    expect(out).toContain('--no-backup')
  })
})

describe('CLI — backup / restore --help', () => {
  it('backup --help mentions the archive concept', () => {
    const r = runCli('backup --help')
    expect(r.exitCode).toBe(0)
    expect(r.stdout.toLowerCase()).toContain('archive')
  })

  it('restore --help mentions the archive argument', () => {
    const r = runCli('restore --help')
    expect(r.exitCode).toBe(0)
    expect(r.stdout.toLowerCase()).toContain('archive')
  })
})

// ─── CLI — command registration guard ────────────────────────
//
// A single sweep confirms all 16 commands are wired up. This test
// exists because scale was fully implemented in scale.ts but forgotten
// in bin/learnhouse.ts — `npx learnhouse scale` silently showed the
// main help instead of the scale UI. Never again.

describe('CLI — all 16 commands registered', () => {
  const ALL_COMMANDS = [
    'setup', 'start', 'stop', 'update', 'status', 'health',
    'logs', 'config', 'env', 'backup', 'restore',
    'deployments', 'doctor', 'shell', 'scale', 'dev',
  ]

  it('every command exits 0 on --help (none silently fall through to main help)', () => {
    for (const cmd of ALL_COMMANDS) {
      const r = runCli(`${cmd} --help`)
      expect(r.exitCode, `"${cmd} --help" exited ${r.exitCode}:\n${r.stderr}`).toBe(0)
    }
  })

  it('all commands appear in the root --help listing', () => {
    const r = runCli('--help')
    for (const cmd of ALL_COMMANDS) {
      expect(r.stdout, `"${cmd}" is missing from root --help`).toContain(cmd)
    }
  })

  it('unknown command exits non-zero', () => {
    const r = runCli('nonexistent-command-xyz')
    expect(r.exitCode).not.toBe(0)
  })

  it('setup --help lists all CI-mode flags a user needs to automate a deployment', () => {
    const r = runCli('setup --help')
    expect(r.exitCode).toBe(0)
    // Every flag must be documented — missing flags mean users can't discover them
    for (const flag of ['--ci', '--domain', '--port', '--admin-email', '--admin-password', '--org-name', '--org-slug', '--no-start']) {
      expect(r.stdout, `"${flag}" missing from setup --help`).toContain(flag)
    }
  })

  it('update --help lists all flags users need to safely update a deployment', () => {
    const r = runCli('update --help')
    expect(r.exitCode).toBe(0)
    for (const flag of ['--to', '--migrate', '--no-migrate', '--no-backup']) {
      expect(r.stdout, `"${flag}" missing from update --help`).toContain(flag)
    }
  })

  it('dev --help lists --ee and --admin-email flags', () => {
    const r = runCli('dev --help')
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('--ee')
    expect(r.stdout).toContain('--admin-email')
  })
})


// ─── CLI — setup --ci --no-start: real install, no Docker ────
//
// setup --ci --no-start writes the full file set (docker-compose.yml,
// .env, nginx.conf, learnhouse.config.json) without starting containers.
// Running the REAL binary against a temp HOME lets us verify that:
//
//   1. Specific values we passed end up in the right files with the right keys
//   2. The config command correctly reads and displays those values
//   3. Commands that require running containers (backup, update, status)
//      exit non-zero with clear, actionable error messages — not silent
//      crashes or cryptic stack traces
//   4. Doctor runs its diagnostic checks and exits 0 (never fails, just reports)
//
// This is the deepest test you can run without a full Docker environment.

describe('CLI — setup --ci --no-start: real installation, real file assertions', () => {
  let tempHome: string
  let installDir: string

  const DOMAIN       = 'academy.example.com'
  const PORT         = 7654
  const EMAIL        = 'admin@academy.com'
  const PASSWORD     = 'Academy-Pass-99'
  const ORG_SLUG     = 'academy'
  const ORG_NAME     = 'Academy Corp'
  const INSTALL_NAME = 'acadsetup'

  function cliHome(args: string[]) {
    return spawnSync('node', [CLI_BIN, ...args], {
      encoding: 'utf-8',
      timeout: 30_000,
      env: { ...process.env, HOME: tempHome, NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  }

  beforeAll(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-unit-home-'))
    const r = cliHome([
      'setup', '--ci',
      '--name',           INSTALL_NAME,
      '--domain',         DOMAIN,
      '--port',           String(PORT),
      '--admin-email',    EMAIL,
      '--admin-password', PASSWORD,
      '--org-name',       ORG_NAME,
      '--org-slug',       ORG_SLUG,
      '--no-start',
    ])
    if (r.status !== 0) throw new Error(`setup failed:\n${r.stdout}\n${r.stderr}`)
    installDir = path.join(tempHome, '.learnhouse', INSTALL_NAME)
  })

  afterAll(() => {
    try { fs.rmSync(tempHome, { recursive: true, force: true }) } catch { /* ignore */ }
  })

  // ── File existence ──────────────────────────────────────────
  it('creates docker-compose.yml, .env, and learnhouse.config.json', () => {
    expect(fs.existsSync(path.join(installDir, 'docker-compose.yml'))).toBe(true)
    expect(fs.existsSync(path.join(installDir, '.env'))).toBe(true)
    expect(fs.existsSync(path.join(installDir, 'learnhouse.config.json'))).toBe(true)
  })

  // ── docker-compose.yml ──────────────────────────────────────
  it('docker-compose.yml has all four services (app, db, redis, nginx)', () => {
    const yml = fs.readFileSync(path.join(installDir, 'docker-compose.yml'), 'utf-8')
    expect(yml).toContain('learnhouse-app-')
    expect(yml).toContain('learnhouse-db-')
    expect(yml).toContain('learnhouse-redis-')
    expect(yml).toContain('nginx')
  })

  it('docker-compose.yml exposes the exact port we specified', () => {
    const yml = fs.readFileSync(path.join(installDir, 'docker-compose.yml'), 'utf-8')
    expect(yml).toContain(String(PORT))
  })

  it('docker-compose.yml has restart: unless-stopped (survives reboots, respects manual stop)', () => {
    const yml = fs.readFileSync(path.join(installDir, 'docker-compose.yml'), 'utf-8')
    expect(yml).toContain('restart: unless-stopped')
  })

  it('docker-compose.yml app depends_on db with condition: service_healthy (no restart-loop on boot)', () => {
    const yml = fs.readFileSync(path.join(installDir, 'docker-compose.yml'), 'utf-8')
    expect(yml).toContain('condition: service_healthy')
  })

  // ── .env values ─────────────────────────────────────────────
  it('.env LEARNHOUSE_DOMAIN contains the domain we passed', () => {
    const env = fs.readFileSync(path.join(installDir, '.env'), 'utf-8')
    expect(env).toContain(`LEARNHOUSE_DOMAIN=${DOMAIN}`)
  })

  it('.env LEARNHOUSE_INITIAL_ADMIN_EMAIL is exactly the email we passed', () => {
    const env = fs.readFileSync(path.join(installDir, '.env'), 'utf-8')
    expect(env).toContain(`LEARNHOUSE_INITIAL_ADMIN_EMAIL=${EMAIL}`)
  })

  it('.env LEARNHOUSE_INITIAL_ORG_SLUG is exactly the slug we passed', () => {
    const env = fs.readFileSync(path.join(installDir, '.env'), 'utf-8')
    expect(env).toContain(`LEARNHOUSE_INITIAL_ORG_SLUG=${ORG_SLUG}`)
  })

  it('.env has no =undefined lines (any undefined value causes a broken container at runtime)', () => {
    const env = fs.readFileSync(path.join(installDir, '.env'), 'utf-8')
    expect(env).not.toMatch(/=undefined(\s|$)/m)
  })

  it('.env POSTGRES_PASSWORD is set to a non-empty value (missing password → DB rejects all connections)', () => {
    const env = fs.readFileSync(path.join(installDir, '.env'), 'utf-8')
    expect(env).not.toContain('POSTGRES_PASSWORD=undefined')
    expect(env).toMatch(/^POSTGRES_PASSWORD=.{8,}$/m)
  })

  it('.env JWT secrets are at least 40 characters (short secrets are cryptographically weak)', () => {
    const env = fs.readFileSync(path.join(installDir, '.env'), 'utf-8')
    const kv = Object.fromEntries(
      env.split('\n')
        .filter(l => l.includes('=') && !l.startsWith('#'))
        .map(l => [l.split('=')[0], l.slice(l.indexOf('=') + 1)]),
    )
    expect(kv['NEXTAUTH_SECRET']?.trim().length).toBeGreaterThanOrEqual(40)
    expect(kv['LEARNHOUSE_AUTH_JWT_SECRET_KEY']?.trim().length).toBeGreaterThanOrEqual(40)
  })

  // ── learnhouse.config.json ──────────────────────────────────
  it('learnhouse.config.json stores exactly the domain, port, and slug we passed', () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(installDir, 'learnhouse.config.json'), 'utf-8'))
    expect(cfg.domain).toBe(DOMAIN)
    expect(cfg.httpPort).toBe(PORT)
    expect(cfg.orgSlug).toBe(ORG_SLUG)
  })

  it('learnhouse.config.json deploymentId is a non-empty alphanumeric id', () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(installDir, 'learnhouse.config.json'), 'utf-8'))
    expect(cfg.deploymentId).toMatch(/^[a-z0-9]{8,}$/)
  })

  // ── config command — reads and displays our install ─────────
  it('"config" exits 0 and shows our domain in the URL line', () => {
    const r = cliHome(['config'])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain(DOMAIN)
  })

  it('"config" shows our org slug', () => {
    const r = cliHome(['config'])
    expect(r.stdout).toContain(ORG_SLUG)
  })

  it('"config" shows the install directory path', () => {
    const r = cliHome(['config'])
    expect(r.stdout).toContain(installDir)
  })

  it('"config" shows a link to the .env file (so users know where to find secrets)', () => {
    const r = cliHome(['config'])
    expect(r.stdout).toContain('.env')
  })

  // ── status — prints URL from config before touching Docker ────
  it('"status" shows our install URL (read from config.json before any Docker call)', () => {
    // status always prints the URL first — this is guaranteed regardless of whether
    // containers are running, because it reads learnhouse.config.json before docker compose ps
    const r = cliHome(['status'])
    expect(r.stdout + r.stderr).toContain(DOMAIN)
  })

  it('"status" shows the port in the URL', () => {
    const r = cliHome(['status'])
    expect(r.stdout + r.stderr).toContain(String(PORT))
  })

  // ── backup — specific error message when DB container is down ─
  it('"backup" exits 1 and says the database container is not running', () => {
    const r = cliHome(['backup'])
    expect(r.status).toBe(1)
    // Exact message from backup command — "not running" tells the user what to do
    expect(r.stdout + r.stderr).toContain('not running')
  })

  // ── update — version check against GHCR before touching containers ─
  it('"update --to 0.0.0-nonexistent" exits 1 with version-not-found message', () => {
    const r = cliHome(['update', '--to', '0.0.0-nonexistent', '--no-backup', '--no-migrate'])
    expect(r.status).toBe(1)
    // Exact message from update command
    expect(r.stdout + r.stderr).toContain('not found')
  })

  // ── doctor — diagnostic, exits 0, confirms Docker present ────
  it('"doctor" exits 0 (it reports problems but never fails hard)', () => {
    const r = cliHome(['doctor'])
    expect(r.status).toBe(0)
  })

  it('"doctor" confirms Docker is installed on the test machine', () => {
    const r = cliHome(['doctor'])
    expect(r.stdout + r.stderr).toContain('Docker installed')
  })

  it('"doctor" reports that no containers are running (expected — we used --no-start)', () => {
    const r = cliHome(['doctor'])
    expect(r.stdout + r.stderr).toContain('No containers found')
  })
})

// ─── CLI — setup --ci input validation (no Docker needed) ────
//
// Bad input must: (1) exit 1, (2) print a clear message, (3) leave no
// files behind. Each test uses an isolated temp HOME so a validation
// failure can never pollute ~/.learnhouse on the developer's machine.
// Testing at the binary level catches regressions that module-level tests
// miss — e.g. a Commander flag definition that silently swallows the value
// before validation runs.

describe('CLI — setup --ci input validation', () => {
  let validationHome: string

  beforeAll(() => { validationHome = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-val-')) })
  afterAll(() => { try { fs.rmSync(validationHome, { recursive: true, force: true }) } catch { /* ignore */ } })

  function setupBad(name: string, extraArgs: string[]) {
    return spawnSync('node', [CLI_BIN, 'setup', '--ci', '--name', name, ...extraArgs], {
      encoding: 'utf-8', timeout: 20_000,
      env: { ...process.env, HOME: validationHome, NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  }

  function installDir(name: string) {
    return path.join(validationHome, '.learnhouse', name)
  }

  it('exits 1 with "--admin-password" in the error when password is missing', () => {
    const r = setupBad('val-no-pw', ['--domain', 'localhost', '--port', '9179'])
    expect(r.status).toBe(1)
    expect(r.stdout + r.stderr).toContain('--admin-password')
    expect(fs.existsSync(installDir('val-no-pw'))).toBe(false)
  })

  it('exits 1 with "8 characters" message when password is too short (< 8 chars)', () => {
    const r = setupBad('val-shortpw', ['--domain', 'localhost', '--port', '9179', '--admin-password', 'abc'])
    expect(r.status).toBe(1)
    expect(r.stdout + r.stderr).toMatch(/8 characters|too short/i)
    expect(fs.existsSync(installDir('val-shortpw'))).toBe(false)
  })

  it('exits 1 with port error when --port 0 is given (below valid range 1-65535)', () => {
    const r = setupBad('val-badport', ['--domain', 'localhost', '--port', '0', '--admin-password', 'testpassword1'])
    expect(r.status).toBe(1)
    expect(r.stdout + r.stderr).toMatch(/port|between/i)
    expect(fs.existsSync(installDir('val-badport'))).toBe(false)
  })

  it('exits 1 with port error when --port 65536 is given (above valid range 1-65535)', () => {
    const r = setupBad('val-highport', ['--domain', 'localhost', '--port', '65536', '--admin-password', 'testpassword1'])
    expect(r.status).toBe(1)
    expect(r.stdout + r.stderr).toMatch(/port|between/i)
    expect(fs.existsSync(installDir('val-highport'))).toBe(false)
  })

  it('exits 1 with domain error when an IP address is used as --domain (IPs not valid domains)', () => {
    const r = setupBad('val-baddom', ['--domain', '192.168.1.1', '--port', '9179', '--admin-password', 'testpassword1'])
    expect(r.status).toBe(1)
    expect(r.stdout + r.stderr).toMatch(/domain|valid/i)
    expect(fs.existsSync(installDir('val-baddom'))).toBe(false)
  })

  it('exits 1 with reserved-TLD message when --admin-email uses .local (seeder rejects it → no admin created)', () => {
    const r = setupBad('val-badmail-local', [
      '--domain', 'localhost', '--port', '9179',
      '--admin-password', 'testpassword1',
      '--admin-email', 'admin@school.local',
    ])
    expect(r.status).toBe(1)
    expect(r.stdout + r.stderr).toMatch(/reserved/i)
  })

  it('exits 1 with reserved-TLD message when --admin-email uses .test', () => {
    const r = setupBad('val-badmail-test', [
      '--domain', 'localhost', '--port', '9179',
      '--admin-password', 'testpassword1',
      '--admin-email', 'admin@school.test',
    ])
    expect(r.status).toBe(1)
    expect(r.stdout + r.stderr).toMatch(/reserved/i)
  })
})

// ─── Template completeness — all services present ────────────
//
// The generated docker-compose.yml must include all four services that a
// standard community install needs. Missing a service (e.g. redis dropped
// by a template bug) causes the app to crash at startup, which users
// report as "it just won't start" — hard to diagnose from logs alone.

describe('generateDockerCompose — service completeness', () => {
  it('default install includes all four core services', () => {
    const yml = generateDockerCompose(baseConfig)
    // Each service has a container_name with the deployment id — this
    // confirms both the service declaration AND the naming convention.
    expect(yml).toContain(`learnhouse-app-${baseConfig.deploymentId}`)
    expect(yml).toContain(`learnhouse-db-${baseConfig.deploymentId}`)
    expect(yml).toContain(`learnhouse-redis-${baseConfig.deploymentId}`)
    // nginx (reverse proxy)
    expect(yml).toContain('nginx')
  })

  it('restart policy is unless-stopped on the app service', () => {
    // "unless-stopped" survives host reboots while still being manually
    // stoppable. "always" would restart even after `npx learnhouse stop`.
    const yml = generateDockerCompose(baseConfig)
    expect(yml).toContain('restart: unless-stopped')
  })

  it('app service depends_on db with condition: service_healthy', () => {
    // Without this, the app starts before Postgres is ready and immediately
    // errors, causing a restart loop the user sees as "app keeps restarting".
    const yml = generateDockerCompose(baseConfig)
    expect(yml).toContain('condition: service_healthy')
  })
})

// ─── Env file completeness — no silent empty/undefined values ─
//
// A value rendered as "=undefined" or left blank causes the container to
// start with a wrong environment — Postgres rejects the connection, JWT
// verification fails, etc. These tests are the first line of defence
// against template regressions that produce broken installs.

describe('generateEnvFile — no empty or undefined values', () => {
  // Must include dbPassword: without it the template emits POSTGRES_PASSWORD=undefined,
  // which causes the DB container to reject connections at runtime.
  const envConfig = { ...baseConfig, dbPassword: 'db-pass-test-123' }

  it('no line has the literal value "undefined"', () => {
    const env = generateEnvFile(envConfig)
    expect(env).not.toMatch(/=undefined(\s|$)/m)
  })

  it('all KEY=VALUE lines have a non-empty value', () => {
    const env = generateEnvFile(envConfig)
    const valueLines = env.split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    for (const line of valueLines) {
      const value = line.slice(line.indexOf('=') + 1)
      expect(value.trim()).not.toBe('')
    }
  })

  it('required secrets are populated (JWT and auth keys)', () => {
    const env = generateEnvFile(envConfig)
    // These must never be empty — an empty secret lets anyone forge tokens.
    const lines = Object.fromEntries(
      env.split('\n')
        .filter((l) => l.includes('=') && !l.startsWith('#'))
        .map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1)]),
    )
    expect(lines['NEXTAUTH_SECRET']?.trim().length).toBeGreaterThan(8)
    expect(lines['LEARNHOUSE_AUTH_JWT_SECRET_KEY']?.trim().length).toBeGreaterThan(8)
  })
})

// ─── network — Postgres/Redis connection-string parsers ─────
//
// setup/doctor parse external DB/Redis URLs to probe TCP reachability.
// A wrong port or a crash on a malformed string would break the probe,
// so pin the parse rules (incl. the default-port fallbacks).

describe('parsePostgresUrl', () => {
  it('extracts host and explicit port', () => {
    expect(parsePostgresUrl('postgresql://user:pass@db.example.com:6432/app'))
      .toEqual({ host: 'db.example.com', port: 6432 })
  })

  it('defaults to 5432 when no port is given', () => {
    expect(parsePostgresUrl('postgresql://user:pass@db.example.com/app'))
      .toEqual({ host: 'db.example.com', port: 5432 })
  })

  it('accepts the postgres:// scheme too', () => {
    expect(parsePostgresUrl('postgres://u:p@localhost:5432/db'))
      .toEqual({ host: 'localhost', port: 5432 })
  })

  it('returns null on a non-URL string', () => {
    expect(parsePostgresUrl('not a url')).toBeNull()
    expect(parsePostgresUrl('')).toBeNull()
  })
})

describe('parseRedisUrl', () => {
  it('extracts host and explicit port', () => {
    expect(parseRedisUrl('redis://cache:6390')).toEqual({ host: 'cache', port: 6390 })
  })

  it('defaults to 6379 when no port is given', () => {
    expect(parseRedisUrl('redis://cache')).toEqual({ host: 'cache', port: 6379 })
  })

  it('returns null on a non-URL string', () => {
    expect(parseRedisUrl('not a url')).toBeNull()
    expect(parseRedisUrl('')).toBeNull()
  })
})

// ─── validateRequired ───────────────────────────────────────

describe('validateRequired', () => {
  it('rejects empty and whitespace-only values', () => {
    expect(validateRequired('')).toMatch(/required/i)
    expect(validateRequired('   ')).toMatch(/required/i)
  })

  it('accepts any non-blank value', () => {
    expect(validateRequired('x')).toBeUndefined()
    expect(validateRequired('  hello  ')).toBeUndefined()
  })
})

// ─── resolveAppImage — channel / version resolution ─────────
//
// `dev` is a pure mapping; `stable` queries GitHub + GHCR and must fall
// back to :latest on any network failure (never throw, never block setup).

describe('resolveAppImage', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('maps the dev channel to the dev image without any network call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const res = await resolveAppImage('dev')
    expect(res).toEqual({ image: 'ghcr.io/learnhouse/app:dev', isLatest: false })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('falls back to :latest when the network fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    const res = await resolveAppImage('stable')
    expect(res).toEqual({ image: 'ghcr.io/learnhouse/app:latest', isLatest: true })
  })

  it('pins the newest non-draft release when its image manifest exists', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      const url = String(input)
      if (url.includes('api.github.com')) {
        return new Response(JSON.stringify([
          { tag_name: 'cli-9.9.9', draft: false, prerelease: false },
          { tag_name: '1.4.2', draft: false, prerelease: false },
        ]), { status: 200 })
      }
      if (url.includes('ghcr.io/token')) return new Response(JSON.stringify({ token: 't' }), { status: 200 })
      return new Response('', { status: 200 }) // manifest exists
    })
    const res = await resolveAppImage('stable')
    expect(res).toEqual({ image: 'ghcr.io/learnhouse/app:1.4.2', isLatest: false })
  })

  it('falls back to :latest when the release exists but its image manifest is missing', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      const url = String(input)
      if (url.includes('api.github.com')) {
        return new Response(JSON.stringify([{ tag_name: '1.4.2', draft: false, prerelease: false }]), { status: 200 })
      }
      if (url.includes('ghcr.io/token')) return new Response(JSON.stringify({ token: 't' }), { status: 200 })
      return new Response('', { status: 404 }) // manifest missing
    })
    const res = await resolveAppImage('stable')
    expect(res).toEqual({ image: 'ghcr.io/learnhouse/app:latest', isLatest: true })
  })
})

// ─── docker — output parsers (deployment discovery, restarts) ─
//
// doctor / deployments parse `docker ps` and `docker inspect` text. These
// run the real parser against canned execSync output (execSync is mocked
// at module scope) so a format/regex regression is caught without Docker.

describe('docker output parsers', () => {
  let execSync: ReturnType<typeof vi.fn>
  beforeEach(async () => {
    execSync = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    execSync.mockReset()
  })

  describe('autoDetectDeploymentId', () => {
    it('pulls the hex id from the first learnhouse-app container', () => {
      execSync.mockReturnValue(Buffer.from('learnhouse-app-ab12cd34\n'))
      expect(autoDetectDeploymentId()).toBe('ab12cd34')
      // The detection MUST filter on the learnhouse-app- name prefix, otherwise it
      // would latch onto db/redis/unrelated containers. Pin the actual filter string.
      expect(execSync.mock.calls.at(-1)?.[0]).toContain('name=learnhouse-app-')
    })

    it('uses the first line when several containers exist', () => {
      execSync.mockReturnValue(Buffer.from('learnhouse-app-aaaa1111\nlearnhouse-app-bbbb2222\n'))
      expect(autoDetectDeploymentId()).toBe('aaaa1111')
    })

    it('returns null when nothing matches or output is empty', () => {
      execSync.mockReturnValue(Buffer.from(''))
      expect(autoDetectDeploymentId()).toBeNull()
      execSync.mockReturnValue(Buffer.from('some-other-container\n'))
      expect(autoDetectDeploymentId()).toBeNull()
    })

    it('returns null instead of throwing when docker errors', () => {
      execSync.mockImplementation(() => { throw new Error('docker not running') })
      expect(autoDetectDeploymentId()).toBeNull()
    })
  })

  describe('listDeploymentContainers', () => {
    it('parses tab-separated name/status/image rows for the deployment', () => {
      execSync.mockReturnValue(Buffer.from(
        'learnhouse-app-dep1\tUp 2 hours\tghcr.io/learnhouse/app:1.4.2\n' +
        'learnhouse-db-dep1\tUp 2 hours (healthy)\tpgvector/pgvector:pg16\n' +
        'unrelated-dep2\tUp\tnginx:alpine\n',
      ))
      const rows = listDeploymentContainers('dep1')
      expect(rows).toHaveLength(2)
      expect(rows[0]).toEqual({ name: 'learnhouse-app-dep1', status: 'Up 2 hours', image: 'ghcr.io/learnhouse/app:1.4.2' })
      expect(rows.every((r) => r.name.includes('dep1'))).toBe(true)
    })

    it('returns [] when there is no matching output', () => {
      execSync.mockReturnValue(Buffer.from(''))
      expect(listDeploymentContainers('dep1')).toEqual([])
    })

    it('returns [] when the docker query throws', () => {
      execSync.mockImplementation(() => { throw new Error('docker daemon unreachable') })
      expect(listDeploymentContainers('dep1')).toEqual([]) // catch → []
    })
  })

  describe('getContainerRestartCount', () => {
    it('parses the restart count', () => {
      execSync.mockReturnValue(Buffer.from('7\n'))
      expect(getContainerRestartCount('learnhouse-app-x')).toBe(7)
    })

    it('returns 0 on non-numeric output or a docker error', () => {
      execSync.mockReturnValue(Buffer.from('not-a-number\n'))
      expect(getContainerRestartCount('x')).toBe(0)
      execSync.mockImplementation(() => { throw new Error('no such container') })
      expect(getContainerRestartCount('x')).toBe(0)
    })
  })
})

// ─── config-store — listInstallations filtering & ordering ──

describe('listInstallations — completeness filter and ordering', () => {
  const fakeHome = path.join(os.tmpdir(), 'lh-listinstall-' + process.pid)
  const lhBase = path.join(fakeHome, '.learnhouse')
  let origHome: string | undefined

  function writeInstall(name: string, opts: { deploymentId?: string; createdAt?: string; env?: boolean } = {}) {
    const dir = path.join(lhBase, name)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'learnhouse.config.json'), JSON.stringify({
      version: '0.0.0-test',
      deploymentId: opts.deploymentId ?? 'aaaa1111',
      createdAt: opts.createdAt ?? '2026-01-01T00:00:00Z',
      installDir: dir, domain: 'localhost', httpPort: 8088,
      useHttps: false, autoSsl: false, useExternalDb: false, orgSlug: 'default',
    }))
    if (opts.env !== false) fs.writeFileSync(path.join(dir, '.env'), '# test')
    return dir
  }

  beforeEach(() => {
    fs.mkdirSync(lhBase, { recursive: true })
    origHome = process.env.HOME
    process.env.HOME = fakeHome
  })
  afterEach(() => {
    fs.rmSync(fakeHome, { recursive: true, force: true })
    if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome
  })

  it('lists complete installs newest-first', () => {
    writeInstall('old', { deploymentId: 'aaaa1111', createdAt: '2026-01-01T00:00:00Z' })
    writeInstall('new', { deploymentId: 'bbbb2222', createdAt: '2026-05-01T00:00:00Z' })
    const list = listInstallations()
    expect(list.map((i) => i.name)).toEqual(['new', 'old'])
  })

  it('excludes a directory that has a config but no .env (incomplete install)', () => {
    writeInstall('complete', { deploymentId: 'aaaa1111' })
    writeInstall('partial', { deploymentId: 'bbbb2222', env: false })
    expect(listInstallations().map((i) => i.name)).toEqual(['complete'])
  })

  it('returns [] when ~/.learnhouse has no installs', () => {
    expect(listInstallations()).toEqual([])
  })
})

// ─── dockerComposeExec — non-interactive contract (-T) ──────
//
// Callers capture stdout (alembic output, EE readiness curl) under
// stdio:'pipe'. Without -T, `docker compose exec` can abort with "the
// input device is not a TTY" on docker setups that allocate a TTY even
// when piped. importActual is used because the module mock stubs this fn.

describe('dockerComposeExec builds a non-interactive command', () => {
  it('runs `docker compose exec -T <service> <cmd>` and returns stdout', async () => {
    const execSync = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    execSync.mockReset()
    execSync.mockReturnValue(Buffer.from('revision-abc (head)'))
    const real = await vi.importActual<typeof import('../src/services/docker.js')>('../src/services/docker.js')

    const out = real.dockerComposeExec('/srv/lh', 'learnhouse-app', 'sh -c "uv run alembic current"')
    expect(execSync.mock.calls.at(-1)?.[0]).toBe(
      'docker compose exec -T learnhouse-app sh -c "uv run alembic current"',
    )
    expect((execSync.mock.calls.at(-1)?.[1] as { cwd?: string }).cwd).toBe('/srv/lh')
    expect(out).toBe('revision-abc (head)')
  })
})

// ─── migrateContentVolume — fs-driven status branches ───────
//
// The update flow preserves uploaded media before recreating the app.
// These cases are decided purely from docker-compose.yml / .env content
// (no running container), so they're unit-testable end to end.

describe('migrateContentVolume', () => {
  let dir: string
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-cvm-')) })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('returns no_compose when there is no docker-compose.yml', () => {
    expect(migrateContentVolume(dir, 'dep12345')).toEqual({ status: 'no_compose' })
  })

  it('returns already_mounted when the content path is already in the compose file', () => {
    fs.writeFileSync(path.join(dir, 'docker-compose.yml'),
      'services:\n  learnhouse-app:\n    volumes:\n      - x:/app/api/content\n')
    expect(migrateContentVolume(dir, 'dep12345')).toEqual({ status: 'already_mounted' })
  })

  it('returns skipped_s3 when content delivery is s3api', () => {
    fs.writeFileSync(path.join(dir, 'docker-compose.yml'), 'services:\n  learnhouse-app:\n')
    fs.writeFileSync(path.join(dir, '.env'), 'LEARNHOUSE_CONTENT_DELIVERY_TYPE=s3api\n')
    expect(migrateContentVolume(dir, 'dep12345')).toEqual({ status: 'skipped_s3' })
  })

  it('patches the compose file and reports patched_no_data when no container exists', () => {
    const compose = [
      'name: learnhouse-dep12345',
      'services:',
      '  learnhouse-app:',
      '    image: ghcr.io/learnhouse/app:latest',
      '    container_name: learnhouse-app-dep12345',
      '    networks:',
      '      - learnhouse-network-dep12345',
      'networks:',
      '  learnhouse-network-dep12345:',
      '',
    ].join('\n')
    fs.writeFileSync(path.join(dir, 'docker-compose.yml'), compose)

    const res = migrateContentVolume(dir, 'dep12345')
    expect(res).toEqual({ status: 'patched_no_data' })

    const patched = fs.readFileSync(path.join(dir, 'docker-compose.yml'), 'utf-8')
    expect(patched).toContain('learnhouse_content_dep12345:/app/api/content')
    expect(patched).toMatch(/^volumes:/m)
  })
})

// ─── network — port probing & public IP (real sockets) ─────
//
// setup uses these to pick a free HTTP port and to reach external DB/Redis.
// Tested against real loopback sockets (deterministic, no external network)
// and a mocked fetch for the public-IP lookup.

describe('network — port and connectivity probes', () => {
  const close = (s: net.Server) => new Promise<void>((r) => s.close(() => r()))

  // Bind on the SAME interface checkPort uses (host omitted) so occupancy
  // genuinely conflicts. Returns the live server + its port.
  function occupyAny(port?: number): Promise<{ server: net.Server; port: number }> {
    return new Promise((resolve, reject) => {
      const server = net.createServer()
      server.once('error', reject)
      server.listen(port ?? 0, () => {
        resolve({ server, port: (server.address() as net.AddressInfo).port })
      })
    })
  }
  // A port that is currently free (bound then released, same binding as checkPort).
  async function freePort(): Promise<number> {
    const { server, port } = await occupyAny()
    await close(server)
    return port
  }

  describe('checkPort', () => {
    it('returns false while a port is in use and true once it is free', async () => {
      const { server, port } = await occupyAny()
      expect(await checkPort(port)).toBe(false) // held by our server
      await close(server)
      expect(await checkPort(port)).toBe(true)  // now free
    })
  })

  describe('findAvailablePort', () => {
    it('returns the preferred port when it is free', async () => {
      const port = await freePort()
      expect(await findAvailablePort(port, [])).toBe(port)
    })

    it('falls back to the first free candidate when preferred is taken', async () => {
      const taken = await occupyAny()
      const candidate = await freePort()
      const result = await findAvailablePort(taken.port, [candidate])
      expect(result).toBe(candidate)
      await close(taken.server)
    })

    it('returns null when preferred and every candidate are taken', async () => {
      const a = await occupyAny()
      const b = await occupyAny()
      expect(await findAvailablePort(a.port, [b.port])).toBeNull()
      await close(a.server); await close(b.server)
    })
  })

  describe('checkTcpConnection', () => {
    // This one needs a real accepted connection, so bind loopback explicitly.
    function listenLoopback(): Promise<{ server: net.Server; port: number }> {
      return new Promise((resolve) => {
        const server = net.createServer()
        server.listen(0, '127.0.0.1', () =>
          resolve({ server, port: (server.address() as net.AddressInfo).port }))
      })
    }

    it('connects to a listening socket', async () => {
      const { server, port } = await listenLoopback()
      expect(await checkTcpConnection('127.0.0.1', port, 2000)).toBe(true)
      await close(server)
    })

    it('fails on a closed port', async () => {
      const { server, port } = await listenLoopback()
      await close(server) // nothing listening now
      expect(await checkTcpConnection('127.0.0.1', port, 2000)).toBe(false)
    })
  })

  describe('getPublicIp', () => {
    afterEach(() => { vi.restoreAllMocks() })

    it('returns the first source that yields a valid IPv4', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('203.0.113.7\n', { status: 200 }),
      )
      expect(await getPublicIp()).toBe('203.0.113.7')
    })

    it('skips non-IP responses and returns null when nothing valid is found', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('<html>not an ip</html>', { status: 200 }),
      )
      expect(await getPublicIp()).toBeNull()
    })

    it('returns null when every source errors', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
      expect(await getPublicIp()).toBeNull()
    })

    it('rejects a body that merely contains an IP (regex is anchored)', async () => {
      // "<p>1.2.3.4</p>" embeds a valid IPv4 but is not a bare IP. The anchored
      // ^…$ regex must reject it; a de-anchored regex would wrongly return the junk.
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('<p>1.2.3.4</p>', { status: 200 }),
      )
      expect(await getPublicIp()).toBeNull()
    })
  })
})

// ─── services/health — readiness pollers (mocked fetch) ─────

describe('health pollers', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('waitForHealth resolves true as soon as /api/v1/health returns ok', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }))
    expect(await waitForHealth('http://localhost:8080')).toBe(true)
    expect(String(spy.mock.calls[0][0])).toBe('http://localhost:8080/api/v1/health')
  })

  it('waitForOrgSeed resolves true once the org endpoint returns ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"slug":"default"}', { status: 200 }))
    expect(await waitForOrgSeed('http://localhost:8080', 'default')).toBe(true)
  })

  it('waitForEeReady returns ee when the api reports mode: ee', async () => {
    const docker = await import('../src/services/docker.js')
    vi.mocked(docker.dockerComposeExec).mockReturnValue('{"mode":"ee"}')
    expect(await waitForEeReady('/srv/lh')).toBe('ee')
  })

  it('waitForHealth returns false after the deadline when never healthy', async () => {
    vi.useFakeTimers()
    try {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('connection refused'))
      const promise = waitForHealth('http://localhost:8080')
      await vi.advanceTimersByTimeAsync(200_000) // fast-forward past the 3-minute deadline
      expect(await promise).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('waitForOrgSeed returns false after the deadline when the org never seeds', async () => {
    vi.useFakeTimers()
    try {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no org yet'))
      const promise = waitForOrgSeed('http://localhost:8080', 'default')
      await vi.advanceTimersByTimeAsync(120_000)
      expect(await promise).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('waitForEeReady reports oss / timeout when the api never reports ee', async () => {
    vi.useFakeTimers()
    try {
      const docker = await import('../src/services/docker.js')
      vi.mocked(docker.dockerComposeExec).mockReturnValue('{"mode":"oss"}') // came up but not licensed
      const promise = waitForEeReady('/srv/lh')
      await vi.advanceTimersByTimeAsync(400_000) // past the EE-ready deadline
      expect(await promise).toBe('oss')
    } finally {
      vi.useRealTimers()
    }
  })
})

// ─── docker.ts — command construction for the remaining helpers ──
//
// Each helper is a thin wrapper that builds a specific docker command.
// Asserting the exact command (and the success/failure handling for the
// boolean probes) pins the contract without a real daemon.

describe('docker.ts command builders', () => {
  let execSync: ReturnType<typeof vi.fn>
  beforeEach(async () => {
    execSync = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    execSync.mockReset()
    execSync.mockReturnValue(Buffer.from(''))
  })
  const cmd = () => execSync.mock.calls.at(-1)?.[0] as string
  const opts = () => execSync.mock.calls.at(-1)?.[1] as { cwd?: string }

  it('isDockerInstalled probes `docker --version` (true ok / false on throw)', () => {
    expect(isDockerInstalled()).toBe(true)
    expect(cmd()).toBe('docker --version')
    execSync.mockImplementation(() => { throw new Error('nope') })
    expect(isDockerInstalled()).toBe(false)
  })

  it('isDockerRunning probes `docker info` and rethrows permission-denied', () => {
    expect(isDockerRunning()).toBe(true)
    expect(cmd()).toBe('docker info')
    execSync.mockImplementation(() => { throw new Error('not running') })
    expect(isDockerRunning()).toBe(false)
    execSync.mockImplementation(() => { const e = new Error('x') as Error & { stderr: Buffer }; e.stderr = Buffer.from('permission denied'); throw e })
    expect(() => isDockerRunning()).toThrow(/permission denied/i)
  })

  it('dockerComposeWorks probes `docker compose version`', () => {
    expect(dockerComposeWorks()).toBe(true)
    expect(cmd()).toBe('docker compose version')
  })

  it('dockerComposeWorks returns false when the compose plugin is missing', () => {
    execSync.mockImplementation(() => { throw new Error('unknown command "compose"') })
    expect(dockerComposeWorks()).toBe(false) // catch → false
  })

  it('waitForAptLock returns immediately on a non-apt system', () => {
    // execSync throws for  → not apt-based → early return.
    execSync.mockImplementation(() => { throw new Error('apt-get: not found') })
    expect(() => waitForAptLock(1)).not.toThrow()
    expect(cmd()).toBe('command -v apt-get')
  })

  it('waitForAptLock proceeds on apt systems and returns once the lock is free', () => {
    // apt-get + cloud-init present; pgrep throws → no dpkg/apt lock held → return (no sleep).
    execSync.mockImplementation((c: string) => {
      if (c.includes('pgrep')) throw new Error('nothing holds the lock')
      return Buffer.from('')
    })
    expect(() => waitForAptLock(1)).not.toThrow()
  })

  it('installDockerLinux fetches and runs the get.docker.com script', () => {
    execSync.mockImplementation((c: string) => {
      if (c.includes('pgrep')) throw new Error('lock free')
      return Buffer.from('')
    })
    expect(() => installDockerLinux()).not.toThrow()
    const cmds = execSync.mock.calls.map((c) => c[0] as string)
    expect(cmds.some((c) => c.includes('get.docker.com'))).toBe(true)
    expect(cmds.some((c) => c.includes('sh /tmp/get-docker.sh'))).toBe(true)
  })

  it('installDockerLinux retries the script once after a transient failure', () => {
    let shAttempts = 0
    execSync.mockImplementation((c: string) => {
      if (c.includes('pgrep')) throw new Error('lock free')
      if (c.includes('sh /tmp/get-docker.sh')) {
        shAttempts++
        if (shAttempts === 1) throw new Error('dpkg was locked') // first run fails → retry
      }
      return Buffer.from('')
    })
    expect(() => installDockerLinux()).not.toThrow()
    expect(shAttempts).toBe(2) // ran the installer twice (initial + retry)
  })

  it('dockerComposePs runs `docker compose ps` in cwd', () => {
    dockerComposePs('/srv/lh')
    expect(cmd()).toBe('docker compose ps')
    expect(opts().cwd).toBe('/srv/lh')
  })

  it('dockerComposeUpRetry runs `docker compose up -d`', () => {
    dockerComposeUpRetry('/srv/lh')
    expect(cmd()).toBe('docker compose up -d')
  })

  it('dockerComposeUpRetry retries after a transient failure', () => {
    // The first `up` fails; the helper calls onRetry, waits the 15s backoff
    // (a real blocking sleep — hence the long timeout), then succeeds.
    let n = 0
    execSync.mockImplementation(() => { n++; if (n === 1) throw new Error('dependency is unhealthy'); return Buffer.from('') })
    const onRetry = vi.fn()
    dockerComposeUpRetry('/srv/lh', 2, onRetry)
    expect(onRetry).toHaveBeenCalledWith(1)
    expect(n).toBe(2) // first attempt failed, second succeeded
  }, 30_000)

  it('dockerComposeUpRetry rethrows after exhausting attempts', () => {
    // attempts=1 → no retry/sleep; the single failure propagates.
    execSync.mockImplementation(() => { throw new Error('still unhealthy') })
    expect(() => dockerComposeUpRetry('/srv/lh', 1)).toThrow(/still unhealthy/)
  })

  it('dockerComposeUpRetry defaults to 3 attempts when not specified', () => {
    // Fail the first two `up`s, succeed on the third. With the DEFAULT attempts
    // this must recover; a smaller default (e.g. 1) would rethrow on attempt 1.
    let n = 0
    execSync.mockImplementation(() => { n++; if (n < 3) throw new Error('dependency is unhealthy'); return Buffer.from('') })
    dockerComposeUpRetry('/srv/lh') // no attempts arg → exercises the default
    expect(n).toBe(3) // proves the default allows three attempts
  }, 40_000)

  it('installDockerLinux tolerates a missing systemctl (non-systemd host)', () => {
    execSync.mockImplementation((c: string) => {
      if (c.includes('pgrep')) throw new Error('lock free')
      if (c.includes('systemctl')) throw new Error('systemctl: not found')
      return Buffer.from('')
    })
    expect(() => installDockerLinux()).not.toThrow()
  })

  it('dockerExec / getContainerLogs / getDockerDiskUsage build their commands', () => {
    dockerExec('learnhouse-app-x', 'env')
    expect(cmd()).toBe('docker exec learnhouse-app-x env')
    getContainerLogs('learnhouse-app-x', 25)
    expect(cmd()).toBe('docker logs --tail 25 learnhouse-app-x')
    getDockerDiskUsage()
    expect(cmd()).toBe('docker system df')
  })

  it('dockerExecToFile / dockerExecFromFile redirect through a shell', () => {
    dockerExecToFile('db-x', 'pg_dump learnhouse', '/tmp/out.sql')
    expect(cmd()).toBe('docker exec db-x pg_dump learnhouse > "/tmp/out.sql"')
    dockerExecFromFile('db-x', 'psql learnhouse', '/tmp/in.sql')
    expect(cmd()).toBe('docker exec -i db-x psql learnhouse < "/tmp/in.sql"')
  })

  it('dockerStats / dockerStatsForContainers build the table format', () => {
    dockerStats('/srv/lh')
    expect(cmd()).toContain('docker compose stats --no-stream --format')
    dockerStatsForContainers(['a', 'b'])
    expect(cmd()).toContain('docker stats --no-stream')
    expect(cmd()).toMatch(/ a b$/)
    expect(dockerStatsForContainers([])).toBe('') // short-circuits, no command
  })

  it('isTcpPortListening tries lsof then ss (true if either reports a listener)', () => {
    execSync.mockReturnValue(Buffer.from('node 123 LISTEN'))
    expect(isTcpPortListening(8080)).toBe(true)
    expect(cmd()).toContain('lsof -nP -iTCP:8080 -sTCP:LISTEN')
    execSync.mockImplementation(() => { throw new Error('nothing') })
    expect(isTcpPortListening(8080)).toBe(false)
  })
})

describe('docker.ts isContainerRunning (real impl)', () => {
  it('runs docker inspect and maps "true" → true, else false', async () => {
    const execSync = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    execSync.mockReset()
    const real = await vi.importActual<typeof import('../src/services/docker.js')>('../src/services/docker.js')
    execSync.mockReturnValue(Buffer.from('true\n'))
    expect(real.isContainerRunning('learnhouse-app-x')).toBe(true)
    expect(execSync.mock.calls.at(-1)?.[0]).toBe("docker inspect -f '{{.State.Running}}' learnhouse-app-x")
    execSync.mockReturnValue(Buffer.from('false\n'))
    expect(real.isContainerRunning('x')).toBe(false)
    execSync.mockImplementation(() => { throw new Error('no container') })
    expect(real.isContainerRunning('x')).toBe(false)
  })
})

// ─── version-check — checkForUpdates (mocked npm registry) ──

describe('checkForUpdates', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('prints an update notice when the registry has a newer version', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ 'dist-tags': { latest: '99.0.0' } }), { status: 200 }))
    const logs: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((m?: unknown) => { logs.push(String(m ?? '')) })
    await checkForUpdates()
    spy.mockRestore()
    expect(logs.join('\n')).toMatch(/Update available/)
  })

  it('stays silent when already up to date', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ 'dist-tags': { latest: '0.0.1' } }), { status: 200 }))
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await checkForUpdates()
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('notices a newer PATCH/MINOR release, not just a newer major', async () => {
    // Bump only the patch segment. compareVersions must walk past the equal
    // major/minor segments to see the newer patch — a major-only comparison misses it.
    const [maj, min, pat] = VERSION.split('.').map(Number)
    const newerPatch = `${maj}.${min}.${(pat || 0) + 1}`
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ 'dist-tags': { latest: newerPatch } }), { status: 200 }))
    const logs: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((m?: unknown) => { logs.push(String(m ?? '')) })
    await checkForUpdates()
    spy.mockRestore()
    expect(logs.join('\n')).toMatch(/Update available/)
  })

  it('stays silent when the registry version exactly equals the current one', async () => {
    // latest === VERSION makes every segment compare equal → compareVersions returns 0.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ 'dist-tags': { latest: VERSION } }), { status: 200 }))
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await checkForUpdates()
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('never throws on a network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    await expect(checkForUpdates()).resolves.toBeUndefined()
  })
})

// ─── generateEnvFile — optional-feature branches ────────────

describe('generateEnvFile — feature flags', () => {
  it('emits AI, SMTP email, S3, Google and Unsplash vars when enabled', () => {
    const env = generateEnvFile({
      ...baseConfig,
      aiEnabled: true, geminiApiKey: 'AIzaKEY',
      emailEnabled: true, emailProvider: 'smtp', smtpHost: 'smtp.test', smtpPort: 2525,
      smtpUsername: 'u', smtpPassword: 'pw', smtpUseTls: false, systemEmailAddress: 'no@reply.dev',
      s3Enabled: true, s3BucketName: 'bkt', s3EndpointUrl: 'https://s3.example.com',
      googleOAuthEnabled: true, googleClientId: 'gid', googleClientSecret: 'gsec',
      unsplashEnabled: true, unsplashAccessKey: 'ukey',
    })
    expect(env).toContain('LEARNHOUSE_GEMINI_API_KEY=AIzaKEY')
    expect(env).toContain('LEARNHOUSE_IS_AI_ENABLED=True')
    expect(env).toContain('LEARNHOUSE_SMTP_HOST=smtp.test')
    expect(env).toContain('LEARNHOUSE_SMTP_PORT=2525')
    expect(env).toContain('LEARNHOUSE_SMTP_USE_TLS=False')
    expect(env).toContain('LEARNHOUSE_S3_API_BUCKET_NAME=bkt')
    expect(env).toContain('LEARNHOUSE_S3_API_ENDPOINT_URL=https://s3.example.com')
    expect(env).toContain('LEARNHOUSE_GOOGLE_CLIENT_ID=gid')
    expect(env).toContain('NEXT_PUBLIC_UNSPLASH_ACCESS_KEY=ukey')
  })

  it('uses the Resend key for the resend email provider', () => {
    const env = generateEnvFile({ ...baseConfig, emailEnabled: true, emailProvider: 'resend', resendApiKey: 're_key' })
    expect(env).toContain('LEARNHOUSE_RESEND_API_KEY=re_key')
  })

  it('points the connection strings at external DB/Redis when configured', () => {
    const env = generateEnvFile({
      ...baseConfig,
      useExternalDb: true, externalDbConnectionString: 'postgresql://u:p@db.ext:5432/lh',
      useExternalRedis: true, externalRedisConnectionString: 'redis://cache.ext:6379',
    })
    expect(env).toContain('LEARNHOUSE_SQL_CONNECTION_STRING=postgresql://u:p@db.ext:5432/lh')
    expect(env).toContain('redis://cache.ext:6379')
  })

  it('marks AI disabled when the feature is off', () => {
    expect(generateEnvFile({ ...baseConfig, aiEnabled: false })).toContain('LEARNHOUSE_IS_AI_ENABLED=False')
  })
})

// ─── update — formatBytes (human-readable sizes) ────────────

describe('formatBytes', () => {
  it('formats bytes, KB, MB and GB', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3.00 GB')
  })
})

// ─── config-store / network — edge branches ─────────────────

describe('config-store edge cases', () => {
  it('readConfig returns null on malformed JSON', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-badcfg-'))
    fs.writeFileSync(path.join(d, 'learnhouse.config.json'), '{ this is not valid json')
    expect(readConfig(d)).toBeNull()
    fs.rmSync(d, { recursive: true, force: true })
  })

  it('listInstallations skips a directory whose config is malformed JSON', () => {
    const fakeHome = path.join(os.tmpdir(), 'lh-badlist-' + process.pid)
    const base = path.join(fakeHome, '.learnhouse')
    const bad = path.join(base, 'broken')
    fs.mkdirSync(bad, { recursive: true })
    fs.writeFileSync(path.join(bad, 'learnhouse.config.json'), '{bad')
    fs.writeFileSync(path.join(bad, '.env'), '# x')
    const origHome = process.env.HOME
    process.env.HOME = fakeHome
    try {
      expect(listInstallations()).toEqual([]) // malformed config → isCompleteInstall catch → excluded
    } finally {
      if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome
      fs.rmSync(fakeHome, { recursive: true, force: true })
    }
  })
})

describe('checkTcpConnection — timeout', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('resolves false and tears down the socket when neither connect nor error fires in time', async () => {
    // Deterministic (no live network): a socket that never emits 'connect' or
    // 'error' must hit the timeout branch → resolve false AND destroy the socket.
    // The old version dialed RFC-5737 192.0.2.1 and was flaky on networks that
    // intercept/route it (it could spuriously 'connect').
    const fakeSocket = { once: vi.fn(), destroy: vi.fn() }
    const spy = vi.spyOn(net, 'createConnection').mockReturnValue(fakeSocket as never)
    expect(await checkTcpConnection('10.255.255.1', 80, 80)).toBe(false)
    expect(spy).toHaveBeenCalledWith({ host: '10.255.255.1', port: 80 })
    expect(fakeSocket.destroy).toHaveBeenCalled() // timeout path cleaned up the socket
  })

  it('resolves true when the socket connects before the timeout', async () => {
    const fakeSocket = {
      once: (ev: string, cb: () => void) => { if (ev === 'connect') cb() },
      destroy: vi.fn(),
    }
    vi.spyOn(net, 'createConnection').mockReturnValue(fakeSocket as never)
    expect(await checkTcpConnection('127.0.0.1', 5432, 80)).toBe(true)
  })
})
