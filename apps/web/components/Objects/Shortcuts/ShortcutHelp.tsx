'use client'
import React, { useMemo } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { useIsMac } from '@/hooks/useIsMac'
import { useShortcuts, type ShortcutGroup } from '@/lib/shortcuts/ShortcutsContext'
import { Kbd, Keys } from './Kbd'

const GROUP_ORDER: ShortcutGroup[] = ['page', 'navigation', 'global']

/** The `?` sheet: every shortcut currently bound, grouped, in registry order. */
export default function ShortcutHelp() {
  const { t } = useTranslation()
  const { actions, helpOpen, setHelpOpen } = useShortcuts()
  const isMac = useIsMac()

  const grouped = useMemo(() => {
    const map = new Map<ShortcutGroup, typeof actions>()
    for (const g of GROUP_ORDER) map.set(g, [])
    for (const a of actions) map.get(a.group)!.push(a)
    return map
  }, [actions])

  return (
    <DialogPrimitive.Root open={helpOpen} onOpenChange={setHelpOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 bg-black/30 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:duration-100 data-[state=closed]:duration-75"
          style={{ zIndex: 'var(--z-modal-backdrop)' as any }}
        />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-x-3 top-[10vh] mx-auto flex max-h-[80vh] w-auto max-w-[560px] flex-col overflow-hidden rounded-2xl border border-black/5 bg-white shadow-2xl shadow-black/15 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 data-[state=open]:duration-150 data-[state=closed]:duration-100 sm:top-[16vh]"
          style={{ zIndex: 'var(--z-modal)' as any }}
        >
          <div className="flex items-start justify-between gap-4 border-b border-black/5 px-5 py-4">
            <div>
              <DialogPrimitive.Title className="text-sm font-semibold text-black/85">
                {t('shortcuts.help_title')}
              </DialogPrimitive.Title>
              <p className="mt-0.5 text-xs text-black/50">{t('shortcuts.help_subtitle')}</p>
            </div>
            <DialogPrimitive.Close
              className="rounded-md p-1.5 text-black/45 transition-colors hover:bg-black/5 hover:text-black/70"
              aria-label={t('common.close')}
            >
              <X size={16} />
            </DialogPrimitive.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3" style={{ scrollbarWidth: 'thin' }}>
            {GROUP_ORDER.map((group) => {
              const items = grouped.get(group) ?? []
              if (items.length === 0) return null
              return (
                <section key={group} className="py-2.5">
                  <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-black/45">
                    {t(`shortcuts.groups.${group}`)}
                  </h3>
                  <ul className="divide-y divide-black/[0.04]">
                    {items.map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-4 py-2 text-sm text-black/75">
                        <span className="truncate">{a.label}</span>
                        <span className="inline-flex shrink-0 items-center gap-2">
                          {a.id === 'global.search' && (
                            // The palette opens on ⌘K / Ctrl K as well as `/`.
                            <span className="inline-flex items-center gap-0.5">
                              <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd>
                              <Kbd>K</Kbd>
                            </span>
                          )}
                          <Keys keys={a.keys} />
                          {a.aliases?.map((alias) => (
                            <React.Fragment key={alias}>
                              <span className="text-[10px] text-black/35">{t('shortcuts.or')}</span>
                              <Keys keys={alias} tone="muted" />
                            </React.Fragment>
                          ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
