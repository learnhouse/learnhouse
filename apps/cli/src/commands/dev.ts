import { spawn, execSync, type ChildProcess } from 'node:child_process'
import * as crypto from 'node:crypto'
import * as p from '@clack/prompts'
import pc from 'picocolors'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { isDockerInstalled, isDockerRunning } from '../services/docker.js'

const SESSION_ID = crypto.randomBytes(4).toString('hex')

function findProjectRoot(): string | null {
  let dir = process.cwd()
  while (true) {
    if (
      fs.existsSync(path.join(dir, 'dev', 'docker-compose.yml')) &&
      fs.existsSync(path.join(dir, 'apps', 'api')) &&
      fs.existsSync(path.join(dir, 'apps', 'web'))
    ) {
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForHealth(label: string, command: string, args: string[], maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      execSync([command, ...args].join(' '), { stdio: 'pipe', timeout: 5000 })
      return true
    } catch {
      await sleep(1000)
    }
  }
  return false
}

const CONTROLS_BAR = pc.dim('─'.repeat(60)) + '\n' +
  pc.dim('  ') + pc.bold('ra') + pc.dim(' restart api  ') +
  pc.bold('rw') + pc.dim(' restart web  ') +
  pc.bold('rb') + pc.dim(' restart both  ') +
  pc.bold('q') + pc.dim(' quit') + '\n' +
  pc.dim('─'.repeat(60))

let lineCount = 0
const CONTROLS_INTERVAL = 50

function printControls() {
  process.stdout.write('\n' + CONTROLS_BAR + '\n\n')
  lineCount = 0
}

function prefixStream(proc: ChildProcess, label: string, color: (s: string) => string) {
  const prefix = color(`[${label}]`)
  const handleData = (data: Buffer) => {
    const lines = data.toString().split('\n')
    for (const line of lines) {
      if (line.length > 0) {
        process.stdout.write(`${prefix} ${line}\n`)
        lineCount++
        if (lineCount >= CONTROLS_INTERVAL) {
          printControls()
        }
      }
    }
  }
  proc.stdout?.on('data', handleData)
  proc.stderr?.on('data', handleData)
}

let serviceEnv: Record<string, string> = {}

function spawnService(command: string, args: string[], cwd: string, label: string, color: (s: string) => string): ChildProcess {
  const child = spawn(command, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...serviceEnv },
  })
  prefixStream(child, label, color)
  child.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.log(color(`[${label}]`) + ` exited with code ${code}`)
    }
  })
  return child
}

function killProcess(child: ChildProcess | null): Promise<void> {
  return new Promise((resolve) => {
    if (!child || child.killed || child.exitCode !== null) {
      resolve()
      return
    }
    child.on('exit', () => resolve())
    child.kill('SIGTERM')
    setTimeout(() => {
      if (!child.killed && child.exitCode === null) {
        child.kill('SIGKILL')
      }
    }, 5000)
  })
}

