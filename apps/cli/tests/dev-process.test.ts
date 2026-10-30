import { describe, it, expect, vi, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'

// Real spawn (killProcess is exercised against real processes), but spawnSync
// is observable so the Windows taskkill branch can be asserted without running it.
const cp = vi.hoisted(() => ({ spawnSync: vi.fn() }))
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  cp.spawnSync.mockImplementation(actual.spawnSync)
  return { ...actual, spawnSync: cp.spawnSync }
})

import { spawn } from 'node:child_process'
import { killProcess, hasExited, createLineBuffer } from '../src/commands/dev.js'

const isWindows = process.platform === 'win32'

/** Spawn a node child running `script`; resolves once it prints "ready". */
function spawnNode(script: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'ignore'] })
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.stdout!.once('data', () => resolve(child))
  })
}

function exited(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (hasExited(child)) resolve()
    else child.once('exit', () => resolve())
  })
}

/** A child that never reports an exit, no matter which signal it gets. */
function stuckChild({ pid }: { pid?: number } = { pid: 999_999 }): ChildProcess {
  const child = new EventEmitter() as unknown as ChildProcess
  Object.assign(child, { pid, exitCode: null, signalCode: null, killed: false, kill: vi.fn(() => true) })
  return child
}

const children: ChildProcess[] = []
afterEach(() => {
  for (const c of children.splice(0)) if (!hasExited(c)) c.kill('SIGKILL')
  vi.restoreAllMocks()
})

describe.skipIf(isWindows)('killProcess', () => {
  it('resolves once a child that honours SIGTERM exits', async () => {
    const child = await spawnNode("console.log('ready'); setInterval(() => {}, 1000)")
    children.push(child)
    await killProcess(child, 5_000)
    expect(hasExited(child)).toBe(true)
    expect(child.signalCode).toBe('SIGTERM')
  })

  it('escalates to SIGKILL when the child ignores SIGTERM', async () => {
    // child.killed flips to true as soon as SIGTERM is sent; the fallback
    // must still fire because the process is alive.
    const child = await spawnNode(
      "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000)",
    )
    children.push(child)
    const started = Date.now()
    await killProcess(child, 200)
    expect(child.signalCode).toBe('SIGKILL')
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('resolves immediately for a child that already died from a signal', async () => {
    // exitCode stays null and killed stays false here; only signalCode shows the exit.
    const child = spawn(process.execPath, ['-e', "process.kill(process.pid, 'SIGKILL')"], { stdio: 'ignore' })
    children.push(child)
    await exited(child)
    expect(child.exitCode).toBeNull()
    expect(child.killed).toBe(false)
    const result = await Promise.race([
      killProcess(child, 60_000).then(() => 'resolved'),
      new Promise((r) => setTimeout(() => r('hung'), 1_000)),
    ])
    expect(result).toBe('resolved')
  })

  it('does not hang when the child never reports its exit', async () => {
    const child = stuckChild()
    const started = Date.now()
    await killProcess(child, 50, 50)
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    expect(Date.now() - started).toBeLessThan(2_000)
  })
})

describe('killProcess edge cases', () => {
  it('resolves immediately for null and never-spawned children', async () => {
    await killProcess(null)
    const child = spawn('lh-definitely-not-a-command', [], { stdio: 'ignore' })
    await new Promise((r) => child.once('error', r)) // ENOENT: no pid, exitCode set, no 'exit' event
    const kill = vi.spyOn(child, 'kill')
    const result = await Promise.race([
      killProcess(child, 60_000).then(() => 'resolved'),
      new Promise((r) => setTimeout(() => r('hung'), 1_000)),
    ])
    expect(result).toBe('resolved')
    expect(kill).not.toHaveBeenCalled()
  })

  it('kills the whole process tree with taskkill on Windows', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const child = stuckChild({ pid: 4242 })
    cp.spawnSync.mockImplementationOnce(() => {
      Object.assign(child, { exitCode: 1 })
      queueMicrotask(() => child.emit('exit', 1, null))
      return { status: 0 }
    })
    await killProcess(child, 60_000)
    expect(cp.spawnSync).toHaveBeenCalledWith('taskkill', ['/pid', '4242', '/T', '/F'], { stdio: 'ignore' })
    expect(child.kill).not.toHaveBeenCalled()
  })
})

describe('createLineBuffer', () => {
  function collect() {
    const lines: string[] = []
    return { lines, buffer: createLineBuffer((l) => lines.push(l)) }
  }

  it('joins a line split across chunks instead of emitting the pieces', () => {
    const { lines, buffer } = collect()
    buffer.push('hel')
    buffer.push('lo\nwor')
    expect(lines).toEqual(['hello'])
    buffer.push('ld\n')
    expect(lines).toEqual(['hello', 'world'])
  })

  it('emits every complete line in a chunk and skips blank lines', () => {
    const { lines, buffer } = collect()
    buffer.push(Buffer.from('a\n\nb\nc\n'))
    expect(lines).toEqual(['a', 'b', 'c'])
  })

  it('holds a trailing partial line until flush', () => {
    const { lines, buffer } = collect()
    buffer.push('done\nno newline')
    expect(lines).toEqual(['done'])
    buffer.flush()
    expect(lines).toEqual(['done', 'no newline'])
    buffer.flush() // nothing left: no empty line emitted
    expect(lines).toEqual(['done', 'no newline'])
  })

  it('decodes a UTF-8 character split across chunks', () => {
    const { lines, buffer } = collect()
    const euro = Buffer.from('a€\n') // € is 3 bytes
    buffer.push(euro.subarray(0, 2))
    buffer.push(euro.subarray(2))
    expect(lines).toEqual(['a€'])
  })
})
