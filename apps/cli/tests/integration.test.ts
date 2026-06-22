import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  cliWithHome,
  getContainerImage,
  getRunningContainers,
  composeUp,
  composeDown,
  waitForUrl,
  waitForOrgSeed,
  apiLogin,
  apiGet,
  CMD_NAME,
  CMD_PORT,
  INTEG_NAME,
  INTEG_PORT,
  TEST_ADMIN_EMAIL,
  TEST_ADMIN_PASSWORD,
} from './helpers.js'

/**
 * CLI integration tests — run the real binary against live Docker containers.
 *
 * Every install lives under its own throwaway $HOME (mkdtemp), so these tests
 * never touch — or get confused by — installations on the host machine. They
 * are organised into three independent sections:
 *
 *   1. Live install          — boot one fresh install and exercise every
 *                              non-interactive command against it.
 *   2. Upgrade old → new     — boot a pinned OLD image and upgrade via the CLI,
 *                              proving `learnhouse update` actually pulls and
 *                              the database survives (the LEA-47 fixes).
 *   3. No installation       — error paths when no install exists.
 *
 * Requires Docker with internet access (pulls from ghcr.io).
 * Run with: bun run test:integration
 */

// ─────────────────────────────────────────────────────────────────────────────
// Section 1 — Live install: command coverage on a single fresh deployment
// ─────────────────────────────────────────────────────────────────────────────

