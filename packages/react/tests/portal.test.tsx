import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import * as Dialog from '../src/shims/radix-dialog'
import { PortalContainerContext } from '../src/portal'
import { WEB_IMPORT_SHIMS } from '../scripts/build-config.mjs'

// Radix portals default to document.body, outside the `.lh-activity` root
// whose class scopes every package style and carries the theme variables.
describe('scoped portals', () => {
  it('mounts dialogs inside the activity portal host', () => {
    function Harness() {
      const [host, setHost] = React.useState<HTMLDivElement | null>(null)
      return (
        <div className="lh-activity">
          <PortalContainerContext.Provider value={host}>
            <Dialog.Root open>
              <Dialog.Portal>
                <Dialog.Content aria-describedby={undefined}>
                  <Dialog.Title>Confirm submit</Dialog.Title>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          </PortalContainerContext.Provider>
          <div ref={setHost} data-testid="host" />
        </div>
      )
    }
    render(<Harness />)
    const title = screen.getByText('Confirm submit')
    expect(screen.getByTestId('host').contains(title)).toBe(true)
    expect(title.closest('.lh-activity')).not.toBeNull()
  })

  it('falls back to document.body without a host', () => {
    render(
      <Dialog.Root open>
        <Dialog.Portal>
          <Dialog.Content aria-describedby={undefined}>
            <Dialog.Title>Plain dialog</Dialog.Title>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>,
    )
    expect(screen.getByText('Plain dialog').closest('.lh-activity')).toBeNull()
  })

  it('routes every Radix portal the web source uses through a shim', () => {
    const dist = path.join(import.meta.dirname, '../dist')
    const files = readdirSync(dist, { recursive: true }).filter((f) => String(f).endsWith('.js'))
    const importers = new Map<string, number>()
    for (const file of files) {
      const code = readFileSync(path.join(dist, String(file)), 'utf8')
      for (const name of Object.keys(WEB_IMPORT_SHIMS)) {
        if (code.includes(`from"${name}"`)) importers.set(name, (importers.get(name) ?? 0) + 1)
      }
    }
    // Only the shim chunk itself imports each Radix package.
    for (const name of Object.keys(WEB_IMPORT_SHIMS)) expect(importers.get(name) ?? 0, name).toBeLessThanOrEqual(1)
  })
})
