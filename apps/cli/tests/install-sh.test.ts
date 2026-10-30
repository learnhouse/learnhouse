import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { isWindows } from './platform.js'

// install.sh against simulated hosts. The script is sourced with
// LEARNHOUSE_INSTALL_SOURCE_ONLY=1 and its functions are called with a PATH
// that holds ONLY stub commands plus a few basic utilities, so the host's own
// package manager, docker or node can never be detected or run. Each stub logs
// its argv; tests assert on what the installer would have done per distro.

const SCRIPT = path.resolve(__dirname, '..', 'install.sh')

const BASE_UTILS = [
  'sed', 'awk', 'grep', 'cut', 'head', 'tail', 'tr', 'sort', 'mktemp', 'cat',
  'rm', 'mkdir', 'chmod', 'dirname', 'basename', 'env', 'sh', 'wc', 'sleep',
  // real checksum tools (Linux: sha256sum, macOS: shasum) so verification is genuine
  'sha256sum', 'shasum',
]

function which(cmd: string): string | null {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    const full = path.join(dir, cmd)
    try {
      fs.accessSync(full, fs.constants.X_OK)
      return full
    } catch { /* keep looking */ }
  }
  return null
}

const BASH = isWindows ? null : which('bash')

interface Host {
  /** `uname -s` / `uname -m` */
  os?: string
  arch?: string
  /** stub name → sh script body (runs after argv is logged) */
  tools: Record<string, string>
  /** user id; 0 = root */
  uid?: number
}

let tmp: string
let bin: string
let log: string

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-install-sh-'))
  bin = path.join(tmp, 'bin')
  log = path.join(tmp, 'calls.log')
  fs.mkdirSync(bin)
  fs.writeFileSync(log, '')
})
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

function stub(name: string, body: string): void {
  const file = path.join(bin, name)
  fs.writeFileSync(file, `#!/bin/sh\necho "${name} $*" >> "${log}"\n${body}\n`)
  fs.chmodSync(file, 0o755)
}

/** Source install.sh on a simulated host and run `snippet`. */
function run(host: Host, snippet: string) {
  for (const util of BASE_UTILS) {
    const real = which(util)
    if (real && !fs.existsSync(path.join(bin, util))) fs.symlinkSync(real, path.join(bin, util))
  }
  stub('uname', `case "$1" in -s) echo "${host.os ?? 'Linux'}" ;; -m) echo "${host.arch ?? 'x86_64'}" ;; esac`)
  stub('id', `case "$1" in -u) echo ${host.uid ?? 1000} ;; -un) echo tester ;; esac`)
  stub('sudo', '"$@"')
  for (const [name, body] of Object.entries(host.tools)) stub(name, body)

  const res = spawnSync(BASH!, ['-c', `source "${SCRIPT}"; ${snippet}`], {
    env: { PATH: bin, HOME: tmp, LEARNHOUSE_INSTALL_SOURCE_ONLY: '1', TERM: 'dumb' },
    encoding: 'utf-8',
    input: '',
    timeout: 30_000,
  })
  return {
    status: res.status,
    out: (res.stdout ?? '') + (res.stderr ?? ''),
    calls: fs.readFileSync(log, 'utf-8').split('\n').filter(Boolean),
  }
}

// A docker that is installed, running and has compose v2.
const DOCKER_OK = 'case "$1" in --version) echo "Docker version 27.0.0" ;; esac; exit 0'

