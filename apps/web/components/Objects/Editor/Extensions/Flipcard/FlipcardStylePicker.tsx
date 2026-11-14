'use client'
import React from 'react'
import { Check } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Segmented } from '../../Blocks/ui/BlockChrome'
import {
  FLIPCARD_COLORS,
  FLIPCARD_SIZES,
  FLIPCARD_STYLES,
  flipcardFaces,
  resolveFlipcardColor,
  resolveFlipcardSize,
  resolveFlipcardStyle,
  type FlipcardSize,
  type FlipcardStyle,
} from './flipcardStyles'

export interface FlipcardLook {
  color?: string
  style?: string
  size?: string
}

const COLOR_LABEL_KEYS: Record<string, [string, string]> = {
  blue: ['editor.blocks_v2.flipcard.color_blue', 'Blue'],
  sky: ['editor.blocks_v2.flipcard.color_sky', 'Sky'],
  indigo: ['editor.blocks_v2.flipcard.color_indigo', 'Indigo'],
  purple: ['editor.blocks_v2.flipcard.color_purple', 'Purple'],
  pink: ['editor.blocks_v2.flipcard.color_pink', 'Pink'],
  red: ['editor.blocks_v2.flipcard.color_red', 'Red'],
  amber: ['editor.blocks_v2.flipcard.color_orange', 'Orange'],
  yellow: ['editor.blocks_v2.flipcard.color_amber', 'Amber'],
  green: ['editor.blocks_v2.flipcard.color_green', 'Green'],
  teal: ['editor.blocks_v2.flipcard.color_teal', 'Teal'],
  neutral: ['editor.blocks_v2.flipcard.color_neutral', 'Graphite'],
}

/** Colour swatches, style presets drawn in the current colour, and size. */
export function FlipcardStylePicker({ look, onChange, showSize = true }: { look: FlipcardLook; onChange: (_patch: FlipcardLook) => void; showSize?: boolean }) {
  const { t } = useTranslation()
  const color = resolveFlipcardColor(look.color)
  const style = resolveFlipcardStyle(look.style)
  const size = resolveFlipcardSize(look.size)
  const styleLabel = (s: FlipcardStyle) =>
    s === 'solid'
      ? t('editor.blocks_v2.flipcard.style_solid', 'Solid')
      : s === 'soft'
        ? t('editor.blocks_v2.flipcard.style_soft', 'Soft')
        : t('editor.blocks_v2.flipcard.style_outline', 'Outline')
  const sizeLabel = (s: FlipcardSize) =>
    s === 'small' ? t('activities.size_small', 'Small') : s === 'medium' ? t('activities.size_medium', 'Medium') : t('activities.size_large', 'Large')

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-neutral-600">{t('editor.blocks_v2.color', 'Color')}</span>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('editor.blocks_v2.color', 'Color')}>
          {FLIPCARD_COLORS.map((c) => {
            const [key, fallback] = COLOR_LABEL_KEYS[c]
            const active = c === color
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={t(key, fallback)}
                title={t(key, fallback)}
                onClick={() => onChange({ color: c })}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full border-2 border-white text-white transition-transform outline-none hover:scale-110 focus-visible:ring-2 focus-visible:ring-sky-500/50 focus-visible:ring-offset-1',
                  flipcardFaces(c, 'solid').swatch,
                  active && 'ring-2 ring-offset-2 ring-slate-400',
                )}
              >
                {active && <Check size={12} weight="bold" />}
              </button>
            )
          })}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-neutral-600">{t('editor.blocks_v2.flipcard.style', 'Card style')}</span>
        <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label={t('editor.blocks_v2.flipcard.style', 'Card style')}>
          {FLIPCARD_STYLES.map((s) => {
            const faces = flipcardFaces(color, s)
            const active = s === style
            return (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onChange({ style: s })}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-lg p-1 text-[11px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40',
                  active ? 'bg-neutral-100 text-neutral-900' : 'text-neutral-500 hover:bg-neutral-50 hover:text-neutral-800',
                )}
              >
                <span className={cn('flex h-9 w-full items-center justify-center rounded-md border-2 text-[10px] font-semibold', faces.front)}>Aa</span>
                {styleLabel(s)}
              </button>
            )
          })}
        </div>
      </div>
      {showSize && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-neutral-600">{t('editor.blocks_v2.flipcard.size', 'Size')}</span>
          <Segmented
            ariaLabel={t('editor.blocks_v2.flipcard.size', 'Size')}
            value={size}
            onChange={(v) => onChange({ size: v })}
            options={FLIPCARD_SIZES.map((s) => ({ value: s, label: sizeLabel(s) }))}
          />
        </div>
      )}
    </>
  )
}

export default FlipcardStylePicker
