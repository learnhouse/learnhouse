import fs from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'

// Helpers that keep assertions meaningful on every OS the CLI supports.

export const isWindows = process.platform === 'win32'

/** `it` on POSIX, skipped on Windows (signals, permission bits, sh scripts). */
export const itPosix = isWindows ? it.skip : it

/** `it` only on Windows. */
export const itWindows = isWindows ? it : it.skip

/**
 * Assert POSIX permission bits. Windows has no owner/group/other bits (Node
 * reports 0o666 / 0o444), and the CLI's chmod calls are no-ops there, so the
 * check only applies on POSIX.
 */
export function expectMode(file: string, mode: number): void {
  if (isWindows) return
  expect(fs.statSync(file).mode & 0o777).toBe(mode)
}

/** Absolute path to the fake docker used by subprocess tests. */
export const FAKE_DOCKER = path.resolve(__dirname, 'fixtures', 'fake-docker.mjs')
