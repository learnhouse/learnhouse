/**
 * Playwright global teardown.
 *
 * Tears the self-host down deterministically via `docker compose down -v` on
 * the compose file the CLI generated under ~/.learnhouse/<name>/. We avoid
 * `learnhouse stop` here because it can prompt interactively when more than one
 * install exists on the machine; operating on the compose file directly is
 * non-interactive and only touches the instance we created.
 *
 * Skipped entirely when we reused an existing instance (E2E_SKIP_BOOT /
 * E2E_BASE_URL), or when E2E_KEEP=1 (handy for debugging a failed run).
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { INSTALL_NAME, SKIP_BOOT } from './core/instance'

export default async function globalTeardown(): Promise<void> {
  if (SKIP_BOOT) {
    console.log('Reused an existing instance — leaving it running.')
    return
  }
  if (process.env.E2E_KEEP === '1') {
    console.log(`E2E_KEEP=1 — leaving install "${INSTALL_NAME}" running for debugging.`)
    return
  }

  const composePath = join(homedir(), '.learnhouse', INSTALL_NAME, 'docker-compose.yml')
  if (!existsSync(composePath)) {
    console.warn(`No compose file at ${composePath}; nothing to tear down.`)
    return
  }

  console.log(`Tearing down self-host (${composePath})…`)
  const result = spawnSync('docker', ['compose', '-f', composePath, 'down', '-v'], {
    stdio: 'inherit',
    timeout: 120_000,
  })
  if (result.status !== 0) {
    console.warn(`docker compose down exited ${result.status} — manual cleanup may be needed.`)
  }
}
