import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// content-volume-migration shells out via execFileSync (docker inspect / cp /
// run / rm). Stub it so the "container exists → migrate" path runs in-process
// without a daemon (the copy is a no-op, so copiedBytes is 0).
vi.mock('node:child_process', () => ({ execFileSync: vi.fn(() => Buffer.from('')) }))

import { migrateContentVolume, patchComposeAddContentVolume } from '../src/services/content-volume-migration.js'
import { execFileSync } from 'node:child_process'

describe('migrateContentVolume — migrated path (container present)', () => {
  let dir: string
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-cvm2-')) })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks() })

  it('copies container content into the volume and patches the compose file', () => {
    fs.writeFileSync(path.join(dir, 'docker-compose.yml'), [
      'name: learnhouse-dep12345',
      'services:',
      '  learnhouse-app:',
      '    image: ghcr.io/learnhouse/app:latest',
      '    container_name: learnhouse-app-dep12345',
      '    networks:',
      '      - learnhouse-network-dep12345',
      'networks:',
      '  learnhouse-network-dep12345:',
      '',
    ].join('\n'))

    // execFileSync mocked (no throw) → dockerContainerExists() is true → migrate.
    const res = migrateContentVolume(dir, 'dep12345')
    expect(res.status).toBe('migrated')
    expect(res.copiedBytes).toBe(0) // the stubbed copy moves no bytes

    const patched = fs.readFileSync(path.join(dir, 'docker-compose.yml'), 'utf-8')
    expect(patched).toContain('learnhouse_content_dep12345:/app/api/content')
  })

  it('sums nested directory content when measuring the copied bytes', () => {
    fs.writeFileSync(path.join(dir, 'docker-compose.yml'), [
      'name: learnhouse-dep9', 'services:', '  learnhouse-app:',
      '    container_name: learnhouse-app-dep9', '    networks:',
      '      - learnhouse-network-dep9', 'networks:', '  learnhouse-network-dep9:', '',
    ].join('\n'))
    // Make the mocked `docker cp <container>:path/. <tmpDir>/` actually populate
    // the temp dir with a nested subdirectory + file, so directorySize recurses.
    ;(execFileSync as unknown as ReturnType<typeof vi.fn>).mockImplementation(((_cmd: string, argv: string[]) => {
      // Only the EXTRACT step (`docker cp <container>:path/. <tmpDir>/`) populates a
      // real local dir. Skip the UPLOAD step (`docker cp <tmpDir>/. <helper>:/dst/`)
      // whose destination is a container path — writing it would litter the cwd.
      if (Array.isArray(argv) && argv[0] === 'cp' && path.isAbsolute(argv[2].replace(/\/$/, ''))) {
        const dst = argv[2].replace(/\/$/, '') // tmpDir (absolute)
        fs.mkdirSync(path.join(dst, 'avatars'), { recursive: true })
        fs.writeFileSync(path.join(dst, 'avatars', 'a.png'), Buffer.alloc(2048))
        fs.writeFileSync(path.join(dst, 'top.txt'), Buffer.alloc(512))
      }
      return Buffer.from('')
    }) as never)
    const res = migrateContentVolume(dir, 'dep9')
    expect(res.status).toBe('migrated')
    expect(res.copiedBytes).toBe(2048 + 512) // nested file counted via recursion
  })
})

describe('patchComposeAddContentVolume — guard', () => {
  it('throws when the compose file has no learnhouse-app service', () => {
    expect(() => patchComposeAddContentVolume('services:\n  other:\n', 'dep1'))
      .toThrow(/learnhouse-app service not found/)
  })
})
