import { execFileSync, spawn, spawnSync, type ChildProcess, type ExecFileSyncOptions, type SpawnOptions, type SpawnSyncOptions, type SpawnSyncReturns } from 'node:child_process'
import path from 'node:path'

/**
 * The docker executable and any leading arguments, as [file, ...args].
 *
 * Defaults to `docker` on PATH. LEARNHOUSE_DOCKER_BIN overrides it (e.g. a
 * docker-compatible CLI like `podman`, or an absolute path). A `.js`/`.mjs`
 * value runs with the current Node, which lets the test suite substitute a
 * fake docker that behaves the same on Linux, macOS and Windows (where a
 * script can't be exec'd directly).
 */
export function dockerInvocation(args: string[]): [string, string[]] {
  const bin = process.env.LEARNHOUSE_DOCKER_BIN
  if (!bin) return ['docker', args]
  if (/\.(c|m)?js$/.test(bin)) return [process.execPath, [path.resolve(bin), ...args]]
  return [bin, args]
}

// Drop-in replacements for the child_process calls, with `docker` resolved
// through dockerInvocation. Same options and return values.

export function dockerExecFileSync(args: string[], opts?: ExecFileSyncOptions): Buffer | string {
  const [file, argv] = dockerInvocation(args)
  return execFileSync(file, argv, opts)
}

export function dockerSpawnSync(args: string[], opts?: SpawnSyncOptions): SpawnSyncReturns<Buffer> {
  const [file, argv] = dockerInvocation(args)
  return spawnSync(file, argv, opts ?? {}) as SpawnSyncReturns<Buffer>
}

export function dockerSpawn(args: string[], opts: SpawnOptions): ChildProcess {
  const [file, argv] = dockerInvocation(args)
  return spawn(file, argv, opts)
}
