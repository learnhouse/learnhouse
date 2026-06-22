import { describe, it, expect, vi } from 'vitest'

// The custom text() prompt wraps @clack/core's TextPrompt. Mock the core so
// prompt() resolves deterministically and we can capture the constructed
// prompt to drive its render() across every state without a real terminal.
const core = vi.hoisted(() => {
  const instances: Array<{ opts: any; handlers: Record<string, unknown> }> = []
  class TextPrompt {
    opts: any
    handlers: Record<string, unknown> = {}
    userInput: string | undefined = undefined
    setCalls: Array<[string, boolean]> = []
    constructor(opts: any) { this.opts = opts; instances.push(this) }
    on(ev: string, cb: unknown) { this.handlers[ev] = cb }
    _setUserInput(v: string, flag: boolean) { this.setCalls.push([v, flag]) }
    prompt() { return Promise.resolve('typed-value') }
  }
  return { TextPrompt, settings: { withGuide: true }, instances }
})
vi.mock('@clack/core', () => core)
vi.mock('@clack/prompts', () => ({
  S_BAR: '│', S_BAR_END: '└', symbol: () => '◇',
  isCancel: () => false, cancel: () => {}, password: () => {}, select: () => {},
  multiselect: () => {}, confirm: () => {}, spinner: () => {}, log: {}, intro: () => {},
  outro: () => {}, note: () => {}, group: () => {},
}))

import { text } from '../src/utils/prompt.js'

describe('utils/prompt — custom text()', () => {
  it('resolves to the prompt value and validates against the default when empty', async () => {
    const validate = vi.fn(() => undefined)
    expect(await text({ message: 'Name', defaultValue: 'def', validate })).toBe('typed-value')
    const inst = core.instances.at(-1)!
    // The wrapper's validate uses the default value when input is empty.
    inst.opts.validate('')
    expect(validate).toHaveBeenCalledWith('def')
  })

  it('registers a Tab handler that fills the placeholder when input is empty', async () => {
    await text({ message: 'Name', placeholder: 'fill-me' })
    const inst = core.instances.at(-1) as any
    expect(typeof inst.handlers.key).toBe('function')
    // Simulate Tab on empty input — fills the placeholder via the closure prompt.
    ;(inst.handlers.key as (k: string, i: { name: string }) => void)('\t', { name: 'tab' })
    expect(inst.setCalls).toContainEqual(['fill-me', true])
  })

  it('render() produces output for every prompt state', async () => {
    await text({ message: 'Name', placeholder: 'ph', defaultValue: 'def' })
    const render = core.instances.at(-1)!.opts.render as () => string
    for (const state of ['initial', 'error', 'submit', 'cancel'] as const) {
      const ctx = {
        state, error: 'bad value', userInput: 'abc',
        userInputWithCursor: 'abc|', value: 'abc',
      }
      expect(typeof render.call(ctx)).toBe('string')
    }
  })
})
