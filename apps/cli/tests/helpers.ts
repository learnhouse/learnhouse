import { execSync } from 'node:child_process'
import path from 'node:path'

const CLI_PATH = path.resolve(__dirname, '..', 'dist', 'bin', 'learnhouse.js')

export interface CliResult {
  stdout: string
  stderr: string
  exitCode: number
}

export function cli(args: string, timeoutMs = 120_000): CliResult {
  try {
    const stdout = execSync(`node ${CLI_PATH} ${args}`, {
      encoding: 'utf-8',
      timeout: timeoutMs,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return { stdout, stderr: '', exitCode: 0 }
  } catch (err: any) {
    return {
      stdout: err.stdout?.toString() || '',
      stderr: err.stderr?.toString() || '',
      exitCode: err.status ?? 1,
    }
  }
}

export const TEST_NAME = 'cli-test'
export const TEST_PORT = 9099
export const TEST_ADMIN_EMAIL = 'admin@test.dev'
export const TEST_ADMIN_PASSWORD = 'testpassword123456'
