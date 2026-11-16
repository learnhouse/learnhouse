import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

// Chat previews read Atlas's quiz/flipcard fences instead of showing raw code.
const webRoot = path.resolve(import.meta.dirname, '..')
const modPath = path.join(webRoot, 'ee/components/Atlas/fencePreview.ts')
const hasEE = fs.existsSync(modPath)
const mod = hasEE ? await import(modPath) : null

describe.skipIf(!hasEE)('Atlas fence previews', () => {
  test('quiz fence', () => {
    const qs = mod.parseQuizFence(
      'Q: What does a recursive resolver do?\n- [x] It tracks down the answer\n- [ ] It hosts the zone\n> It asks other servers.\n\nQ2: Which record maps a name to IPv4?\n- [ ] MX\n- [X] A',
    )
    expect(qs).toHaveLength(2)
    expect(qs[0]).toEqual({
      text: 'What does a recursive resolver do?',
      options: [{ text: 'It tracks down the answer', correct: true }, { text: 'It hosts the zone', correct: false }],
      explanation: 'It asks other servers.',
    })
    expect(qs[1].options.find((o) => o.correct).text).toBe('A')
    expect(mod.parseQuizFence('- [x] orphan option')[0].options).toHaveLength(1)
    expect(mod.parseQuizFence('Q: long\nquestion text\n- [ ] a')[0].text).toBe('long question text')
  })

  test('flipcards and fence kinds', () => {
    expect(mod.parseFlipcards('TTL :: time to live\n- DNS :: Domain Name System\nno card')).toEqual([
      { front: 'TTL', back: 'time to live' },
      { front: 'DNS', back: 'Domain Name System' },
    ])
    expect(mod.fenceKind('language-quiz')).toBe('quiz')
    expect(mod.fenceKind('language-python')).toBe(null)
    expect(mod.fenceKind(undefined)).toBe(null)
  })
})
