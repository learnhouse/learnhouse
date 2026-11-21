'use client'
/*
 The toggle's editor tools (open by default, look, icon, delete). Editor
 only, so they are a chunk of their own (ToggleBlock).
*/
import React from 'react'
import type { NodeViewProps } from '@tiptap/react'
import { CaretRight, Plus, Sliders, Trash } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { deleteBlock } from '../nodeViewUtils'
import { BlockPopover, Segmented } from '../ui/BlockChrome'
import { TOGGLE_ICONS, TOGGLE_VARIANTS, type ToggleIcon, type ToggleVariant } from '../schema/blockAttrs'

export default function ToggleTools(props: NodeViewProps & { variant: ToggleVariant; icon: ToggleIcon; defaultOpen: boolean }) {
  const { t } = useTranslation()
  const { variant, icon, defaultOpen } = props
  const [styleOpen, setStyleOpen] = React.useState(false)
  return (
    <div className={cn('flex items-center gap-1 opacity-0 transition-opacity group-hover/toggle:opacity-100 focus-within:opacity-100', styleOpen && 'opacity-100')}>
      <label className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] text-neutral-500 hover:bg-black/5">
        <input
          type="checkbox"
          className="h-3.5 w-3.5 accent-neutral-900"
          checked={defaultOpen}
          onChange={(e) => props.updateAttributes({ defaultOpen: e.target.checked })}
        />
        {t('editor.blocks_v2.toggle_open_default', 'Open by default')}
      </label>
      <BlockPopover
        open={styleOpen}
        onOpenChange={setStyleOpen}
        title={t('editor.blocks_v2.toggle.style', 'Toggle style')}
        width={272}
        trigger={
          <button
            type="button"
            aria-label={t('editor.blocks_v2.toggle.style', 'Toggle style')}
            title={t('editor.blocks_v2.toggle.style', 'Toggle style')}
            className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:bg-black/5 hover:text-neutral-700 data-[state=open]:bg-black/5"
          >
            <Sliders size={13} />
          </button>
        }
      >
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-neutral-600">{t('editor.blocks_v2.toggle.variant', 'Look')}</span>
          <Segmented<ToggleVariant>
            ariaLabel={t('editor.blocks_v2.toggle.variant', 'Look')}
            value={variant}
            onChange={(v) => props.updateAttributes({ variant: v === 'default' ? null : v })}
            options={TOGGLE_VARIANTS.map((v) => ({
              value: v,
              label: t(`editor.blocks_v2.toggle.variant_${v}`, { default: 'Default', bordered: 'Bordered', filled: 'Filled' }[v]),
            }))}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-neutral-600">{t('editor.blocks_v2.toggle.icon', 'Icon')}</span>
          <Segmented<ToggleIcon>
            ariaLabel={t('editor.blocks_v2.toggle.icon', 'Icon')}
            value={icon}
            onChange={(v) => props.updateAttributes({ icon: v === 'chevron' ? null : v })}
            options={TOGGLE_ICONS.map((v) => ({
              value: v,
              label: v === 'plus' ? <Plus size={13} weight="bold" /> : <CaretRight size={13} weight="bold" className="rtl:rotate-180" />,
              title: t(`editor.blocks_v2.toggle.icon_${v}`, { chevron: 'Arrow', plus: 'Plus and minus' }[v]),
            }))}
          />
        </div>
      </BlockPopover>
      <button
        type="button"
        aria-label={t('common.delete', 'Delete')}
        title={t('common.delete', 'Delete')}
        onClick={() => deleteBlock(props)}
        className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:bg-rose-50 hover:text-rose-600"
      >
        <Trash size={13} />
      </button>
    </div>
  )
}
