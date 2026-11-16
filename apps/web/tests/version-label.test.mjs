import { describe, expect, test } from 'bun:test'
import { describeVersion } from '../lib/version.ts'

describe('describeVersion', () => {
  test('release with a CI commit', () => {
    const v = describeVersion('1.4.3', '1ae8fbf2c4d5e6f708192a3b4c5d6e7f80912a3b')
    expect(v.label).toBe('v1.4.3 · 1ae8fbf')
    expect(v.buildFull).toBe('1ae8fbf2c4d5e6f708192a3b4c5d6e7f80912a3b')
    expect(v.releaseUrl).toBe('https://github.com/learnhouse/learnhouse/releases/tag/1.4.3')
  })
  test('local build has no commit', () => {
    const v = describeVersion('1.4.3', '')
    expect(v.label).toBe('v1.4.3')
    expect(v.build).toBeNull()
  })
  test('custom build id is kept as is and a v prefix is dropped', () => {
    expect(describeVersion('v2.0.0', 'nightly-7').label).toBe('v2.0.0 · nightly-7')
  })
  test('missing version falls back to the releases list', () => {
    const v = describeVersion(undefined, null)
    expect(v.version).toBe('0.0.0')
    expect(v.releaseUrl).toBe('https://github.com/learnhouse/learnhouse/releases')
  })
})
