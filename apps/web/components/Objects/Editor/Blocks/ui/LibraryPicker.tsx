'use client'
/*
 Pick a file that already lives in the org Library. The block is then turned
 into a Library block pointing at that file, so the asset stays reusable and
 keeps being served through the access-checked /media/{uuid}/file endpoint
 (no copy is made under the activity).

 A popover rather than a modal: a modal dialog opened from inside the editor
 remounts every React node view (and closes again in collaborative mode),
 while a non-modal popover leaves the editor alone.
*/
import React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { useTranslation } from 'react-i18next'
import { Books } from '@phosphor-icons/react'
import ResourcePicker, { type SelectedResource } from '@components/Dashboard/Library/ResourcePicker'
import { useOrg } from '@components/Contexts/OrgContext'
import { buttonClass } from '@components/Dashboard/Shared/DashKit/buttons'

export function LibraryPickerButton({ onSelect }: { onSelect: (_resource: SelectedResource) => void }) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const [open, setOpen] = React.useState(false)
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button type="button" className={buttonClass('secondary', 'sm')}>
          <Books size={13} />
          {t('editor.blocks_v2.from_library', 'Library')}
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          role="dialog"
          aria-label={t('library.choose_from_library', 'Choose from Library')}
          align="end"
          sideOffset={6}
          collisionPadding={12}
          style={{ zIndex: 'var(--z-popover)' }}
          className="w-[min(560px,calc(100vw-24px))] rounded-xl bg-white p-4 shadow-[0_12px_32px_rgba(0,0,0,0.1),0_0_0_1px_rgba(0,0,0,0.08)] outline-none"
          onKeyDown={(e) => e.stopPropagation()}
        >
          <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-neutral-800">
            <Books size={15} className="text-neutral-500" />
            {t('library.choose_from_library', 'Choose from Library')}
          </div>
          {open && (
            <ResourcePicker
              orgslug={org?.slug}
              mode="select"
              tabs={['media']}
              onSelect={(r) => {
                setOpen(false)
                onSelect(r)
              }}
            />
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

export default LibraryPickerButton
