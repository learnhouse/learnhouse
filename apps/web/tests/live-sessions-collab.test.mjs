// Live room collaboration: transcript parsing for the searchable transcript,
// and guards that user-written text in the room is never injected as HTML.
import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../ee/components/LiveSessions/', import.meta.url).pathname

function sources(dir = ROOT) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sources(p))
    else if (/\.tsx?$/.test(entry.name)) out.push([p, readFileSync(p, 'utf8')])
  }
  return out
}

describe('transcript cues', async () => {
  const { transcriptCues } = await import('../ee/components/LiveSessions/transcript.ts')

  test('WebVTT lines keep their start time', () => {
    const cues = transcriptCues('WEBVTT\n\n1\n00:00:05.000 --> 00:00:08.000\nHello <b>class</b>\n\n2\n01:02:03.500 --> 01:02:06.000\nSecond line\nwraps here\n')
    expect(cues).toEqual([
      { start: 5, text: 'Hello class' },
      { start: 3723, text: 'Second line wraps here' },
    ])
  })

  test('plain text becomes untimed lines', () => {
    expect(transcriptCues('one\n\ntwo')).toEqual([
      { start: null, text: 'one' },
      { start: null, text: 'two' },
    ])
  })
})

describe('user text in the live room is rendered as text', () => {
  const files = sources()

  test('only the notes view injects HTML, and it sanitizes with an allowlist', () => {
    const injecting = files.filter(([, s]) => s.includes('dangerouslySetInnerHTML')).map(([p]) => p.replace(ROOT, ''))
    expect(injecting).toEqual(['Dashboard/LiveSessionNotes.tsx'])
    const notes = files.find(([p]) => p.endsWith('LiveSessionNotes.tsx'))[1]
    expect(notes).toContain('DOMPurify.sanitize(')
    expect(notes).toContain('ALLOWED_TAGS: NOTE_TAGS')
    expect(notes).toMatch(/ALLOWED_URI_REGEXP: \/\^\(\?:https\?:\|mailto:\)\/i/)
    expect(notes).not.toMatch(/NOTE_TAGS = \[[^\]]*'(script|img|svg|iframe|style)'/)
  })

  test('chat links only become anchors for http(s) URLs', () => {
    const panels = files.find(([p]) => p.endsWith('Room/Panels.tsx'))[1]
    expect(panels).toContain('function Linkified')
    expect(panels).toMatch(/split\(\/\(https\?:/)
    expect(panels).toContain('rel="noopener noreferrer nofollow"')
  })
})
