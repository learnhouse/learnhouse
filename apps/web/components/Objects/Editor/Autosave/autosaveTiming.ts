// Pure autosave rules, kept apart from React so they are easy to test.

export type AutosaveStatus = 'saved' | 'saving' | 'failed' | 'offline' | 'conflict'

/** Wait before retrying after `failures` failed saves in a row: 2 s, 4 s, 8 s … capped at 30 s. */
export function nextAutosaveDelay(failures: number): number {
  return Math.min(30_000, 2000 * 2 ** Math.max(0, failures - 1))
}

/** The shared save indicator's status for the autosave state. */
export function autosaveIndicatorStatus(
  status: AutosaveStatus,
  opts: { connecting: boolean; readOnly: boolean; dirty: boolean; savedOnce?: boolean },
): 'saved' | 'saving' | 'offline' | 'failed' | 'connecting' | 'readonly' {
  if (opts.readOnly) return opts.connecting ? 'connecting' : 'readonly'
  if (status === 'conflict' || status === 'failed') return 'failed'
  if (status === 'offline') return 'offline'
  if (status === 'saving' || opts.dirty) return 'saving'
  // "Connecting…" until there is a save of ours to report
  return opts.connecting && !opts.savedOnce ? 'connecting' : 'saved'
}
