/**
 * Custom text prompt wrapper that fixes two @clack/prompts issues:
 * 1. Tab fills the placeholder/default value into the input
 * 2. Enter on empty input validates against defaultValue (not "")
 *
 * All other prompts are re-exported from @clack/prompts unchanged.
 */

import { TextPrompt, settings } from '@clack/core'
import { S_BAR, S_BAR_END, symbol } from '@clack/prompts'
import pc from 'picocolors'

// Re-export everything used from @clack/prompts (except text)
export {
  isCancel,
  cancel,
  password,
  select,
  multiselect,
  confirm,
  spinner,
  log,
  intro,
  outro,
  note,
  group,
} from '@clack/prompts'

interface TextOptions {
  message: string
  placeholder?: string
  defaultValue?: string
  initialValue?: string
  validate?: (value: string) => string | Error | undefined
}

export function text(opts: TextOptions): Promise<string | symbol> {
  const fillValue = opts.defaultValue ?? opts.placeholder

  const prompt = new TextPrompt({
    placeholder: opts.placeholder,
    defaultValue: opts.defaultValue,
    initialValue: opts.initialValue,
    validate: opts.validate
      ? (value: string | undefined) => {
          // Use defaultValue for validation when input is empty
          const effective = value || opts.defaultValue || ''
          return opts.validate!(effective)
        }
      : undefined,
    render() {
      const withGuide = settings.withGuide
      const head = `${withGuide ? `${pc.gray(S_BAR)}\n` : ''}${symbol(this.state)}  ${opts.message}\n`
      const placeholderDisplay = opts.placeholder
        ? pc.inverse(opts.placeholder[0]) + pc.dim(opts.placeholder.slice(1))
        : pc.inverse(pc.hidden('_'))
      const input = this.userInput ? this.userInputWithCursor : placeholderDisplay
      const value = this.value ?? ''

      switch (this.state) {
        case 'error': {
          const errorMsg = this.error ? `  ${pc.yellow(this.error)}` : ''
          const bar = withGuide ? `${pc.yellow(S_BAR)}  ` : ''
          const barEnd = withGuide ? pc.yellow(S_BAR_END) : ''
          return `${head.trim()}\n${bar}${input}\n${barEnd}${errorMsg}\n`
        }
        case 'submit': {
          const val = value ? `  ${pc.dim(value)}` : ''
          const bar = withGuide ? pc.gray(S_BAR) : ''
          return `${head}${bar}${val}`
        }
        case 'cancel': {
          const val = value ? `  ${pc.strikethrough(pc.dim(value))}` : ''
          const bar = withGuide ? pc.gray(S_BAR) : ''
          return `${head}${bar}${val}${value.trim() ? `\n${bar}` : ''}`
        }
        default: {
          const bar = withGuide ? `${pc.cyan(S_BAR)}  ` : ''
          const barEnd = withGuide ? pc.cyan(S_BAR_END) : ''
          return `${head}${bar}${input}\n${barEnd}\n`
        }
      }
    },
  })

  // Tab completion: fill placeholder/default when Tab pressed on empty input
  if (fillValue) {
    prompt.on('key', (_key, info) => {
      if (info?.name === 'tab' && !prompt.userInput) {
        ;(prompt as any)._setUserInput(fillValue, true)
      }
    })
  }

  return prompt.prompt() as Promise<string | symbol>
}
