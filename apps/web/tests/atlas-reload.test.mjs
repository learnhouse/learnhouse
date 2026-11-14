import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

// A reloaded Atlas chat must look like the live turn: failed tools stay
// failed with their reason, and each change card sits in the turn whose
// tool call made it (marked "auto" when it ran by itself). EE is a separate
// checkout (absent in OSS CI), so the suite skips there.
const webRoot = path.resolve(import.meta.dirname, '..')
const modPath = path.join(webRoot, 'ee/components/Atlas/atlasTurns.ts')
const hasEE = fs.existsSync(modPath)
const mod = hasEE ? await import(modPath) : null

describe.skipIf(!hasEE)('Atlas reloaded chats', () => {
  test('tool outcomes and call ids survive a reload', () => {
    const [user, model] = mod.persistedToChatMessages([
      { role: 'user', content: 'go' },
      {
        role: 'model',
        content: 'Done.',
        tools: [{ name: 'get_activity_content', ok: false, error: 'http_404', detail: 'No activity' }, 'list_courses'],
        call_ids: ['c1', 'c2'],
      },
    ])
    expect(user.parts).toBeUndefined()
    const tools = model.parts.filter((p) => p.kind === 'tool')
    expect(tools[0]).toMatchObject({ name: 'get_activity_content', status: 'error', callId: 'c1', detail: 'No activity' })
    expect(tools[1]).toMatchObject({ name: 'list_courses', status: 'ok', callId: 'c2' })
    expect(model.callIds).toEqual(['c1', 'c2'])
  })

  test('change cards go back to their turn, before its closing text', () => {
    const thread = mod.persistedToChatMessages([
      { role: 'user', content: 'one' },
      { role: 'model', content: 'First answer', tools: ['schedule_agent'], call_ids: ['a1'] },
      { role: 'user', content: 'two' },
      { role: 'model', content: 'Second answer', tools: ['pause_agent'], call_ids: ['b1'] },
    ])
    const card = (id) => ({ kind: 'action', id, pendingId: id, tool: 't', tier: 'edit', target: {}, summary: id, status: 'applied', auto: true })
    const { thread: out, leftovers } = mod.placeActionCards(thread, [
      { toolCallId: 'b1', part: card('paused') },
      { toolCallId: 'a1', part: card('scheduled') },
      { toolCallId: null, part: card('old') },
    ])
    const kinds = (m) => m.parts.map((p) => (p.kind === 'action' ? p.pendingId : p.kind))
    expect(kinds(out[1])).toEqual(['tool', 'scheduled', 'text'])
    expect(kinds(out[3])).toEqual(['tool', 'paused', 'text'])
    expect(leftovers.map((p) => p.pendingId)).toEqual(['old'])
    expect(thread[1].parts.some((p) => p.kind === 'action')).toBe(false) // input untouched
  })

  test('a plain text reply gets its card before the text', () => {
    const thread = [{ id: 'm', role: 'model', content: 'Hi', callIds: ['x'] }]
    const { thread: out } = mod.placeActionCards(thread, [{ toolCallId: 'x', part: { kind: 'action', id: 'a', pendingId: 'a' } }])
    expect(out[0].parts.map((p) => p.kind)).toEqual(['action', 'text'])
  })

  test('Stop closes the plan instead of leaving it running', () => {
    const plan = { kind: 'block', id: 'b', block: { type: 'plan', steps: [
      { id: 's1', title: 'A', status: 'done' }, { id: 's2', title: 'B', status: 'running' }, { id: 's3', title: 'C', status: 'pending', note: 'mine' },
    ] } }
    const [closed, text] = mod.closePlan([plan, { kind: 'text', id: 't', text: 'x' }], 'Stopped')
    expect(closed.block.steps.map((s) => [s.status, s.note ?? null])).toEqual([['done', null], ['skipped', 'Stopped'], ['skipped', 'mine']])
    expect(text.kind).toBe('text')
  })
})
