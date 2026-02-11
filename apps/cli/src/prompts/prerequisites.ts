import * as p from '@clack/prompts'
import pc from 'picocolors'
import { isDockerInstalled, isDockerComposeV2, isDockerRunning } from '../services/docker.js'

export async function checkPrerequisites(): Promise<void> {
  const s = p.spinner()
  s.start('Checking prerequisites')

  const checks = [
    {
      name: 'Docker Engine',
      check: isDockerInstalled,
      failMsg: `Docker is not installed. Install it from ${pc.underline('https://docs.docker.com/get-docker/')}`,
    },
    {
      name: 'Docker Compose v2',
      check: isDockerComposeV2,
      failMsg: `Docker Compose v2 is required. Install it from ${pc.underline('https://docs.docker.com/compose/install/')}`,
    },
    {
      name: 'Docker daemon',
      check: isDockerRunning,
      failMsg: 'Docker daemon is not running. Please start Docker and try again.',
    },
  ]

  const failed: string[] = []
  for (const { name, check, failMsg } of checks) {
    if (!check()) {
      failed.push(`${pc.red('x')} ${name}: ${failMsg}`)
    }
  }

  if (failed.length > 0) {
    s.stop('Prerequisites check failed')
    p.log.error('Missing prerequisites:')
    for (const msg of failed) {
      p.log.message(msg)
    }
    p.cancel('Please install the missing prerequisites and try again.')
    process.exit(1)
  }

  s.stop('All prerequisites met')
}
