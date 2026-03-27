import { keymap, KeyBinding } from '@codemirror/view'

export function createPlaygroundKeymap(handlers: {
  onRun: () => void
  onReset: () => void
}) {
  const bindings: KeyBinding[] = [
    {
      key: 'Ctrl-Enter',
      mac: 'Cmd-Enter',
      run: () => {
        handlers.onRun()
        return true
      },
    },
    {
      key: 'Ctrl-Shift-r',
      mac: 'Cmd-Shift-r',
      run: () => {
        handlers.onReset()
        return true
      },
      preventDefault: true,
    },
  ]
  return keymap.of(bindings)
}