export async function devCommand() {
  const root = findProjectRoot()
  if (!root) {
    p.log.error('Not inside a LearnHouse project.')
    p.log.info('Run this command from within the learnhouse monorepo (must contain dev/docker-compose.yml, apps/api/, and apps/web/).')
    process.exit(1)
  }

  if (!isDockerInstalled()) {
    p.log.error('Docker is not installed. Please install Docker and try again.')
    process.exit(1)
  }

  if (!isDockerRunning()) {
    p.log.error('Docker is not running. Please start Docker and try again.')
    process.exit(1)
  }

  const projectName = `learnhouse-dev-${SESSION_ID}`

  p.intro(pc.cyan('LearnHouse Dev Mode'))
  console.log(pc.dim(`  Session: ${pc.bold(SESSION_ID)}`))
  console.log()

  // Admin credentials
  const email = await p.text({
    message: 'Admin email',
    placeholder: 'admin@school.dev',
    defaultValue: 'admin@school.dev',
  })
  if (p.isCancel(email)) process.exit(0)

  const password = await p.password({
    message: 'Admin password',
  })
  if (p.isCancel(password)) process.exit(0)

  if (!password) {
    p.log.error('Password is required.')
    process.exit(1)
  }

  serviceEnv = {
    FORCE_COLOR: '1',
    LEARNHOUSE_OSS: 'true',
    NEXT_PUBLIC_LEARNHOUSE_OSS: 'true',
    LEARNHOUSE_INITIAL_ADMIN_EMAIL: email,
    LEARNHOUSE_INITIAL_ADMIN_PASSWORD: password,
  }

  // Start infrastructure
  const infraSpinner = p.spinner()
  infraSpinner.start('Starting DB and Redis containers...')
  try {
    execSync(`docker compose -f dev/docker-compose.yml -p ${projectName} up -d`, {
      cwd: root,
      stdio: 'pipe',
    })
    infraSpinner.stop('Containers started')
  } catch (e: any) {
    infraSpinner.stop('Failed to start containers')
    p.log.error(e.stderr?.toString() || 'docker compose up failed')
    process.exit(1)
  }

  // Health checks
  const healthSpinner = p.spinner()
  healthSpinner.start('Waiting for DB and Redis to be healthy...')

  const [dbReady, redisReady] = await Promise.all([
    waitForHealth('DB', 'docker', ['exec', 'learnhouse-db-dev', 'pg_isready', '-U', 'learnhouse']),
    waitForHealth('Redis', 'docker', ['exec', 'learnhouse-redis-dev', 'redis-cli', 'ping']),
  ])

  if (!dbReady || !redisReady) {
    healthSpinner.stop('Health checks failed')
    if (!dbReady) p.log.error('Database did not become ready in time.')
    if (!redisReady) p.log.error('Redis did not become ready in time.')
    process.exit(1)
  }
  healthSpinner.stop('DB and Redis are healthy')

  // Start local services
  let apiProc: ChildProcess | null = null
  let webProc: ChildProcess | null = null

  const startApi = () => {
    return spawnService('uv', ['run', 'python', 'app.py'], path.join(root, 'apps', 'api'), 'api', pc.magenta)
  }

  const startWeb = () => {
    return spawnService('pnpm', ['dev'], path.join(root, 'apps', 'web'), 'web', pc.cyan)
  }

  apiProc = startApi()
  webProc = startWeb()

  p.log.success('API and Web servers started')
  console.log()
  console.log(pc.dim('  Thank you for contributing to LearnHouse!'))
  console.log()

  printControls()

  // Graceful shutdown
  let shuttingDown = false
  const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true
    console.log('\n' + pc.dim('Shutting down...'))

    if (process.stdin.isTTY && process.stdin.isRaw) {
      process.stdin.setRawMode(false)
    }
    process.stdin.pause()

    await Promise.all([killProcess(apiProc), killProcess(webProc)])

    try {
      execSync(`docker compose -f dev/docker-compose.yml -p ${projectName} down`, {
        cwd: root,
        stdio: 'pipe',
      })
      console.log(pc.dim('Containers stopped.'))
    } catch {
      // Best effort
    }
    console.log(pc.dim('Thanks for building with LearnHouse!'))
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  // Interactive key handling
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf8')

    let pendingR = false

    process.stdin.on('data', async (key: string) => {
      if (key === '\x03') {
        await shutdown()
        return
      }

      if (key === 'q') {
        await shutdown()
        return
      }

      if (key === 'r') {
        pendingR = true
        setTimeout(() => { pendingR = false }, 1000)
        return
      }

      if (pendingR) {
        pendingR = false

        if (key === 'a') {
          console.log(pc.magenta('\n  Restarting API...\n'))
          await killProcess(apiProc)
          apiProc = startApi()
          printControls()
        } else if (key === 'w') {
          console.log(pc.cyan('\n  Restarting Web...\n'))
          await killProcess(webProc)
          webProc = startWeb()
          printControls()
        } else if (key === 'b') {
          console.log(pc.yellow('\n  Restarting both...\n'))
          await Promise.all([killProcess(apiProc), killProcess(webProc)])
          apiProc = startApi()
          webProc = startWeb()
          printControls()
        }
      }
    })
  }

  // Keep process alive
  await new Promise(() => {})
}
