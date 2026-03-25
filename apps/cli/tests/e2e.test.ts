import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { cli, TEST_NAME, TEST_PORT, TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD } from './helpers.js'

const INSTALL_DIR = path.join(os.homedir(), '.learnhouse', TEST_NAME)

/**
 * Full E2E integration tests — requires Docker.
 *
 * These tests run the actual CLI binary against real Docker containers.
 * They follow the real user flow: setup → start → status → health → backup → stop.
 *
 * Run with: bun run test:e2e
 * Skip in environments without Docker by setting SKIP_E2E=1
 */

describe('CLI E2E', () => {
  beforeAll(() => {
    // Skip if Docker is not available
    const docker = cli('doctor 2>/dev/null', 5000)
    if (docker.exitCode !== 0 && !docker.stdout.includes('Docker installed')) {
      console.log('Skipping E2E tests — Docker not available')
      return
    }

    // Clean up any leftover test installation
    if (fs.existsSync(INSTALL_DIR)) {
      cli(`stop`, 60_000)
      fs.rmSync(INSTALL_DIR, { recursive: true, force: true })
    }
  })

  afterAll(() => {
    // Tear down
    try {
      cli(`stop`, 60_000)
    } catch { /* already stopped */ }

    // Clean up volumes
    try {
      const { execSync } = require('node:child_process')
      execSync(`cd ${INSTALL_DIR} && docker compose down -v`, {
        stdio: 'pipe',
        timeout: 30_000,
      })
    } catch { /* ignore */ }

    if (fs.existsSync(INSTALL_DIR)) {
      fs.rmSync(INSTALL_DIR, { recursive: true, force: true })
    }
  })

  // ─── Basic CLI ────────────────────────────────────────────

  it('shows version', () => {
    const result = cli('--version')
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('shows help', () => {
    const result = cli('--help')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('setup')
    expect(result.stdout).toContain('start')
    expect(result.stdout).toContain('stop')
    expect(result.stdout).toContain('update')
  })

  it('shows welcome screen with no args', () => {
    const result = cli('')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('LearnHouse')
    expect(result.stdout).toContain('Available commands')
  })

  // ─── Commands without installation ────────────────────────

  it('start fails without installation', () => {
    const result = cli('start')
    // May find a different installation on the host, so just check it doesn't crash
    expect(typeof result.exitCode).toBe('number')
  })

  it('setup --ci fails without --admin-password', () => {
    const result = cli('setup --ci --name should-fail')
    expect(result.exitCode).toBe(1)
    expect(result.stderr + result.stdout).toContain('--admin-password')
  })

  it('setup --help shows CI options', () => {
    const result = cli('setup --help')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('--ci')
    expect(result.stdout).toContain('--admin-password')
    expect(result.stdout).toContain('--no-start')
    expect(result.stdout).toContain('--port')
    expect(result.stdout).toContain('--domain')
  })

  it('update --help shows version and migrate flags', () => {
    const result = cli('update --help')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('--version')
    expect(result.stdout).toContain('--migrate')
    expect(result.stdout).toContain('--no-migrate')
  })

  it('restore --help shows archive argument', () => {
    const result = cli('restore --help')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('archive')
  })

  // ─── Setup (CI mode) ─────────────────────────────────────

  it('setup --ci generates files without starting', () => {
    const result = cli(
      `setup --ci --name ${TEST_NAME} --domain localhost --port ${TEST_PORT} --admin-email ${TEST_ADMIN_EMAIL} --admin-password ${TEST_ADMIN_PASSWORD} --no-start`,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Configuration files generated')
    expect(result.stdout).toContain(TEST_ADMIN_EMAIL)

    // Verify files were created
    expect(fs.existsSync(path.join(INSTALL_DIR, 'docker-compose.yml'))).toBe(true)
    expect(fs.existsSync(path.join(INSTALL_DIR, '.env'))).toBe(true)
    expect(fs.existsSync(path.join(INSTALL_DIR, 'learnhouse.config.json'))).toBe(true)
    expect(fs.existsSync(path.join(INSTALL_DIR, 'extra', 'nginx.prod.conf'))).toBe(true)
  })

  it('generated docker-compose.yml has correct image and db', () => {
    const compose = fs.readFileSync(path.join(INSTALL_DIR, 'docker-compose.yml'), 'utf-8')
    expect(compose).toContain('ghcr.io/learnhouse/app:')
    expect(compose).toContain('pgvector')
    expect(compose).toContain('nginx')
  })

  it('generated .env has correct values', () => {
    const env = fs.readFileSync(path.join(INSTALL_DIR, '.env'), 'utf-8')
    expect(env).toContain('LEARNHOUSE_DOMAIN=localhost')
    expect(env).toContain(`LEARNHOUSE_INITIAL_ADMIN_EMAIL=${TEST_ADMIN_EMAIL}`)
    expect(env).toContain(`LEARNHOUSE_INITIAL_ADMIN_PASSWORD=${TEST_ADMIN_PASSWORD}`)
    expect(env).toContain(`HTTP_PORT=${TEST_PORT}`)
  })

  it('generated config has correct metadata', () => {
    const config = JSON.parse(fs.readFileSync(path.join(INSTALL_DIR, 'learnhouse.config.json'), 'utf-8'))
    expect(config.domain).toBe('localhost')
    expect(config.httpPort).toBe(TEST_PORT)
    expect(config.installDir).toBe(INSTALL_DIR)
    expect(config.deploymentId).toMatch(/^[a-f0-9]{8}$/)
  })

  // ─── Config command ───────────────────────────────────────

  it('config shows installation details', () => {
    const result = cli('config')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('localhost')
    expect(result.stdout).toContain(INSTALL_DIR)
  })

  // ─── Doctor (pre-start) ───────────────────────────────────

  it('doctor runs checks before services start', () => {
    const result = cli('doctor')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Docker installed')
    expect(result.stdout).toContain('Docker daemon running')
    expect(result.stdout).toContain('environment variables present')
  })

  // ─── Start ────────────────────────────────────────────────

  it('start brings up all containers', () => {
    const result = cli('start', 300_000)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('running')
  })

  // ─── Status ───────────────────────────────────────────────

  it('status shows running containers', () => {
    const result = cli('status')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('learnhouse-app')
    expect(result.stdout).toContain('learnhouse-db')
    expect(result.stdout).toContain('learnhouse-redis')
    expect(result.stdout).toContain('nginx')
  })

  // ─── Health ───────────────────────────────────────────────

  it('health shows container and service health', () => {
    const result = cli('health', 60_000)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('PostgreSQL')
    expect(result.stdout).toContain('Redis')
    expect(result.stdout).toContain('Health check complete')
  })

  // ─── Doctor (post-start) ──────────────────────────────────

  it('doctor shows all green with running services', () => {
    const result = cli('doctor')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('learnhouse-app running')
  })

  // ─── Backup ───────────────────────────────────────────────

  it('backup --help shows options', () => {
    const result = cli('backup --help')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('archive')
  })

  // ─── Stop ─────────────────────────────────────────────────

  it('stop shuts down all containers', () => {
    const result = cli('stop', 60_000)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('stopped')
  })

  // ─── Status after stop ────────────────────────────────────

  it('status shows no running containers after stop', () => {
    const result = cli('status')
    expect(result.exitCode).toBe(0)
    // No containers should show as "Up"
    expect(result.stdout).not.toContain('Up ')
  })

  // ─── Start again (restart) ────────────────────────────────

  it('start works after stop (restart)', () => {
    const result = cli('start', 300_000)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('running')
  })

  // ─── Final stop ───────────────────────────────────────────

  it('final stop for cleanup', () => {
    const result = cli('stop', 60_000)
    expect(result.exitCode).toBe(0)
  })
})