describe('CLI integration — live install (command coverage)', () => {
  let home: string
  let installDir: string
  let deploymentId: string

  const cli = (args: string, timeoutMs = 120_000) => cliWithHome(home, args, timeoutMs)

  // Boot once; every nested suite shares this live install.
  beforeAll(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-cmd-'))
    fs.mkdirSync(path.join(home, '.learnhouse'), { recursive: true })
    installDir = path.join(home, '.learnhouse', CMD_NAME)

    // Use a custom org slug so we can verify it propagated end-to-end.
    const setup = cli(
      [
        'setup', '--ci',
        `--name ${CMD_NAME}`,
        '--domain localhost',
        `--port ${CMD_PORT}`,
        `--admin-email ${TEST_ADMIN_EMAIL}`,
        `--admin-password ${TEST_ADMIN_PASSWORD}`,
        '--org-name "Acme Academy"',
        '--org-slug acme',
        '--no-start',
      ].join(' '),
      60_000,
    )
    if (setup.exitCode !== 0) throw new Error(`setup failed:\n${setup.stdout}\n${setup.stderr}`)

    deploymentId = JSON.parse(
      fs.readFileSync(path.join(installDir, 'learnhouse.config.json'), 'utf-8'),
    ).deploymentId

    composeUp(installDir)

    if (!(await waitForUrl(`http://localhost:${CMD_PORT}/api/v1/health`, 180_000)))
      throw new Error('App did not become healthy after startup')
    if (!(await waitForOrgSeed(CMD_PORT, 'acme', 60_000)))
      throw new Error('"acme" org was not seeded after startup')
  }, 600_000)

  afterAll(() => {
    try { composeDown(installDir) } catch { /* ignore */ }
    try { fs.rmSync(home, { recursive: true, force: true }) } catch { /* ignore */ }
  }, 120_000)

  // ── setup --ci: the files it generated ──────────────────────────────────────
  describe('setup --ci generates correct config files', () => {
    it('writes docker-compose.yml with the app image, pgvector and nginx', () => {
      const compose = fs.readFileSync(path.join(installDir, 'docker-compose.yml'), 'utf-8')
      expect(compose).toContain('ghcr.io/learnhouse/app:')
      expect(compose).toContain('pgvector')
      expect(compose).toContain('nginx')
      expect(compose).toContain(`container_name: learnhouse-app-${deploymentId}`)
    })

    it('adds the socat SSR-forward sidecar for a non-80 port', () => {
      const compose = fs.readFileSync(path.join(installDir, 'docker-compose.yml'), 'utf-8')
      expect(compose).toContain('alpine/socat')
      expect(compose).toContain('ssr-fwd')
      expect(compose).toContain(`TCP-LISTEN:${CMD_PORT},fork,reuseaddr`)
    })

    it('nginx.conf forwards the real Host header and listens on IPv6', () => {
      const nginx = fs.readFileSync(path.join(installDir, 'extra', 'nginx.prod.conf'), 'utf-8')
      expect(nginx).toMatch(/proxy_set_header\s+Host\s+\$http_host/)
      expect(nginx).not.toMatch(/proxy_set_header\s+Host\s+\$host\b/)
      expect(nginx).toMatch(/listen\s+\[::\]:80/)
    })

    it('.env carries the org slug/name and admin credentials, with no "=undefined"', () => {
      const env = fs.readFileSync(path.join(installDir, '.env'), 'utf-8')
      expect(env).toContain('NEXT_PUBLIC_LEARNHOUSE_DEFAULT_ORG=acme')
      expect(env).toContain('LEARNHOUSE_INITIAL_ORG_SLUG=acme')
      expect(env).toContain('Acme Academy')
      expect(env).toContain(`LEARNHOUSE_INITIAL_ADMIN_EMAIL=${TEST_ADMIN_EMAIL}`)
      expect(env).toContain(`LEARNHOUSE_INITIAL_ADMIN_PASSWORD=${TEST_ADMIN_PASSWORD}`)
      expect(env).not.toMatch(/=undefined(\s|$)/)
    })

    it('learnhouse.config.json records the right metadata', () => {
      const cfg = JSON.parse(fs.readFileSync(path.join(installDir, 'learnhouse.config.json'), 'utf-8'))
      expect(cfg.domain).toBe('localhost')
      expect(cfg.httpPort).toBe(CMD_PORT)
      expect(cfg.orgSlug).toBe('acme')
      expect(cfg.installDir).toBe(installDir)
      expect(cfg.deploymentId).toMatch(/^[a-f0-9]{8}$/)
    })
  })

  // ── setup --ci: input validation rejects bad flags ──────────────────────────
  describe('setup --ci rejects invalid input', () => {
    const cases: Array<[string, string, RegExp]> = [
      ['a missing --admin-password',
        `setup --ci --name err-no-pw --domain localhost --port 9091 --admin-email admin@error.dev`,
        /--admin-password/],
      ['a reserved .local admin email',
        `setup --ci --name err-local --domain localhost --port 9092 --admin-email admin@school.local --admin-password ${TEST_ADMIN_PASSWORD}`,
        /reserved|RFC 6761/i],
      ['a reserved .test admin email',
        `setup --ci --name err-test --domain localhost --port 9093 --admin-email admin@school.test --admin-password ${TEST_ADMIN_PASSWORD}`,
        /reserved|RFC 6761/i],
      ['a too-short admin password',
        `setup --ci --name err-pw --domain localhost --port 9094 --admin-email admin@ok.dev --admin-password abc`,
        /8 characters|too short/i],
      ['a port out of range',
        `setup --ci --name err-port --domain localhost --port 0 --admin-email admin@ok.dev --admin-password ${TEST_ADMIN_PASSWORD}`,
        /port|between/i],
      ['a domain that is an IP address',
        `setup --ci --name err-ip --domain 192.168.1.1 --port 8080 --admin-email admin@ok.dev --admin-password ${TEST_ADMIN_PASSWORD}`,
        /domain|valid/i],
    ]

    it.each(cases)('exits 1 on %s', (_label, args, pattern) => {
      const r = cli(args, 30_000)
      expect(r.exitCode).toBe(1)
      expect(r.stdout + r.stderr).toMatch(pattern)
    })
  })

  // ── config ──────────────────────────────────────────────────────────────────
  describe('config shows the installation details', () => {
    it('exits 0 and prints domain, install dir, org slug and the non-standard port', () => {
      const r = cli('config')
      expect(r.exitCode).toBe(0)
      expect(r.stdout).toContain('localhost')
      expect(r.stdout).toContain(installDir)
      expect(r.stdout).toContain('acme')
      expect(r.stdout).toContain(String(CMD_PORT))
    })
  })

  // ── status ──────────────────────────────────────────────────────────────────
  describe('status lists the running containers', () => {
    it('shows app, db, redis and nginx as Up', () => {
      const r = cli('status')
      expect(r.exitCode).toBe(0)
      expect(r.stdout).toContain('learnhouse-app')
      expect(r.stdout).toContain('Up')
      expect(r.stdout).toContain('db')
      expect(r.stdout).toContain('redis')
      expect(r.stdout).toContain('nginx')
    })
  })

  // ── health ──────────────────────────────────────────────────────────────────
  describe('health probes every service', () => {
    it('reports PostgreSQL, Redis and the HTTP endpoint, then completes', () => {
      const r = cli('health', 60_000)
      expect(r.exitCode).toBe(0)
      expect(r.stdout).toContain('PostgreSQL')
      expect(r.stdout).toContain('Redis')
      expect(r.stdout).toMatch(/200|health/i)
      expect(r.stdout).toContain('Health check complete')
    })
  })

  // ── doctor ──────────────────────────────────────────────────────────────────
  describe('doctor runs all diagnostics', () => {
    it('confirms Docker, the running app, env vars, disk, restarts and log analysis', () => {
      const r = cli('doctor', 60_000)
      expect(r.exitCode).toBe(0)
      expect(r.stdout).toContain('Docker installed')
      expect(r.stdout).toContain('Docker daemon running')
      expect(r.stdout).toContain('learnhouse-app running')
      expect(r.stdout).toContain('environment variables present')
      expect(r.stdout).toMatch(/disk space|available/i)
      expect(r.stdout).toMatch(/restart/i)
      expect(r.stdout).toMatch(/log analysis|no errors/i)
    })
  })

  // ── logs ────────────────────────────────────────────────────────────────────
  describe('logs is registered and produces output', () => {
    it('--help mentions logs', () => {
      const r = cli('logs --help')
      expect(r.exitCode).toBe(0)
      expect(r.stdout.toLowerCase()).toContain('log')
    })

    it('docker compose logs returns historical output for the install', () => {
      const r = spawnSync('docker', ['compose', 'logs', '--tail=10', '--no-color'],
        { cwd: installDir, encoding: 'utf-8', timeout: 15_000 })
      expect(((r.stdout ?? '') + (r.stderr ?? '')).length).toBeGreaterThan(0)
    })
  })

  // ── env ─────────────────────────────────────────────────────────────────────
  describe('env command and .env file handling', () => {
    it('is registered in the CLI', () => {
      expect(cli('--help').stdout).toContain('env')
    })

    it('the .env file is readable, writable and persists edits', () => {
      const envPath = path.join(installDir, '.env')
      const original = fs.readFileSync(envPath, 'utf-8')
      expect(original).toContain('LEARNHOUSE_DOMAIN')
      expect(fs.statSync(envPath).mode & 0o200).toBeGreaterThan(0) // owner-writable

      fs.writeFileSync(envPath, original + '\nLH_TEST_SENTINEL=from-integration-test\n')
      expect(fs.readFileSync(envPath, 'utf-8')).toContain('LH_TEST_SENTINEL=from-integration-test')
      fs.writeFileSync(envPath, original) // restore
    })
  })

  // ── deployments ─────────────────────────────────────────────────────────────
  describe('deployments command', () => {
    it('is registered in the CLI', () => {
      expect(cli('--help').stdout).toContain('deployments')
    })

    it('this deployment has app, db and redis containers running', () => {
      const r = spawnSync('docker',
        ['ps', '--filter', `name=learnhouse`, '--filter', `name=${deploymentId}`, '--format', '{{.Names}}'],
        { encoding: 'utf-8' })
      const names = (r.stdout ?? '').trim().split('\n').filter(Boolean)
      expect(names.some((n) => n.includes('learnhouse-app'))).toBe(true)
      expect(names.some((n) => n.includes('learnhouse-db'))).toBe(true)
      expect(names.some((n) => n.includes('learnhouse-redis'))).toBe(true)
    })
  })

  // ── backup ──────────────────────────────────────────────────────────────────
  describe('backup creates a valid archive', () => {
    let archive: string

    it('--help shows the archive option', () => {
      const r = cli('backup --help')
      expect(r.exitCode).toBe(0)
      expect(r.stdout.toLowerCase()).toContain('archive')
    })

    it('writes a new .tar.gz into backups/ and prints its path', () => {
      const backupsDir = path.join(installDir, 'backups')
      const before = fs.existsSync(backupsDir)
        ? fs.readdirSync(backupsDir).filter((f) => f.endsWith('.tar.gz')) : []

      const r = cli('backup', 120_000)
      expect(r.exitCode).toBe(0)
      expect(r.stdout).toContain('backups')
      expect(r.stdout).toMatch(/\.tar\.gz/)

      const after = fs.readdirSync(backupsDir).filter((f) => f.endsWith('.tar.gz'))
      const fresh = after.filter((f) => !before.includes(f))
      expect(fresh.length).toBeGreaterThanOrEqual(1)
      archive = path.join(backupsDir, fresh[0])
    }, 120_000)

    it('the archive holds a real pg_dump (CREATE + idempotent DROP) and the .env', () => {
      const out = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-backup-check-'))
      try {
        const tar = spawnSync('tar', ['-xzf', archive, '-C', out], { stdio: 'pipe' })
        if (tar.status !== 0) throw new Error(`tar failed: ${tar.stderr?.toString()}`)
        const sub = fs.readdirSync(out).find((e) => fs.existsSync(path.join(out, e, 'database.sql')))
        expect(sub).toBeTruthy()

        const dump = fs.readFileSync(path.join(out, sub!, 'database.sql'), 'utf-8')
        expect(dump).toContain('CREATE TABLE')
        expect(dump).toContain('DROP TABLE IF EXISTS')
        expect(fs.readFileSync(path.join(out, sub!, '.env'), 'utf-8')).toContain('LEARNHOUSE_DOMAIN')
      } finally {
        fs.rmSync(out, { recursive: true, force: true })
      }
    })

    it('a second backup produces a separate archive', () => {
      const backupsDir = path.join(installDir, 'backups')
      const before = fs.readdirSync(backupsDir).filter((f) => f.endsWith('.tar.gz')).length
      expect(cli('backup', 120_000).exitCode).toBe(0)
      expect(fs.readdirSync(backupsDir).filter((f) => f.endsWith('.tar.gz')).length).toBeGreaterThan(before)
    }, 120_000)
  })

  // ── restore (the --clean --if-exists idempotency fix) ───────────────────────
  describe('restore is idempotent against a live database', () => {
    let archive: string

    beforeAll(() => {
      const r = cli('backup', 120_000)
      if (r.exitCode !== 0) throw new Error('pre-restore backup failed')
      const backupsDir = path.join(installDir, 'backups')
      archive = path.join(backupsDir,
        fs.readdirSync(backupsDir).filter((f) => f.endsWith('.tar.gz')).sort().reverse()[0])
    }, 180_000)

    it('--help shows the archive argument', () => {
      expect(cli('restore --help').stdout).toContain('archive')
    })

    it('exits non-zero on a missing archive or no argument', () => {
      expect(cli('restore /tmp/nonexistent-archive.tar.gz').exitCode).not.toBe(0)
      expect(cli('restore').exitCode).not.toBe(0)
    })

    it('restores over the live DB with no "already exists" error', () => {
      const r = cli(`restore ${archive}`, 120_000)
      if (r.exitCode !== 0) console.error('restore:', r.stdout, r.stderr)
      expect(r.exitCode).toBe(0)
      expect(r.stdout + r.stderr).not.toContain('already exists')
    })

    it('the app stays healthy and the acme org survives the restore', async () => {
      expect(await waitForUrl(`http://localhost:${CMD_PORT}/api/v1/health`, 60_000)).toBe(true)
      expect(await apiGet<{ slug: string }>(CMD_PORT, '/api/v1/orgs/slug/acme')).toMatchObject({ slug: 'acme' })
    })

    it('restoring the same archive twice is still clean', () => {
      const r = cli(`restore ${archive}`, 120_000)
      expect(r.exitCode).toBe(0)
      expect(r.stdout + r.stderr).not.toContain('already exists')
    })

    it('a corrupt archive fails cleanly and leaves the live database intact', async () => {
      const junk = path.join(installDir, 'backups', 'corrupt.tar.gz')
      fs.writeFileSync(junk, 'this is not a gzip tarball')
      const r = cli(`restore ${junk}`, 60_000)
      expect(r.exitCode).not.toBe(0)
      // a failed extraction must not wipe the running database
      expect(await apiGet<{ slug: string }>(CMD_PORT, '/api/v1/orgs/slug/acme')).toMatchObject({ slug: 'acme' })
    })
  })

  // ── stop / start ────────────────────────────────────────────────────────────
  describe('stop / start lifecycle', () => {
    const appRunning = () =>
      getRunningContainers(`learnhouse-app-${deploymentId}`).length > 0

    it('stop brings every container down', () => {
      const r = cli('stop', 60_000)
      expect(r.exitCode).toBe(0)
      expect(r.stdout).toContain('stopped')
      expect(appRunning()).toBe(false)
      expect(cli('status').stdout).not.toContain('Up ')
    })

    it('start brings the app back and it becomes reachable', async () => {
      const r = cli('start', 300_000)
      expect(r.exitCode).toBe(0)
      expect(r.stdout).toContain('running')
      expect(appRunning()).toBe(true)
      expect(await waitForUrl(`http://localhost:${CMD_PORT}/api/v1/health`, 120_000)).toBe(true)
    }, 300_000)

    it('a second stop/start cycle also succeeds', () => {
      expect(cli('stop', 60_000).exitCode).toBe(0)
      expect(cli('start', 300_000).exitCode).toBe(0)
    }, 400_000)
  })

  // ── API after the full lifecycle ────────────────────────────────────────────
  describe('API is intact after the lifecycle', () => {
    // The /health endpoint does not hit the DB, so wait on the org route to be
    // sure Postgres is ready before asserting on DB-backed responses.
    beforeAll(async () => {
      if (!(await waitForOrgSeed(CMD_PORT, 'acme', 120_000)))
        throw new Error(`org 'acme' not reachable before API checks (port ${CMD_PORT})`)
    }, 120_000)

    it('the acme org is served and admin can authenticate', async () => {
      expect(await apiGet<{ slug: string }>(CMD_PORT, '/api/v1/orgs/slug/acme')).toMatchObject({ slug: 'acme' })
      const token = await apiLogin(CMD_PORT, TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD)
      expect(typeof token).toBe('string')
      expect(token.length).toBeGreaterThan(10)
    })
  })

  // ── command registration / flag surface ─────────────────────────────────────
  describe('command and flag surface', () => {
    it('scale --help is registered', () => {
      const r = cli('scale --help')
      expect(r.exitCode).toBe(0)
      expect(r.stdout.toLowerCase()).toContain('scale')
    })

    it('update --help shows --to, --migrate, --no-migrate, --no-backup', () => {
      const r = cli('update --help')
      expect(r.exitCode).toBe(0)
      for (const flag of ['--to', '--migrate', '--no-migrate', '--no-backup']) {
        expect(r.stdout).toContain(flag)
      }
    })

    it('--version prints a semver and --help lists every command', () => {
      expect(cli('--version').stdout.trim()).toMatch(/^\d+\.\d+\.\d+/)
      const out = cli('--help').stdout
      for (const cmd of ['setup', 'start', 'stop', 'update', 'status', 'health',
        'logs', 'config', 'env', 'backup', 'restore', 'deployments', 'doctor', 'shell', 'scale']) {
        expect(out).toContain(cmd)
      }
    })

    it('no arguments shows the welcome screen, not an error', () => {
      const r = cli('')
      expect(r.exitCode).toBe(0)
      expect(r.stdout).toContain('LearnHouse')
      expect(r.stdout).toContain('Available commands')
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Section 2 — Upgrade an old image to a new one via `learnhouse update`
//
// This is the LEA-47 regression surface: the update command used to rewrite
// the compose tag but never pull, so the container restarted on the cached old
// image. We pin a known-old image, start it, upgrade via the CLI, and prove the
// running image actually changed and the database survived.
// ─────────────────────────────────────────────────────────────────────────────

describe('CLI integration — upgrade (old → new image)', () => {
  // 1.0.1 is the oldest stable GHCR tag carrying alembic migrations; upgrading
  // to latest applies the full delta of migrations.
  const OLD_VERSION = '1.0.1'
  const NEW_VERSION = 'latest'
  const GHCR = 'ghcr.io/learnhouse/app'

  let home: string
  let installDir: string
  let deploymentId: string

  const cli = (args: string, timeoutMs = 120_000) => cliWithHome(home, args, timeoutMs)
  const appContainer = () =>
    getRunningContainers(`learnhouse-app-${deploymentId}`)[0] ?? `learnhouse-app-${deploymentId}`

  beforeAll(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-integ-'))
    fs.mkdirSync(path.join(home, '.learnhouse'), { recursive: true })
    installDir = path.join(home, '.learnhouse', INTEG_NAME)

    const setup = cli(
      [
        'setup', '--ci',
        `--name ${INTEG_NAME}`,
        '--domain localhost',
        `--port ${INTEG_PORT}`,
        `--admin-email ${TEST_ADMIN_EMAIL}`,
        `--admin-password ${TEST_ADMIN_PASSWORD}`,
        '--no-start',
      ].join(' '),
      60_000,
    )
    if (setup.exitCode !== 0) throw new Error(`setup failed:\n${setup.stdout}\n${setup.stderr}`)

    deploymentId = JSON.parse(
      fs.readFileSync(path.join(installDir, 'learnhouse.config.json'), 'utf-8'),
    ).deploymentId

    // Pin the OLD image so we start from a known-stale version.
    const composePath = path.join(installDir, 'docker-compose.yml')
    fs.writeFileSync(composePath, fs.readFileSync(composePath, 'utf-8').replace(
      /image:\s*ghcr\.io\/learnhouse\/app:\S+/, `image: ${GHCR}:${OLD_VERSION}`))

    composeUp(installDir)

    if (!(await waitForUrl(`http://localhost:${INTEG_PORT}/api/v1/health`, 180_000)))
      throw new Error(`app did not become healthy on ${OLD_VERSION}`)
    if (!(await waitForOrgSeed(INTEG_PORT, 'default', 60_000)))
      throw new Error('default org was not seeded')
  }, 600_000)

  afterAll(() => {
    try { composeDown(installDir) } catch { /* ignore */ }
    try { fs.rmSync(home, { recursive: true, force: true }) } catch { /* ignore */ }
  }, 120_000)

  describe('baseline: the old image is running', () => {
    it('the running container is the pinned old image', () => {
      expect(getContainerImage(appContainer())).toContain(OLD_VERSION)
    })

    it('the old version answers health and seeds the default org', async () => {
      expect((await fetch(`http://localhost:${INTEG_PORT}/api/v1/health`)).ok).toBe(true)
      expect(await apiGet<{ slug: string }>(INTEG_PORT, '/api/v1/orgs/slug/default')).toMatchObject({ slug: 'default' })
    })

    it('admin can authenticate on the old version', async () => {
      const token = await apiLogin(INTEG_PORT, TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD)
      expect(token.length).toBeGreaterThan(10)
    })
  })

  describe('upgrade to the new image', () => {
    it('update --migrate exits 0', () => {
      const r = cli('update --no-backup --migrate', 600_000)
      if (r.exitCode !== 0) console.error('update:', r.stdout, r.stderr)
      expect(r.exitCode).toBe(0)
    }, 600_000)

    it('the compose file no longer pins the old image', () => {
      const compose = fs.readFileSync(path.join(installDir, 'docker-compose.yml'), 'utf-8')
      expect(compose).not.toContain(`${GHCR}:${OLD_VERSION}`)
      expect(compose).toContain(GHCR)
    })

    it('the running container actually moved off the old image', () => {
      const image = getContainerImage(appContainer())
      expect(image).not.toContain(OLD_VERSION)
      expect(image).toContain('learnhouse')
    })

    it('health responds and the default org survives the upgrade', async () => {
      expect(await waitForUrl(`http://localhost:${INTEG_PORT}/api/v1/health`, 60_000)).toBe(true)
      expect(await apiGet<{ slug: string }>(INTEG_PORT, '/api/v1/orgs/slug/default')).toMatchObject({ slug: 'default' })
    })

    it('alembic is at head after the migration ran', () => {
      const r = spawnSync('docker',
        ['compose', 'exec', 'learnhouse-app', 'sh', '-c', 'cd /app/api && uv run alembic current'],
        { cwd: installDir, encoding: 'utf-8' })
      const out = ((r.stdout ?? '') + (r.stderr ?? '')).toLowerCase()
      expect(out).not.toContain('error')
      expect(out).toContain('(head)')
    })

    it('cli status and health are green on the upgraded install', () => {
      const status = cli('status')
      expect(status.exitCode).toBe(0)
      expect(status.stdout).toContain('learnhouse-app')
      expect(status.stdout).toContain('Up')

      const health = cli('health', 60_000)
      expect(health.exitCode).toBe(0)
      expect(health.stdout).toContain('Health check complete')
    })
  })

  describe('stop / start and doctor on the upgraded install', () => {
    it('stop then start keeps the new image and stays healthy', async () => {
      expect(cli('stop', 60_000).exitCode).toBe(0)
      expect(getRunningContainers(`learnhouse-app-${deploymentId}`).length).toBe(0)

      expect(cli('start', 300_000).exitCode).toBe(0)
      expect(getContainerImage(appContainer())).toContain(NEW_VERSION)
      expect(await waitForUrl(`http://localhost:${INTEG_PORT}/api/v1/health`, 120_000)).toBe(true)
    }, 400_000)

    it('doctor shows all green', () => {
      const r = cli('doctor', 60_000)
      expect(r.exitCode).toBe(0)
      expect(r.stdout).toContain('learnhouse-app running')
      expect(r.stdout).toContain('environment variables present')
    })
  })

  describe('update flag edge cases', () => {
    it('--to with a nonexistent version fails clearly without touching the install', () => {
      const r = cli('update --to 0.0.0-nonexistent --no-backup --no-migrate', 60_000)
      expect(r.exitCode).not.toBe(0)
      expect(r.stdout + r.stderr).toContain('not found')
    })

    it('--no-migrate re-upgrades but skips alembic, printing instructions', () => {
      const r = cli('update --no-backup --no-migrate', 300_000)
      expect(r.exitCode).toBe(0)
      expect(r.stdout).toContain('alembic')
    }, 300_000)

    it('--version is swallowed by the global flag and never runs an update', () => {
      // Commander v15 intercepts --version at the global level; it must print
      // the CLI version, not perform an update (the old broken flag name).
      const r = cli('update --version 1.2.6 --no-backup --no-migrate', 30_000)
      expect(r.stdout + r.stderr).not.toContain('Updating LearnHouse')
    })
  })

  describe('default update path (backup taken, already up to date)', () => {
    // Every other update test passes --no-backup; this exercises the DEFAULT
    // path that takes a pre-upgrade DB dump (db-pre-upgrade-*.sql.gz — distinct
    // from the `backup` command's .tar.gz archives), while the install is
    // already on latest (a no-op re-pull that must still succeed and stay up).
    const preUpgrade = (dir: string) =>
      (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((f) => /^db-pre-upgrade-.*\.sql\.gz$/.test(f))

    it('a plain `update` writes a pre-upgrade backup, keeps the new image and stays healthy', async () => {
      const backupsDir = path.join(installDir, 'backups')
      const before = preUpgrade(backupsDir).length

      const r = cli('update --no-migrate', 600_000) // default backup ON; already at head
      if (r.exitCode !== 0) console.error('update:', r.stdout, r.stderr)
      expect(r.exitCode).toBe(0)

      expect(preUpgrade(backupsDir).length).toBeGreaterThan(before)
      expect(getContainerImage(appContainer())).toContain(NEW_VERSION)
      expect(await waitForUrl(`http://localhost:${INTEG_PORT}/api/v1/health`, 120_000)).toBe(true)
    }, 600_000)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Section 3 — Commands run without an installation must fail clearly
// ─────────────────────────────────────────────────────────────────────────────

describe('CLI integration — no installation (error paths)', () => {
  let emptyHome: string
  const cli = (args: string) => cliWithHome(emptyHome, args, 15_000)

  beforeAll(() => { emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-empty-')) })
  afterAll(() => { try { fs.rmSync(emptyHome, { recursive: true, force: true }) } catch { /* ignore */ } })

  it.each(['config', 'status', 'health', 'backup', 'scale', 'shell'])(
    '%s fails with a "no installation / run setup" message', (cmd) => {
      const r = cli(cmd)
      expect(r.exitCode).not.toBe(0)
      expect(r.stdout + r.stderr).toMatch(/no learnhouse installation|setup/i)
    })

  it('restore exits non-zero on a nonexistent archive', () => {
    expect(cli('restore /tmp/does-not-exist-123.tar.gz').exitCode).not.toBe(0)
  })

  it('doctor still runs its Docker checks without an installation', () => {
    expect(cli('doctor').stdout).toContain('Docker')
  })
})