describe.skipIf(!BASH)('install.sh on simulated hosts', () => {
  describe('platform detection', () => {
    it.each([
      ['apt-get', 'apt'],
      ['dnf', 'dnf'],
      ['yum', 'yum'],
      ['pacman', 'pacman'],
      ['zypper', 'zypper'],
      ['apk', 'apk'],
    ])('Linux with %s → PKG=%s', (tool, pkg) => {
      const r = run({ tools: { [tool]: 'exit 0' } }, 'detect_platform; echo "PKG=$PKG PLATFORM=$PLATFORM"')
      expect(r.out).toContain(`PKG=${pkg} PLATFORM=linux`)
    })

    it('macOS', () => {
      const r = run({ os: 'Darwin', arch: 'arm64', tools: {} }, 'detect_platform; echo "PLATFORM=$PLATFORM ARCH=$ARCH"')
      expect(r.out).toContain('PLATFORM=macos ARCH=arm64')
    })

    it('refuses other systems and points Windows users to install.ps1', () => {
      const r = run({ os: 'FreeBSD', tools: {} }, 'detect_platform')
      expect(r.status).toBe(1)
      expect(r.out).toContain('Unsupported OS: FreeBSD')
      expect(r.out).toContain('install.ps1')
    })
  })

  describe('Docker', () => {
    it('Debian/Ubuntu without Docker: get.docker.com, systemd, docker group with a warning', () => {
      const r = run({
        tools: {
          'apt-get': 'exit 0',
          curl: 'echo "true"', // the "install script" piped into sh
          systemctl: 'exit 0',
          usermod: 'exit 0',
        },
      }, 'detect_platform; ensure_docker')
      expect(r.status).toBe(0)
      expect(r.calls).toContain('curl -fsSL https://get.docker.com')
      expect(r.calls).toContain('systemctl enable docker')
      expect(r.calls).toContain('usermod -aG docker tester')
      expect(r.out).toContain('equivalent to root')
    })

    it('a host without systemd (WSL2, containers) warns instead of aborting', () => {
      const r = run({
        tools: { 'apt-get': 'exit 0', curl: 'echo true', systemctl: 'exit 1', usermod: 'exit 0' },
      }, 'detect_platform; ensure_docker; echo REACHED_END')
      expect(r.status).toBe(0)
      expect(r.out).toContain('Could not start Docker with systemctl')
      expect(r.out).toContain('REACHED_END')
    })

    it('Alpine: apk + OpenRC, addgroup when usermod is missing, no get.docker.com', () => {
      const r = run({
        tools: { apk: 'exit 0', 'rc-service': 'exit 0', 'rc-update': 'exit 0', addgroup: 'exit 0' },
      }, 'detect_platform; ensure_docker')
      expect(r.status).toBe(0)
      expect(r.calls).toContain('apk add --no-cache docker docker-cli-compose')
      expect(r.calls).toContain('rc-service docker start')
      expect(r.calls).toContain('addgroup tester docker')
      expect(r.calls.some((c) => c.startsWith('curl'))).toBe(false)
    })

    it('root is not added to the docker group', () => {
      const r = run({
        uid: 0,
        tools: { 'apt-get': 'exit 0', curl: 'echo true', systemctl: 'exit 0', usermod: 'exit 0' },
      }, 'detect_platform; ensure_docker')
      expect(r.calls.some((c) => c.startsWith('usermod'))).toBe(false)
      expect(r.calls.some((c) => c.startsWith('sudo'))).toBe(false) // root never goes through sudo
    })

    it('macOS without Docker installs Docker Desktop and stops with next steps', () => {
      const r = run({ os: 'Darwin', tools: { brew: 'exit 0' } }, 'detect_platform; ensure_docker; echo NOT_REACHED')
      expect(r.status).toBe(0)
      expect(r.calls).toContain('brew install --cask docker')
      expect(r.out).toContain('Re-run this installer')
      expect(r.out).not.toContain('NOT_REACHED')
    })

    it('macOS never asks for sudo when the daemon is stopped', () => {
      const r = run({
        os: 'Darwin',
        tools: { docker: 'case "$1" in --version) echo "Docker version 27" ;; info) exit 1 ;; esac' },
      }, 'detect_platform; ensure_docker')
      expect(r.out).toContain('daemon is not running')
      expect(r.calls.some((c) => c.startsWith('sudo'))).toBe(false)
    })
  })

  describe('Docker Compose', () => {
    it('apt: a missing docker-compose-plugin package falls back to docker-compose-v2 and never aborts', () => {
      const r = run({
        tools: {
          docker: 'exit 1', // no compose
          'apt-get': 'case "$*" in *docker-compose-plugin*) exit 100 ;; esac; exit 0',
        },
      }, 'detect_platform; ensure_compose; echo REACHED_END')
      expect(r.status).toBe(0)
      expect(r.calls).toContain('apt-get install -y -qq docker-compose-v2')
      expect(r.out).toContain('could not be installed')
      expect(r.out).toContain('REACHED_END')
    })

    it('already available: installs nothing', () => {
      const r = run({ tools: { 'apt-get': 'exit 0', docker: DOCKER_OK } }, 'detect_platform; ensure_compose')
      expect(r.out).toContain('Docker Compose v2 available')
      expect(r.calls.some((c) => c.startsWith('apt-get'))).toBe(false)
    })
  })

  describe('Node.js', () => {
    // node reports whatever version is in $STATE/node-version; `tar` (the
    // binary install) and package installs "upgrade" it.
    const nodeStub = (dir: string) => `v=$(cat "${dir}/node-version" 2>/dev/null) || exit 127; [ -n "$v" ] || exit 127; echo "$v"`

    it('accepts an installed Node >= 22', () => {
      fs.writeFileSync(path.join(tmp, 'node-version'), 'v22.11.0')
      const r = run({ tools: { 'apt-get': 'exit 0', node: nodeStub(tmp) } }, 'detect_platform; ensure_node')
      expect(r.status).toBe(0)
      expect(r.out).toContain('Node.js already installed: v22.11.0')
    })

    it('apt with a new-enough candidate installs the distro package', () => {
      fs.writeFileSync(path.join(tmp, 'node-version'), 'v20.0.0')
      const r = run({
        tools: {
          'apt-get': `case "$*" in *"install -y -qq nodejs"*) echo v22.12.0 > "${tmp}/node-version" ;; esac; exit 0`,
          'apt-cache': 'echo "nodejs:"; echo "  Installed: 20.0.0"; echo "  Candidate: 22.12.0+dfsg-1"',
          node: nodeStub(tmp),
          npx: 'exit 0',
        },
      }, 'detect_platform; ensure_node')
      expect(r.status).toBe(0)
      expect(r.calls).toContain('apt-get install -y -qq nodejs')
      expect(r.calls.some((c) => c.startsWith('curl'))).toBe(false)
    })

    describe('official binary (distro package too old)', () => {
      const tarball = 'node-v24.22.2-linux-x64.tar.gz'
      const payload = 'fake node tarball'
      const goodSha = crypto.createHash('sha256').update(payload).digest('hex')

      function binaryHost(sha: string): Host {
        fs.writeFileSync(path.join(tmp, 'node-version'), 'v18.19.0')
        return {
          tools: {
            'apt-get': 'exit 0',
            'apt-cache': 'echo "  Candidate: 18.19.1-1"',
            node: nodeStub(tmp),
            // curl -fsSL <url> -o <file>: SHASUMS256.txt, then the tarball
            curl: `out=""; while [ $# -gt 0 ]; do [ "$1" = "-o" ] && out="$2"; shift; done
              case "$out" in
                *SHASUMS256.txt) printf '%s  %s\\n%s  %s\\n' "${sha}" "${tarball}" 0000 node-v24.22.2-darwin-arm64.tar.gz > "$out" ;;
                *) printf '%s' "${payload}" > "$out" ;;
              esac`,
            tar: `echo v24.22.2 > "${tmp}/node-version"`,
          },
        }
      }

      it('downloads, verifies against SHASUMS256.txt and unpacks into /usr/local', () => {
        const r = run(binaryHost(goodSha), 'detect_platform; ensure_node')
        expect(r.status).toBe(0)
        expect(r.calls).toContain('curl -fsSL https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt -o ' +
          r.calls.find((c) => c.includes('SHASUMS256.txt -o'))!.split(' -o ')[1])
        expect(r.out).toContain('Checksum verified')
        // no xz on this host → .tar.gz with -z
        expect(r.calls.some((c) => c.startsWith(`tar -xzf`) && c.includes(tarball) && c.includes('-C /usr/local'))).toBe(true)
        // The installer puts /usr/local/bin first on PATH (where it unpacked
        // Node); a host that already has a node there reports that one.
        expect(r.out).toMatch(/Node\.js installed: v\d+/)
        if (!fs.existsSync('/usr/local/bin/node')) expect(r.out).toContain('Node.js installed: v24.22.2')
      })

      it('aborts on a checksum mismatch without unpacking anything', () => {
        const r = run(binaryHost('f'.repeat(64)), 'detect_platform; ensure_node')
        expect(r.status).toBe(1)
        expect(r.out).toContain('Checksum mismatch')
        expect(r.calls.some((c) => c.startsWith('tar'))).toBe(false)
      })
    })

    it('Alpine below Node 22 fails with an upgrade hint (no glibc binary fallback)', () => {
      fs.writeFileSync(path.join(tmp, 'node-version'), '')
      const r = run({
        tools: { apk: `echo v20.15.1 > "${tmp}/node-version"`, node: nodeStub(tmp) },
      }, 'detect_platform; ensure_node')
      expect(r.status).toBe(1)
      expect(r.out).toContain('Upgrade to Alpine 3.21')
      expect(r.calls.some((c) => c.startsWith('curl'))).toBe(false)
    })

    it('macOS installs node@24 with Homebrew and links it', () => {
      fs.writeFileSync(path.join(tmp, 'node-version'), '')
      const r = run({
        os: 'Darwin',
        tools: {
          brew: `case "$1" in install) echo v24.1.0 > "${tmp}/node-version" ;; --prefix) echo "${tmp}/brew/node@24" ;; esac`,
          node: nodeStub(tmp),
        },
      }, 'detect_platform; ensure_node')
      expect(r.status).toBe(0)
      expect(r.calls).toContain('brew install node@24')
      expect(r.calls).toContain('brew link --overwrite --force node@24')
    })
  })

  it('a download cut short by `curl | bash` runs nothing', () => {
    const full = fs.readFileSync(SCRIPT, 'utf-8')
    // Truncate inside main(), as an interrupted download would
    const cut = full.slice(0, full.indexOf('  ensure_docker\n', full.indexOf('main() {')))
    const truncated = path.join(tmp, 'truncated.sh')
    fs.writeFileSync(truncated, cut)
    stub('uname', 'echo Linux')
    stub('curl', 'exit 0')
    stub('apt-get', 'exit 0')
    for (const util of BASE_UTILS) {
      const real = which(util)
      if (real && !fs.existsSync(path.join(bin, util))) fs.symlinkSync(real, path.join(bin, util))
    }
    const res = spawnSync(BASH!, [truncated], { env: { PATH: bin, HOME: tmp }, encoding: 'utf-8', input: '' })
    expect(res.status).not.toBe(0) // syntax error: main() never closed
    expect(fs.readFileSync(log, 'utf-8')).toBe('') // no command ran
  })
})
