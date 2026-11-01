#!/usr/bin/env node
// A stand-in `docker` for tests that run the built CLI as a subprocess
// (selected with LEARNHOUSE_DOCKER_BIN). It answers the read-only probes the
// CLI makes before doing anything (version, info, compose version, empty
// listings) and fails everything else, so no test can start, stop or remove a
// real container. Same behavior on Linux, macOS and Windows.
//
// FAKE_DOCKER_LOG=<file> appends each invocation (one JSON array per line).
// FAKE_DOCKER_DOWN=1 makes `docker info` fail (daemon not running).
import fs from 'node:fs'

const args = process.argv.slice(2)
if (process.env.FAKE_DOCKER_LOG) fs.appendFileSync(process.env.FAKE_DOCKER_LOG, JSON.stringify(args) + '\n')

const is = (...prefix) => prefix.every((p, i) => args[i] === p)

if (is('--version')) {
  process.stdout.write('Docker version 27.0.0, build fake\n')
} else if (is('info')) {
  if (process.env.FAKE_DOCKER_DOWN) {
    process.stderr.write('Cannot connect to the Docker daemon\n')
    process.exit(1)
  }
  process.stdout.write('Server Version: 27.0.0\n')
} else if (is('compose', 'version')) {
  process.stdout.write('Docker Compose version v2.29.0\n')
} else if (is('compose', 'ps') && process.env.FAKE_DOCKER_PS_ID) {
  // FAKE_DOCKER_PS_ID: container id reported for every `compose ps -q <svc>`
  process.stdout.write(process.env.FAKE_DOCKER_PS_ID + '\n')
} else if (is('ps') || is('compose', 'ps')) {
  // nothing running
} else if ((is('compose', 'stop') || is('compose', 'up')) && process.env.FAKE_DOCKER_EXEC) {
  // lifecycle calls made around a restore; only logged
} else if (is('exec') && process.env.FAKE_DOCKER_EXEC) {
  // Opt-in `docker exec` for stream-plumbing tests:
  //   FAKE_DOCKER_EXEC_STDOUT  text written to stdout
  //   FAKE_DOCKER_STDIN_TO     with -i, append "--- <argv>\n<stdin>\n" to this file
  //   FAKE_DOCKER_EXEC_STATUS  exit code (default 0)
  if (args[1] === '-i' && process.env.FAKE_DOCKER_STDIN_TO) {
    fs.appendFileSync(process.env.FAKE_DOCKER_STDIN_TO, `--- ${args.slice(2).join(' ')}\n${fs.readFileSync(0)}\n`)
  }
  if (process.env.FAKE_DOCKER_EXEC_STDOUT) process.stdout.write(process.env.FAKE_DOCKER_EXEC_STDOUT)
  const status = Number(process.env.FAKE_DOCKER_EXEC_STATUS || 0)
  if (status) process.stderr.write('fake exec failure\n')
  process.exit(status)
} else {
  process.stderr.write(`fake docker: refusing "${args.join(' ')}"\n`)
  process.exit(1)
}
