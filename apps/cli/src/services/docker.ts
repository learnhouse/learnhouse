import { execSync, spawn } from 'node:child_process'

export function isDockerInstalled(): boolean {
  try {
    execSync('docker --version', { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

export function isDockerComposeV2(): boolean {
  try {
    const output = execSync('docker compose version', { stdio: 'pipe' }).toString()
    return output.includes('v2')
  } catch {
    return false
  }
}

export function isDockerRunning(): boolean {
  try {
    execSync('docker info', { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

export function dockerComposeUp(cwd: string): void {
  execSync('docker compose up -d --pull always', {
    cwd,
    stdio: 'inherit',
  })
}

export function dockerComposeDown(cwd: string): void {
  execSync('docker compose down', {
    cwd,
    stdio: 'inherit',
  })
}

export function dockerComposePs(cwd: string): string {
  return execSync('docker compose ps', {
    cwd,
    stdio: 'pipe',
  }).toString()
}

export function dockerComposePull(cwd: string): void {
  execSync('docker compose pull', {
    cwd,
    stdio: 'inherit',
  })
}

export function dockerComposeLogs(cwd: string): void {
  const child = spawn('docker', ['compose', 'logs', '-f'], {
    cwd,
    stdio: 'inherit',
  })
  process.on('SIGINT', () => {
    child.kill('SIGINT')
  })
  child.on('exit', () => process.exit(0))
}
