'use client'
/**
 * The right panel: Style (per breakpoint), Content (props) and Settings for
 * the selected element; the page theme when nothing is selected.
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import FontPicker from './FontPicker'
import { FONT_PAIRINGS, fontStack } from '../model/fonts'
import {
  ArrowDown, ArrowRight, ArrowsDownUp, BookmarkSimple, Copy, Desktop, DeviceMobile, DeviceTablet, Palette,
  DotsSixVertical, FilmStrip, LinkBreak, Plus, Rows, SquaresFour, Trash, TextAlignCenter, TextAlignJustify, TextAlignLeft, TextAlignRight,
} from '@phosphor-icons/react'
import { useQuery } from '@tanstack/react-query'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getOrgCourses } from '@services/courses/courses'
import { getOrgPaths } from '@services/paths/paths'
import { getPublicOffers } from '@ee/services/payments/offers'
import { getAPIUrl } from '@services/config/config'
import { rewriteLandingCopy } from '@services/landing/landing'
import { AIButton } from '@components/Objects/AI/AIBrand'
import toast from 'react-hot-toast'
import type { Breakpoint, LandingDoc, LandingNode, LandingTheme, Style, StyleLayer } from '../model/types'
import { CONTAINER_TYPES, DEFAULT_DARK_COLORS } from '../model/types'
import { setProps, updateNode, withStyle, pathTo } from '../model/tree'
import { LANDING_ICON_NAMES, LANDING_ICONS } from '../render/icons'
import { FIELDS, iconFor, type Field } from './catalog'
import { ColorInput, Group, ImageInput, LengthInput, NumberInput, Pills, Row, Select, TextArea, TextInput, Toggle, FIELD } from './controls'

const PRESET_SWATCH: Record<string, string[]> = {
  brand: ['var(--lh-brand, #171717)', '#0f172a', '#f8fafc'],
  minimal: ['#111111', '#f6f6f6', '#ffffff'],
  warm: ['#c2410c', '#fff1e6', '#fffaf5'],
  bold: ['#4f46e5', '#facc15', '#eef2ff'],
  elegant: ['#1f3a32', '#b08d57', '#f1eee6'],
  playful: ['#db2777', '#7c3aed', '#fdf2f8'],
  dark: ['#38bdf8', '#111a2e', '#0b1120'],
  fresh: ['#059669', '#fbbf24', '#ecfdf5'],
}

export interface InspectorProps {
  doc: LandingDoc
  node: LandingNode | null
  breakpoint: Breakpoint
  presets: Record<string, any>
  customCode: boolean
  onDoc: (doc: LandingDoc, key?: string) => void
  onSelect: (id: string | null) => void
  onAction: (action: 'duplicate' | 'delete' | 'symbol' | 'detach' | 'up' | 'down' | 'save') => void
}

/* ── shared: read a style value with inheritance ─────────────────────────── */

function layersFor(bp: Breakpoint): StyleLayer[] {
  return bp === 'mobile' ? ['mobile', 'tablet', 'base'] : bp === 'tablet' ? ['tablet', 'base'] : ['base']
}

function useStyleAccess(node: LandingNode, layer: StyleLayer, onDoc: InspectorProps['onDoc'], doc: LandingDoc) {
  const chain: StyleLayer[] = layer === 'hover' ? ['hover'] : layersFor(layer as Breakpoint)
  const own = (key: keyof Style) => node.style?.[layer]?.[key]
  const inherited = (key: keyof Style) => {
    for (const l of chain.slice(1)) {
      const v = node.style?.[l]?.[key]
      if (v !== undefined) return v
    }
    return undefined
  }
  const value = (key: keyof Style) => (own(key) !== undefined ? own(key) : inherited(key))
  const set = (patch: Partial<Style>) =>
    onDoc(updateNode(doc, node.id, (n) => ({ ...n, style: withStyle(n.style, layer, patch) })), `style:${node.id}:${layer}:${Object.keys(patch).join(',')}`)
  return { own, inherited, value, set, layer }
}

type Access = ReturnType<typeof useStyleAccess>

function L({ a, k, label, allowAuto, allowContent, stacked }: { a: Access; k: keyof Style; label: string; allowAuto?: boolean; allowContent?: boolean; stacked?: boolean }) {
  const inh = a.inherited(k)
  return (
    <Row label={label} overridden={a.own(k) !== undefined} onReset={() => a.set({ [k]: undefined })} stacked={stacked}>
      <LengthInput value={a.own(k)} placeholder={inh !== undefined ? String(inh) : ''} onChange={(v) => a.set({ [k]: v })} allowAuto={allowAuto} allowContent={allowContent} ariaLabel={label} />
    </Row>
  )
}

function C({ a, k, label }: { a: Access; k: keyof Style; label: string }) {
  const inh = a.inherited(k) as string | undefined
  return (
    <Row label={label} overridden={a.own(k) !== undefined} onReset={() => a.set({ [k]: undefined })}>
      <ColorInput value={(a.own(k) as string | undefined) ?? undefined} placeholder={inh} onChange={(v) => a.set({ [k]: v })} />
    </Row>
  )
}

function E<T extends string>({ a, k, label, options, labelFor }: { a: Access; k: keyof Style; label: string; options: T[]; labelFor?: (v: T) => string }) {
  const { t } = useTranslation()
  const cur = a.value(k) as T | undefined
  return (
    <Row label={label} overridden={a.own(k) !== undefined} onReset={() => a.set({ [k]: undefined })}>
      <Select value={(cur as string) ?? ''} options={['', ...options]} onChange={(v) => a.set({ [k]: v || undefined })} labels={(v) => (v ? (labelFor ? labelFor(v as T) : v) : t('landingBuilder.style.default'))} />
    </Row>
  )
}

/** Four sides at once (padding / margin), with a "same on all sides" shortcut. */
function Sides({ a, prefix, label, allowAuto }: { a: Access; prefix: 'padding' | 'margin'; label: string; allowAuto?: boolean }) {
  const { t } = useTranslation()
  const keys = (['Top', 'Right', 'Bottom', 'Left'] as const).map((s) => `${prefix}${s}` as keyof Style)
  const names = [t('landingBuilder.style.top'), t('landingBuilder.style.end'), t('landingBuilder.style.bottom'), t('landingBuilder.style.start')]
  const overridden = keys.some((k) => a.own(k) !== undefined)
  return (
    <Row label={label} stacked overridden={overridden} onReset={() => a.set(Object.fromEntries(keys.map((k) => [k, undefined])))}>
      <div className="grid grid-cols-4 gap-1.5">
        {keys.map((k, i) => (
          <div key={k} className="flex flex-col gap-0.5">
            <LengthInput value={a.own(k)} placeholder={a.inherited(k) !== undefined ? String(a.inherited(k)) : '0'} onChange={(v) => a.set({ [k]: v })} allowAuto={allowAuto} ariaLabel={`${label} ${names[i]}`} />
            <span className="text-center text-[10px] text-neutral-400">{names[i]}</span>
          </div>
        ))}
      </div>
    </Row>
  )
}

/* ── style ──────────────────────────────────────────────────────────────── */

const TEXTY = new Set(['heading', 'text', 'richtext', 'button', 'list', 'icon'])

function StylePanel({ node, doc, breakpoint, onDoc }: { node: LandingNode; doc: LandingDoc; breakpoint: Breakpoint; onDoc: InspectorProps['onDoc'] }) {
  const { t } = useTranslation()
  const [state, setState] = React.useState<'normal' | 'hover'>('normal')
  const [advanced, setAdvanced] = React.useState(false)
  const layer: StyleLayer = state === 'hover' ? 'hover' : breakpoint
  const a = useStyleAccess(node, layer, onDoc, doc)
  const isContainer = CONTAINER_TYPES.has(node.type)
  const display = (a.value('display') as string) || (node.type === 'columns' ? 'grid' : 'block')
  const S = (k: string) => t(`landingBuilder.style.${k}`)
  const bpLabel = { base: t('landingBuilder.breakpoints.desktop'), tablet: t('landingBuilder.breakpoints.tablet'), mobile: t('landingBuilder.breakpoints.mobile') }[breakpoint]

  if (state === 'hover') {
    return (
      <div>
        <div className="px-4 py-3 border-b border-neutral-100"><Pills value={state} options={[{ key: 'normal', label: S('state_normal') }, { key: 'hover', label: S('state_hover') }]} onChange={(v) => v && setState(v)} /></div>
        <Group title={S('hover')}>
          <p className="text-[12px] text-neutral-500">{S('hover_hint')}</p>
          <C a={a} k="color" label={S('text_color')} />
          <C a={a} k="backgroundColor" label={S('background')} />
          <C a={a} k="borderColor" label={S('border_color')} />
          <E a={a} k="boxShadow" label={S('shadow')} options={['none', 'sm', 'md', 'lg', 'xl']} labelFor={(v) => S(`shadow_${v}`)} />
          <Row label={S('scale')} overridden={a.own('scale') !== undefined} onReset={() => a.set({ scale: undefined })}>
            <NumberInput value={a.own('scale') as number | undefined} min={0.8} max={1.2} step={0.01} onChange={(v) => a.set({ scale: v })} />
          </Row>
          <Row label={S('opacity')} overridden={a.own('opacity') !== undefined} onReset={() => a.set({ opacity: undefined })}>
            <NumberInput value={a.own('opacity') as number | undefined} min={0} max={1} step={0.05} onChange={(v) => a.set({ opacity: v })} />
          </Row>
        </Group>
      </div>
    )
  }

  return (
    <div>
      <div className="px-4 py-3 border-b border-neutral-100 flex flex-col gap-2">
        <Pills value={state} options={[{ key: 'normal', label: S('state_normal') }, { key: 'hover', label: S('state_hover') }]} onChange={(v) => v && setState(v)} />
        {breakpoint !== 'base' && (
          <div className="flex items-center gap-2 rounded-lg bg-sky-50 px-2.5 py-2 text-[12px] text-sky-800 ring-1 ring-inset ring-sky-600/10">
            {breakpoint === 'mobile' ? <DeviceMobile size={14} /> : <DeviceTablet size={14} />}
            <span>{t('landingBuilder.style.breakpoint_hint', { device: bpLabel })}</span>
          </div>
        )}
      </div>
      {isContainer && (
        <Group title={S('layout')}>
          <Row label={S('display')} overridden={a.own('display') !== undefined} onReset={() => a.set({ display: undefined })}>
            <Pills
              value={display as any}
              options={[{ key: 'block', label: <Rows size={14} />, title: S('display_block') }, { key: 'flex', label: <ArrowsDownUp size={14} />, title: S('display_flex') }, { key: 'grid', label: <SquaresFour size={14} />, title: S('display_grid') }]}
              onChange={(v) => a.set({ display: v })}
            />
          </Row>
          {display === 'flex' && (
            <>
              <Row label={S('direction')} overridden={a.own('flexDirection') !== undefined} onReset={() => a.set({ flexDirection: undefined })}>
                <Pills value={a.value('flexDirection') as any} options={[{ key: 'row', label: <ArrowRight size={14} className="rtl:rotate-180" />, title: S('row') }, { key: 'column', label: <ArrowDown size={14} />, title: S('column') }]} onChange={(v) => a.set({ flexDirection: v })} />
              </Row>
              <E a={a} k="alignItems" label={S('align')} options={['flex-start', 'center', 'flex-end', 'stretch', 'baseline']} labelFor={(v) => S(`align_${v}`)} />
              <E a={a} k="justifyContent" label={S('justify')} options={['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly']} labelFor={(v) => S(`justify_${v}`)} />
            </>
          )}
          {display === 'grid' && node.type !== 'columns' && (
            <Row label={S('grid_columns')} overridden={a.own('gridColumns') !== undefined} onReset={() => a.set({ gridColumns: undefined })}>
              <NumberInput value={a.own('gridColumns') as number | undefined} min={1} max={12} onChange={(v) => a.set({ gridColumns: v })} />
            </Row>
          )}
          {display !== 'block' && <L a={a} k="gap" label={S('gap')} />}
          {advanced && display === 'flex' && <E a={a} k="flexWrap" label={S('wrap')} options={['wrap', 'nowrap']} labelFor={(v) => S(`wrap_${v}`)} />}
        </Group>
      )}
      <Group title={S('spacing')}>
        <Sides a={a} prefix="padding" label={S('padding')} />
        <Sides a={a} prefix="margin" label={S('margin')} allowAuto />
      </Group>
      <Group title={S('size')}>
        <div className="grid grid-cols-2 gap-2">
          <L a={a} k="width" label={S('width')} stacked />
          <L a={a} k="maxWidth" label={S('max_width')} allowContent stacked />
          <L a={a} k="minHeight" label={S('min_height')} stacked />
          <L a={a} k="height" label={S('height')} stacked />
        </div>
        {advanced && <L a={a} k="minWidth" label={S('min_width')} />}
        {advanced && <Row label={S('grow')} overridden={a.own('flexGrow') !== undefined} onReset={() => a.set({ flexGrow: undefined })}><NumberInput value={a.own('flexGrow') as number | undefined} min={0} max={12} onChange={(v) => a.set({ flexGrow: v })} /></Row>}
      </Group>
      <Group title={S('typography')} defaultOpen={TEXTY.has(node.type)}>
        <Row label={S('font')} stacked overridden={a.own('fontFamily') !== undefined} onReset={() => a.set({ fontFamily: undefined })}>
          <FontPicker
            value={(a.value('fontFamily') as string) ?? ''}
            onChange={(v) => a.set({ fontFamily: v || undefined })}
            extra={[
              { value: '', label: S('default') },
              { value: 'heading', label: S('font_heading'), family: 'var(--lhp-font-heading, inherit)' },
              { value: 'body', label: S('font_body'), family: 'var(--lhp-font-body, inherit)' },
            ]}
            ariaLabel={S('font')}
            testid="style-font"
          />
        </Row>
        <div className="grid grid-cols-2 gap-2">
          <L a={a} k="fontSize" label={S('font_size')} stacked />
          <Row label={S('line_height')} stacked overridden={a.own('lineHeight') !== undefined} onReset={() => a.set({ lineHeight: undefined })}>
            <NumberInput value={a.own('lineHeight') as number | undefined} min={0.8} max={3} step={0.05} onChange={(v) => a.set({ lineHeight: v })} />
          </Row>
        </div>
        <E a={a} k="fontWeight" label={S('weight')} options={['300', '400', '500', '600', '700', '800', '900']} labelFor={(v) => S(`weight_${v}`)} />
        <Row label={S('text_align')} overridden={a.own('textAlign') !== undefined} onReset={() => a.set({ textAlign: undefined })}>
          <Pills
            value={a.value('textAlign') as any}
            options={[
              { key: 'start', label: <TextAlignLeft size={14} className="rtl:-scale-x-100" />, title: S('align_start') },
              { key: 'center', label: <TextAlignCenter size={14} />, title: S('align_center') },
              { key: 'end', label: <TextAlignRight size={14} className="rtl:-scale-x-100" />, title: S('align_end') },
              { key: 'justify', label: <TextAlignJustify size={14} />, title: S('justify_text') },
            ]}
            onChange={(v) => a.set({ textAlign: v })}
          />
        </Row>
        <C a={a} k="color" label={S('text_color')} />
        {advanced && (
          <>
            <L a={a} k="letterSpacing" label={S('letter_spacing')} />
            <E a={a} k="textTransform" label={S('transform')} options={['none', 'uppercase', 'lowercase', 'capitalize']} labelFor={(v) => S(`transform_${v}`)} />
            <E a={a} k="fontStyle" label={S('font_style')} options={['normal', 'italic']} labelFor={(v) => S(`font_style_${v}`)} />
            <E a={a} k="textDecoration" label={S('decoration')} options={['none', 'underline', 'line-through']} labelFor={(v) => S(`decoration_${v}`)} />
          </>
        )}
      </Group>
      <Group title={S('background')} defaultOpen={node.type === 'section' || node.type === 'container'}>
        <C a={a} k="backgroundColor" label={S('color')} />
        <Row label={S('gradient')} stacked overridden={a.own('backgroundGradient') !== undefined} onReset={() => a.set({ backgroundGradient: undefined })}>
          <div className="grid grid-cols-[1fr_1fr_64px] gap-1.5">
            <ColorInput value={(a.value('backgroundGradient') as any)?.from} placeholder={S('from')} allowNone={false} onChange={(v) => a.set({ backgroundGradient: v ? { from: v, to: (a.value('backgroundGradient') as any)?.to || '$secondary', angle: (a.value('backgroundGradient') as any)?.angle ?? 135 } : undefined })} />
            <ColorInput value={(a.value('backgroundGradient') as any)?.to} placeholder={S('to')} allowNone={false} onChange={(v) => a.set({ backgroundGradient: v ? { from: (a.value('backgroundGradient') as any)?.from || '$primary', to: v, angle: (a.value('backgroundGradient') as any)?.angle ?? 135 } : undefined })} />
            <NumberInput value={(a.value('backgroundGradient') as any)?.angle} min={0} max={360} step={15} onChange={(v) => { const g = a.value('backgroundGradient') as any; if (g) a.set({ backgroundGradient: { ...g, angle: v ?? 135 } }) }} />
            {!!a.value('backgroundGradient') && (
              <Pills
                value={((a.value('backgroundGradient') as any)?.type === 'radial' ? 'radial' : 'linear') as 'linear' | 'radial'}
                options={[{ key: 'linear', label: S('gradient_linear') }, { key: 'radial', label: S('gradient_radial') }]}
                onChange={(v) => { const g = a.value('backgroundGradient') as any; if (g && v) a.set({ backgroundGradient: { ...g, type: v === 'radial' ? 'radial' : undefined } }) }}
              />
            )}
          </div>
        </Row>
        <Row label={S('image')} stacked overridden={a.own('backgroundImage') !== undefined} onReset={() => a.set({ backgroundImage: undefined })}>
          <ImageInput value={(a.own('backgroundImage') as string) || ''} onChange={(v) => a.set({ backgroundImage: v || undefined })} />
        </Row>
        {!!a.value('backgroundImage') && (
          <div className="grid grid-cols-2 gap-2">
            <E a={a} k="backgroundSize" label={S('bg_size')} options={['cover', 'contain', 'auto']} labelFor={(v) => S(`bg_size_${v}`)} />
            <E a={a} k="backgroundPosition" label={S('bg_position')} options={['center', 'top', 'bottom', 'left', 'right']} labelFor={(v) => S(`bg_pos_${v}`)} />
          </div>
        )}
        <C a={a} k="overlayColor" label={S('overlay')} />
        {!!a.value('overlayColor') && (
          <Row label={S('overlay_opacity')} overridden={a.own('overlayOpacity') !== undefined} onReset={() => a.set({ overlayOpacity: undefined })}>
            <input type="range" min={0} max={95} value={(a.value('overlayOpacity') as number) ?? 40} onChange={(e) => a.set({ overlayOpacity: Number(e.target.value) })} className="w-full accent-neutral-900" aria-label={S('overlay_opacity')} />
          </Row>
        )}
        {node.type === 'section' && (
          <Row label={S('bg_video')} stacked overridden={a.own('backgroundVideo') !== undefined} onReset={() => a.set({ backgroundVideo: undefined })}>
            <ImageInput accept="video" value={(a.own('backgroundVideo') as string) || ''} onChange={(v) => a.set({ backgroundVideo: v || undefined })} />
          </Row>
        )}
      </Group>
      <Group title={S('border')} defaultOpen={false}>
        <div className="grid grid-cols-2 gap-2">
          <L a={a} k="borderWidth" label={S('border_width')} stacked />
          <L a={a} k="borderRadius" label={S('radius')} stacked />
        </div>
        <E a={a} k="borderStyle" label={S('border_style')} options={['solid', 'dashed', 'dotted', 'none']} labelFor={(v) => S(`border_${v}`)} />
        <C a={a} k="borderColor" label={S('border_color')} />
      </Group>
      <Group title={S('effects')} defaultOpen={false}>
        <E a={a} k="boxShadow" label={S('shadow')} options={['none', 'sm', 'md', 'lg', 'xl']} labelFor={(v) => S(`shadow_${v}`)} />
        <Row label={S('opacity')} overridden={a.own('opacity') !== undefined} onReset={() => a.set({ opacity: undefined })}>
          <input type="range" min={0} max={1} step={0.05} value={(a.value('opacity') as number) ?? 1} onChange={(e) => a.set({ opacity: Number(e.target.value) })} className="w-full accent-neutral-900" aria-label={S('opacity')} />
        </Row>
        {(node.type === 'image' || advanced) && <E a={a} k="aspectRatio" label={S('aspect')} options={['auto', '16/9', '4/3', '3/2', '1/1', '2/3', '3/4', '9/16', '21/9']} />}
        {node.type === 'image' && <E a={a} k="objectFit" label={S('fit')} options={['cover', 'contain']} labelFor={(v) => S(`fit_${v}`)} />}
        {advanced && <E a={a} k="overflow" label={S('overflow')} options={['visible', 'hidden']} labelFor={(v) => S(`overflow_${v}`)} />}
      </Group>
      <div className="px-4 py-3">
        <button type="button" onClick={() => setAdvanced((v) => !v)} className="text-[12px] font-medium text-neutral-500 hover:text-neutral-900" aria-expanded={advanced}>
          {advanced ? S('hide_advanced') : S('show_advanced')}
        </button>
      </div>
    </div>
  )
}

/* ── content ────────────────────────────────────────────────────────────── */

function IconPicker({ value, onChange }: { value: string | undefined; onChange: (v: string | undefined) => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const Icon = value ? LANDING_ICONS[value] : null
  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={() => setOpen((v) => !v)} className={`${FIELD} flex items-center gap-2 text-start`} aria-expanded={open}>
        {Icon ? <Icon size={16} weight="duotone" /> : <span className="h-4 w-4 rounded bg-neutral-100" />}
        <span className={value ? 'text-neutral-800' : 'text-neutral-400'}>{value || t('landingBuilder.style.none')}</span>
      </button>
      {open && (
        <div className="grid grid-cols-7 gap-1 rounded-lg bg-neutral-50 p-1.5 ring-1 ring-inset ring-neutral-200 max-h-48 overflow-y-auto">
          <button type="button" onClick={() => { onChange(undefined); setOpen(false) }} className="h-8 rounded-md text-[10px] text-neutral-400 hover:bg-white">—</button>
          {LANDING_ICON_NAMES.map((name) => {
            const I = LANDING_ICONS[name]
            return (
              <button key={name} type="button" title={name} aria-label={name} onClick={() => { onChange(name); setOpen(false) }} className={`flex h-8 items-center justify-center rounded-md hover:bg-white ${value === name ? 'bg-white ring-1 ring-sky-400' : ''}`}>
                <I size={16} weight="duotone" />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function StringList({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { t } = useTranslation()
  const list = Array.isArray(value) ? value : []
  return (
    <div className="flex flex-col gap-1.5">
      {list.map((s, i) => (
        <div key={i} className="flex gap-1.5">
          <TextInput value={s} onChange={(v) => onChange(list.map((x, j) => (j === i ? v : x)))} />
          <button type="button" onClick={() => onChange(list.filter((_, j) => j !== i))} aria-label={t('landingBuilder.actions.delete')} className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-lg text-neutral-400 hover:bg-rose-50 hover:text-rose-600">
            <Trash size={14} />
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...list, ''])} className="inline-flex h-8 items-center gap-1.5 self-start rounded-lg px-2 text-[12px] font-medium text-neutral-600 hover:bg-neutral-100">
        <Plus size={13} /> {t('landingBuilder.content.add_line')}
      </button>
    </div>
  )
}

function CoursePicker({ multi, value, onChange, kind = 'course' }: { multi: boolean; value: any; onChange: (v: any) => void; kind?: 'course' | 'path' }) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const { data } = useQuery({
    queryKey: ['landing-builder', kind, org?.slug, org?.id],
    queryFn: async () => {
      if (kind === 'path') {
        const r = await getOrgPaths(org.id, token)
        return (Array.isArray(r) ? r : []).map((p: any) => ({ uuid: p.path_uuid, name: p.name }))
      }
      const r = await getOrgCourses(org.slug, null, token, true)
      return (Array.isArray(r) ? r : []).map((c: any) => ({ uuid: c.course_uuid, name: c.name }))
    },
    enabled: !!org?.slug,
    staleTime: 60_000,
  })
  const list: { uuid: string; name: string }[] = data || []
  if (!multi) {
    return <Select value={value || ''} options={['', ...list.map((c) => c.uuid)]} onChange={onChange} labels={(v) => (v ? list.find((c) => c.uuid === v)?.name || v : t('landingBuilder.content.pick'))} />
  }
  const selected: string[] = Array.isArray(value) ? value : []
  return (
    <div className="flex flex-col gap-1 max-h-48 overflow-y-auto rounded-lg ring-1 ring-inset ring-neutral-200 p-1.5">
      {list.length === 0 && <span className="p-1.5 text-[12px] text-neutral-400">{t('landingBuilder.content.none_yet')}</span>}
      {list.map((c) => (
        <label key={c.uuid} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[12px] hover:bg-neutral-50">
          <input type="checkbox" checked={selected.includes(c.uuid)} onChange={(e) => onChange(e.target.checked ? [...selected, c.uuid] : selected.filter((u) => u !== c.uuid))} />
          <span className="truncate">{c.name}</span>
        </label>
      ))}
    </div>
  )
}

function OfferPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const { data } = useQuery({
    queryKey: ['landing-builder', 'offers', org?.id],
    queryFn: async () => {
      try {
        const r = await getPublicOffers(org.id)
        return r?.success && Array.isArray(r.data) ? r.data : []
      } catch {
        return []
      }
    },
    enabled: !!org?.id,
    staleTime: 60_000,
  })
  const list: any[] = data || []
  return <Select value={value || ''} options={['', ...list.map((o) => o.offer_uuid)]} onChange={onChange} labels={(v) => (v ? list.find((o) => o.offer_uuid === v)?.name || v : t('landingBuilder.content.no_offer'))} />
}

function NewsletterPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const { data, isError } = useQuery({
    queryKey: ['landing-builder', 'newsletters', org?.id],
    queryFn: async () => {
      const res = await fetch(`${getAPIUrl()}newsletter/lists?org_id=${org.id}`, { headers: { Authorization: `Bearer ${session?.data?.tokens?.access_token}` } })
      if (!res.ok) throw new Error(String(res.status))
      const json = await res.json()
      return (Array.isArray(json) ? json : []).filter((n: any) => n.public_signup !== false)
    },
    enabled: !!org?.id,
    retry: false,
    staleTime: 60_000,
  })
  if (isError) return <p className="text-[12px] text-neutral-500">{t('landingBuilder.content.newsletter_unavailable')}</p>
  const list: any[] = data || []
  return <Select value={value || ''} options={['', ...list.map((n) => n.slug)]} onChange={onChange} labels={(v) => (v ? list.find((n) => n.slug === v)?.name || v : t('landingBuilder.content.pick'))} />
}

function FieldEditor({ field, value, onChange }: { field: Field; value: any; onChange: (v: any) => void }) {
  const { t } = useTranslation()
  const opt = (v: string) => (v ? t(`landingBuilder.options.${v.replace(/[:/]/g, '_')}`, { defaultValue: v }) : t('landingBuilder.style.default'))
  switch (field.kind) {
    case 'text':
      return <TextInput value={value ?? ''} onChange={onChange} />
    case 'url':
      return <TextInput value={value ?? ''} onChange={onChange} placeholder="/courses, #pricing, https://" />
    case 'textarea':
      return <TextArea value={value ?? ''} onChange={onChange} />
    case 'markdown':
      return <TextArea value={value ?? ''} onChange={onChange} rows={8} />
    case 'code':
      return <TextArea value={value ?? ''} onChange={onChange} rows={8} mono placeholder="<div>…</div>" />
    case 'css':
      return <TextArea value={value ?? ''} onChange={onChange} rows={5} mono placeholder=".box { … }" />
    case 'datetime':
      return <TextInput type="datetime-local" value={(value ?? '').slice(0, 16)} onChange={onChange} />
    case 'image':
      return <ImageInput value={value ?? ''} onChange={onChange} />
    case 'video':
      return <ImageInput accept="video" value={value ?? ''} onChange={onChange} />
    case 'icon':
      return <IconPicker value={value} onChange={onChange} />
    case 'number':
      return <NumberInput value={value} min={field.min} max={field.max} step={field.step} onChange={onChange} />
    case 'toggle':
      return <Toggle checked={!!value} onChange={onChange} />
    case 'select':
      return <Select value={value === undefined || value === null ? '' : String(value)} options={field.options} onChange={(v) => onChange(field.key === 'level' ? Number(v) : v || undefined)} labels={opt} />
    case 'strings':
      return <StringList value={value} onChange={onChange} />
    case 'link':
      return (
        <div className="grid grid-cols-2 gap-1.5">
          <TextInput value={value?.label ?? ''} placeholder={t('landingBuilder.fields.label')} onChange={(v) => onChange({ ...(value || {}), label: v })} />
          <TextInput value={value?.href ?? ''} placeholder="/signup" onChange={(v) => onChange({ ...(value || {}), href: v })} />
        </div>
      )
    case 'courses':
      return <CoursePicker multi value={value} onChange={onChange} />
    case 'course':
      return <CoursePicker multi={false} value={value} onChange={onChange} />
    case 'paths':
      return <CoursePicker multi kind="path" value={value} onChange={onChange} />
    case 'offer':
      return <OfferPicker value={value} onChange={onChange} />
    case 'newsletter':
      return <NewsletterPicker value={value} onChange={onChange} />
    case 'items':
      return <ItemsEditor field={field} value={value} onChange={onChange} />
    default:
      return null
  }
}

function ItemsEditor({ field, value, onChange }: { field: Extract<Field, { kind: 'items' }>; value: any[]; onChange: (v: any[]) => void }) {
  const { t } = useTranslation()
  const list = Array.isArray(value) ? value : []
  const [open, setOpen] = React.useState<number | null>(list.length ? 0 : null)
  const [drag, setDrag] = React.useState<number | null>(null)
  const move = (from: number, to: number) => {
    if (from === to) return
    const next = [...list]
    const [x] = next.splice(from, 1)
    next.splice(to, 0, x)
    onChange(next)
    setOpen(to)
  }
  return (
    <div className="flex flex-col gap-1.5">
      {list.map((item, i) => (
        <div
          key={i}
          className={`rounded-lg ring-1 ring-inset ${open === i ? 'ring-neutral-300 bg-neutral-50/60' : 'ring-neutral-200'}`}
          onDragOver={(e) => drag !== null && e.preventDefault()}
          onDrop={() => drag !== null && move(drag, i)}
        >
          <div className="flex items-center gap-1 px-1.5 h-9">
            <span draggable onDragStart={() => setDrag(i)} onDragEnd={() => setDrag(null)} className="cursor-grab text-neutral-300 hover:text-neutral-500" aria-hidden>
              <DotsSixVertical size={14} />
            </span>
            <button type="button" onClick={() => setOpen(open === i ? null : i)} className="flex-1 min-w-0 truncate text-start text-[12px] font-medium text-neutral-700">
              {String(item?.[field.title] || item?.label || '') || `${t('landingBuilder.content.item')} ${i + 1}`}
            </button>
            <button type="button" onClick={() => onChange([...list.slice(0, i + 1), structuredClone(item), ...list.slice(i + 1)])} aria-label={t('landingBuilder.actions.duplicate')} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:bg-white hover:text-neutral-700">
              <Copy size={13} />
            </button>
            <button type="button" onClick={() => onChange(list.filter((_, j) => j !== i))} aria-label={t('landingBuilder.actions.delete')} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:bg-rose-50 hover:text-rose-600">
              <Trash size={13} />
            </button>
          </div>
          {open === i && (
            <div className="flex flex-col gap-2.5 px-2.5 pb-2.5">
              {field.fields.map((f) => (
                <Row key={f.key} label={t(`landingBuilder.fields.${f.key}`)} stacked={!['toggle', 'number', 'select'].includes(f.kind)}>
                  <FieldEditor field={f} value={item?.[f.key]} onChange={(v) => onChange(list.map((x, j) => (j === i ? { ...x, [f.key]: v } : x)))} />
                </Row>
              ))}
            </div>
          )}
        </div>
      ))}
      {list.length < (field.max ?? 24) && (
        <button type="button" onClick={() => { onChange([...list, field.make()]); setOpen(list.length) }} className="inline-flex h-8 items-center gap-1.5 self-start rounded-lg px-2 text-[12px] font-medium text-neutral-600 hover:bg-neutral-100">
          <Plus size={13} /> {t('landingBuilder.content.add_item')}
        </button>
      )}
    </div>
  )
}

// The main text of these elements can be rewritten with AI (metered: landing_copy).
const REWRITABLE: Partial<Record<string, string>> = { heading: 'text', text: 'text', richtext: 'markdown', button: 'label' }
const REWRITES = ['clearer', 'shorter', 'warmer', 'bolder'] as const

function CopyRewrite({ text, kind, onDone }: { text: string; kind: string; onDone: (v: string) => void }) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const [busy, setBusy] = React.useState<string | null>(null)
  const run = async (how: (typeof REWRITES)[number]) => {
    setBusy(how)
    try {
      const res = await rewriteLandingCopy(org.id, { text, instruction: t(`landingBuilder.ai.rewrite_instruction_${how}`), context: kind }, session?.data?.tokens?.access_token)
      if (res.text) onDone(res.text)
    } catch (e: any) {
      toast.error(e?.status === 402 || e?.status === 429 ? t('landingBuilder.ai.error_credits') : e?.status === 403 ? t('landingBuilder.ai.error_unavailable') : t('landingBuilder.ai.error'))
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {REWRITES.map((how) => (
        <AIButton key={how} size="sm" variant="soft" icon={how === 'clearer' ? undefined : null} loading={busy === how} disabled={!!busy} onClick={() => run(how)}>
          {t(`landingBuilder.ai.rewrite_${how}`)}
        </AIButton>
      ))}
    </div>
  )
}

function ContentPanel({ node, doc, onDoc, customCode }: { node: LandingNode; doc: LandingDoc; onDoc: InspectorProps['onDoc']; customCode: boolean }) {
  const { t } = useTranslation()
  const fields = FIELDS[node.type] || []
  if (node.type === 'html' && !customCode) {
    return <p className="p-4 text-[13px] text-neutral-500">{t('landingBuilder.content.custom_code_plan')}</p>
  }
  if (!fields.length) return <p className="p-4 text-[13px] text-neutral-500">{t('landingBuilder.content.nothing')}</p>
  const props = node.props || {}
  const visible = fields.filter((f) => {
    if (node.type === 'courses' && f.key === 'courseUuids') return props.source === 'selected'
    if (node.type === 'courses' && f.key === 'limit') return props.source === 'latest'
    if (node.type === 'paths' && f.key === 'pathUuids') return props.source === 'selected'
    return true
  })
  return (
    <div className="flex flex-col gap-3 p-4">
      {node.type === 'html' && <p className="rounded-lg bg-amber-50 px-2.5 py-2 text-[12px] text-amber-800 ring-1 ring-inset ring-amber-600/10">{t('landingBuilder.content.custom_code_note')}</p>}
      {visible.map((f) => (
        <Row key={f.key} label={t(`landingBuilder.fields.${f.key}`)} stacked={!['toggle', 'number', 'select'].includes(f.kind)}>
          <FieldEditor field={f} value={props[f.key]} onChange={(v) => onDoc(setProps(doc, node.id, { [f.key]: v }), `props:${node.id}:${f.key}`)} />
          {REWRITABLE[node.type] === f.key && typeof props[f.key] === 'string' && props[f.key].trim() && (
            <CopyRewrite text={props[f.key]} kind={node.type} onDone={(v) => onDoc(setProps(doc, node.id, { [f.key]: v }))} />
          )}
        </Row>
      ))}
    </div>
  )
}

/* ── settings ───────────────────────────────────────────────────────────── */

function SettingsPanel({ node, doc, onDoc, onAction, inSymbol }: { node: LandingNode; doc: LandingDoc; onDoc: InspectorProps['onDoc']; onAction: InspectorProps['onAction']; inSymbol: boolean }) {
  const { t } = useTranslation()
  const set = (patch: Partial<LandingNode>, key: string) => onDoc(updateNode(doc, node.id, (n) => {
    const next: any = { ...n, ...patch }
    for (const k of Object.keys(patch)) if ((patch as any)[k] === undefined) delete next[k]
    return next
  }), `settings:${node.id}:${key}`)
  const hidden = node.hidden || {}
  const anim = node.animation || { type: 'none' as const }
  return (
    <div className="flex flex-col">
      <Group title={t('landingBuilder.settings.element')}>
        <Row label={t('landingBuilder.settings.name')}>
          <TextInput value={node.name || ''} placeholder={t(`landingBuilder.elements.${node.type}`)} onChange={(v) => set({ name: v || undefined }, 'name')} />
        </Row>
        <Row label={t('landingBuilder.settings.anchor')}>
          <TextInput value={node.anchor || ''} placeholder="pricing" onChange={(v) => set({ anchor: v.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^-+/, '') || undefined }, 'anchor')} />
        </Row>
      </Group>
      <Group title={t('landingBuilder.settings.visibility')}>
        <Row label={t('landingBuilder.settings.show_to')}>
          <Select value={node.visibility || 'everyone'} options={['everyone', 'logged_in', 'logged_out']} onChange={(v) => set({ visibility: v === 'everyone' ? undefined : (v as any) }, 'visibility')} labels={(v) => t(`landingBuilder.settings.vis_${v}`)} />
        </Row>
        <Row label={t('landingBuilder.settings.hide_on')} stacked>
          <div className="grid grid-cols-3 gap-1.5">
            {([['desktop', Desktop], ['tablet', DeviceTablet], ['mobile', DeviceMobile]] as const).map(([k, Icon]) => (
              <button
                key={k}
                type="button"
                aria-pressed={!!hidden[k]}
                onClick={() => {
                  const next = { ...hidden, [k]: !hidden[k] }
                  set({ hidden: next.desktop || next.tablet || next.mobile ? next : undefined }, 'hidden')
                }}
                className={`flex h-8 items-center justify-center gap-1.5 rounded-lg text-[12px] font-medium ring-1 ring-inset ${hidden[k] ? 'bg-neutral-900 text-white ring-neutral-900' : 'bg-white text-neutral-600 ring-neutral-200 hover:bg-neutral-50'}`}
              >
                <Icon size={14} /> {t(`landingBuilder.breakpoints.${k}`)}
              </button>
            ))}
          </div>
        </Row>
        <div className="grid grid-cols-2 gap-2">
          <Row label={t('landingBuilder.settings.show_from')} stacked>
            <TextInput type="datetime-local" value={(node.schedule?.from || '').slice(0, 16)} onChange={(v) => set({ schedule: v || node.schedule?.until ? { ...node.schedule, from: v || undefined } : undefined }, 'schedule')} />
          </Row>
          <Row label={t('landingBuilder.settings.show_until')} stacked>
            <TextInput type="datetime-local" value={(node.schedule?.until || '').slice(0, 16)} onChange={(v) => set({ schedule: v || node.schedule?.from ? { ...node.schedule, until: v || undefined } : undefined }, 'schedule')} />
          </Row>
        </div>
      </Group>
      <Group title={t('landingBuilder.settings.animation')}>
        <Row label={t('landingBuilder.settings.entrance')}>
          <Select value={anim.type} options={['none', 'fade', 'slide-up', 'slide-in', 'zoom']} onChange={(v) => set({ animation: v === 'none' ? undefined : { ...anim, type: v as any } }, 'animation')} labels={(v) => t(`landingBuilder.settings.anim_${v.replace('-', '_')}`)} />
        </Row>
        {anim.type !== 'none' && (
          <div className="grid grid-cols-2 gap-2">
            <Row label={t('landingBuilder.settings.delay')} stacked>
              <NumberInput value={anim.delay ?? 0} min={0} max={2000} step={50} onChange={(v) => set({ animation: { ...anim, delay: v ?? 0 } }, 'animation')} />
            </Row>
            <Row label={t('landingBuilder.settings.duration')} stacked>
              <NumberInput value={anim.duration ?? 600} min={100} max={2000} step={50} onChange={(v) => set({ animation: { ...anim, duration: v ?? 600 } }, 'animation')} />
            </Row>
          </div>
        )}
        <p className="text-[11px] text-neutral-400">{t('landingBuilder.settings.motion_note')}</p>
      </Group>
      <Group title={t('landingBuilder.settings.component')}>
        {node.type === 'symbol' ? (
          <button type="button" onClick={() => onAction('detach')} className="inline-flex h-8 items-center gap-1.5 self-start rounded-lg bg-white px-2.5 text-[12px] font-medium text-neutral-700 ring-1 ring-inset ring-neutral-200 hover:bg-neutral-50">
            <LinkBreak size={14} /> {t('landingBuilder.settings.detach')}
          </button>
        ) : inSymbol ? (
          <p className="text-[12px] text-neutral-500">{t('landingBuilder.settings.in_symbol')}</p>
        ) : (
          <>
            <p className="text-[12px] text-neutral-500">{t('landingBuilder.settings.symbol_hint')}</p>
            <button type="button" onClick={() => onAction('symbol')} className="inline-flex h-8 items-center gap-1.5 self-start rounded-lg bg-white px-2.5 text-[12px] font-medium text-neutral-700 ring-1 ring-inset ring-neutral-200 hover:bg-neutral-50">
              <FilmStrip size={14} /> {t('landingBuilder.settings.make_symbol')}
            </button>
          </>
        )}
      </Group>
    </div>
  )
}

/* ── page / theme ───────────────────────────────────────────────────────── */

function PagePanel({ doc, onDoc, presets }: { doc: LandingDoc; onDoc: InspectorProps['onDoc']; presets: Record<string, any> }) {
  const { t } = useTranslation()
  const theme = doc.theme
  const setTheme = (patch: Partial<LandingTheme>, key: string) => onDoc({ ...doc, theme: { ...theme, ...patch } }, `theme:${key}`)
  const setColor = (k: keyof LandingTheme['colors'], v: string | undefined) => setTheme({ colors: { ...theme.colors, [k]: v || (k === 'primary' ? 'brand' : theme.colors[k]) } }, `color:${k}`)
  const applyPreset = (name: string) => {
    const p = presets?.[name]
    if (!p) return
    onDoc({ ...doc, theme: { ...theme, ...p, colors: { ...theme.colors, ...(p.colors || {}) }, fonts: { ...theme.fonts, ...(p.fonts || {}) } } }, 'theme:preset')
  }
  return (
    <div className="flex flex-col">
      <Group title={t('landingBuilder.theme.presets')}>
        <div className="grid grid-cols-4 gap-1.5">
          {Object.keys(PRESET_SWATCH).map((name) => (
            <button key={name} type="button" onClick={() => applyPreset(name)} className="group flex flex-col items-center gap-1 rounded-lg p-1.5 hover:bg-neutral-50" title={t(`landingBuilder.theme.preset_${name}`)}>
              <span className="flex h-7 w-full overflow-hidden rounded-md ring-1 ring-black/10">
                {PRESET_SWATCH[name].map((c, i) => <span key={i} className="flex-1" style={{ background: c }} />)}
              </span>
              <span className="text-[11px] text-neutral-600 truncate max-w-full">{t(`landingBuilder.theme.preset_${name}`)}</span>
            </button>
          ))}
        </div>
      </Group>
      <Group title={t('landingBuilder.theme.colors')}>
        <button
          type="button"
          onClick={() => onDoc({ ...doc, theme: { ...theme, colors: { ...theme.colors, primary: 'brand', secondary: 'brand', accent: 'brand' }, fonts: { heading: 'brand', body: 'brand' } } }, 'theme:org')}
          className="mb-1 inline-flex h-8 items-center gap-1.5 self-start rounded-lg bg-white px-2.5 text-[12px] font-medium text-neutral-700 ring-1 ring-inset ring-neutral-200 hover:bg-neutral-50"
          data-testid="theme-follow-org"
        >
          <Palette size={13} /> {t('landingBuilder.theme.follow_org')}
        </button>
        <Row label={t('landingBuilder.tokens.primary')}>
          <div className="flex items-center gap-1.5">
            <div className="flex-1 min-w-0"><ColorInput value={theme.colors.primary === 'brand' ? undefined : theme.colors.primary} placeholder={t('landingBuilder.theme.brand_color')} onChange={(v) => setColor('primary', v)} /></div>
          </div>
        </Row>
        {(['secondary', 'accent', 'text', 'muted', 'background', 'surface', 'border'] as const).map((k) => (
          <Row key={k} label={t(`landingBuilder.tokens.${k}`)}>
            <ColorInput value={theme.colors[k] === 'brand' ? undefined : theme.colors[k]} placeholder={theme.colors[k] === 'brand' ? t('landingBuilder.theme.brand_color') : undefined} allowNone={false} onChange={(v) => v && !v.startsWith('$') && setColor(k, v)} />
          </Row>
        ))}
      </Group>
      <Group title={t('landingBuilder.theme.typography')}>
        <Row label={t('landingBuilder.theme.heading_font')} stacked>
          <FontPicker value={theme.fonts.heading} onChange={(v) => setTheme({ fonts: { ...theme.fonts, heading: v } }, 'font-h')} extra={[{ value: 'brand', label: t('landingBuilder.theme.brand_font'), family: 'var(--lh-font-heading, inherit)' }]} ariaLabel={t('landingBuilder.theme.heading_font')} testid="theme-font-heading" />
        </Row>
        <Row label={t('landingBuilder.theme.body_font')} stacked>
          <FontPicker value={theme.fonts.body} onChange={(v) => setTheme({ fonts: { ...theme.fonts, body: v } }, 'font-b')} extra={[{ value: 'brand', label: t('landingBuilder.theme.brand_font'), family: 'var(--lh-font-body, inherit)' }]} ariaLabel={t('landingBuilder.theme.body_font')} testid="theme-font-body" />
        </Row>
        <Row label={t('landingBuilder.fonts.pairings')} stacked>
          <div className="grid grid-cols-2 gap-1.5">
            {FONT_PAIRINGS.map((pair) => {
              const on = theme.fonts.heading === pair.heading && theme.fonts.body === pair.body
              return (
                <button key={`${pair.heading}-${pair.body}`} type="button" onClick={() => setTheme({ fonts: { heading: pair.heading, body: pair.body } }, 'font-pair')} aria-pressed={on} title={`${pair.heading} + ${pair.body}`} className={`flex flex-col items-start rounded-lg px-2 py-1.5 text-start ring-1 ring-inset ${on ? 'bg-neutral-900 text-white ring-neutral-900' : 'bg-white text-neutral-800 ring-neutral-200 hover:bg-neutral-50'}`} data-testid="font-pairing">
                  <span className="w-full truncate text-[15px] leading-tight" style={{ fontFamily: fontStack(pair.heading, '--lh-font-heading'), fontWeight: 700 }}>{pair.heading}</span>
                  <span className={`w-full truncate text-[11px] ${on ? 'text-white/70' : 'text-neutral-500'}`} style={{ fontFamily: fontStack(pair.body, '--lh-font-body') }}>{pair.body}</span>
                </button>
              )
            })}
          </div>
        </Row>
        <Row label={t('landingBuilder.theme.heading_weight')}>
          <Select value={theme.headingWeight} options={['500', '600', '700', '800']} onChange={(v) => setTheme({ headingWeight: v as any }, 'hw')} labels={(v) => t(`landingBuilder.style.weight_${v}`)} />
        </Row>
      </Group>
      <Group title={t('landingBuilder.theme.shape')}>
        <Row label={t('landingBuilder.theme.radius')}>
          <Select value={theme.radius} options={['none', 'sm', 'md', 'lg', 'xl', 'full']} onChange={(v) => setTheme({ radius: v as any }, 'radius')} labels={(v) => t(`landingBuilder.theme.radius_${v}`)} />
        </Row>
        <Row label={t('landingBuilder.theme.buttons')}>
          <Select value={theme.buttonStyle} options={['solid', 'soft', 'outline', 'pill']} onChange={(v) => setTheme({ buttonStyle: v as any }, 'btn')} labels={(v) => t(`landingBuilder.theme.button_${v}`)} />
        </Row>
        <Row label={t('landingBuilder.theme.width')}>
          <Select value={theme.width} options={['normal', 'wide', 'full']} onChange={(v) => setTheme({ width: v as any }, 'width')} labels={(v) => t(`landingBuilder.theme.width_${v}`)} />
        </Row>
        <Row label={t('landingBuilder.theme.density')}>
          <Select value={theme.density} options={['compact', 'comfortable', 'spacious']} onChange={(v) => setTheme({ density: v as any }, 'density')} labels={(v) => t(`landingBuilder.theme.density_${v}`)} />
        </Row>
      </Group>
      <Group title={t('landingBuilder.theme.dark_title')} defaultOpen={!!theme.dark}>
        <p className="text-[12px] leading-relaxed text-neutral-500">{t('landingBuilder.theme.dark_hint')}</p>
        <Row label={t('landingBuilder.theme.dark_enable')}>
          <Toggle checked={!!theme.dark} onChange={(v) => onDoc({ ...doc, theme: { ...theme, dark: v ? { ...DEFAULT_DARK_COLORS } : undefined } }, 'theme:dark')} />
        </Row>
        {theme.dark && (['background', 'surface', 'text', 'muted', 'border'] as const).map((k) => (
          <Row key={k} label={t(`landingBuilder.tokens.${k}`)}>
            <ColorInput value={theme.dark![k]} allowNone={false} onChange={(v) => v && !v.startsWith('$') && onDoc({ ...doc, theme: { ...theme, dark: { ...theme.dark!, [k]: v } } }, `dark:${k}`)} />
          </Row>
        ))}
        {theme.dark && (
          <Row label={t('landingBuilder.tokens.primary')}>
            <ColorInput value={theme.dark.primary} placeholder={t('landingBuilder.theme.dark_same_primary')} onChange={(v) => onDoc({ ...doc, theme: { ...theme, dark: { ...theme.dark!, primary: v && !v.startsWith('$') ? v : undefined } } }, 'dark:primary')} />
          </Row>
        )}
      </Group>
      <Group title={t('landingBuilder.theme.page')}>
        <Row label={t('landingBuilder.theme.page_background')}>
          <ColorInput value={doc.page?.background} onChange={(v) => onDoc({ ...doc, page: { ...doc.page, background: v } }, 'page:bg')} />
        </Row>
        <Row label={t('landingBuilder.theme.page_title')} stacked>
          <TextInput value={doc.page?.title || ''} onChange={(v) => onDoc({ ...doc, page: { ...doc.page, title: v || undefined } }, 'page:title')} />
        </Row>
        <Row label={t('landingBuilder.theme.page_description')} stacked>
          <TextArea value={doc.page?.description || ''} onChange={(v) => onDoc({ ...doc, page: { ...doc.page, description: v || undefined } }, 'page:desc')} />
        </Row>
        <Row label={t('landingBuilder.theme.page_image')} stacked>
          <ImageInput value={doc.page?.image || ''} onChange={(v) => onDoc({ ...doc, page: { ...doc.page, image: v || undefined } }, 'page:image')} />
        </Row>
        <Row label={t('landingBuilder.theme.page_noindex')}>
          <Toggle checked={!!doc.page?.noindex} onChange={(v) => onDoc({ ...doc, page: { ...doc.page, noindex: v || undefined } }, 'page:noindex')} />
        </Row>
      </Group>
    </div>
  )
}

/* ── shell ──────────────────────────────────────────────────────────────── */

export default function Inspector(props: InspectorProps) {
  const { t } = useTranslation()
  const { node, doc, breakpoint, onDoc, onSelect, onAction } = props
  const [tab, setTab] = React.useState<'style' | 'content' | 'settings'>('content')
  const ancestors = node ? pathTo(doc, node.id) : []
  const inSymbol = !!node && !doc.root.some(function has(n): boolean { return n.id === node.id || (n.children || []).some(has) })
  if (!node) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-11 flex-none items-center gap-2 border-b border-neutral-100 px-4">
          <span className="text-[13px] font-semibold text-neutral-900">{t('landingBuilder.theme.title')}</span>
        </div>
        <div className="flex-1 overflow-y-auto"><PagePanel doc={doc} onDoc={onDoc} presets={props.presets} /></div>
      </div>
    )
  }
  const Icon = iconFor(node.type)
  return (
    <div className="flex h-full flex-col">
      <div className="flex-none border-b border-neutral-100 px-4 pt-3 pb-2.5 flex flex-col gap-2">
        {ancestors.length > 0 && (
          <nav className="flex flex-wrap items-center gap-1 text-[11px] text-neutral-400" aria-label={t('landingBuilder.inspector.path')}>
            {ancestors.map((a, i) => (
              <React.Fragment key={a.id}>
                {i > 0 && <span aria-hidden>/</span>}
                <button type="button" onClick={() => onSelect(a.id)} className="hover:text-neutral-700 truncate max-w-[90px]">{a.name || t(`landingBuilder.elements.${a.type}`)}</button>
              </React.Fragment>
            ))}
          </nav>
        )}
        <div className="flex items-center gap-2">
          <span className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-sky-50 text-sky-600"><Icon size={15} /></span>
          <span className="flex-1 min-w-0 truncate text-[13px] font-semibold text-neutral-900">{node.name || t(`landingBuilder.elements.${node.type}`)}</span>
          {node.type === 'section' && !inSymbol && (
            <button type="button" onClick={() => onAction('save')} title={t('landingBuilder.library.save_title')} aria-label={t('landingBuilder.library.save_title')} className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100" data-testid="save-section"><BookmarkSimple size={14} /></button>
          )}
          <button type="button" onClick={() => onAction('duplicate')} title={t('landingBuilder.actions.duplicate')} aria-label={t('landingBuilder.actions.duplicate')} className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100"><Copy size={14} /></button>
          <button type="button" onClick={() => onAction('delete')} title={t('landingBuilder.actions.delete')} aria-label={t('landingBuilder.actions.delete')} className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-neutral-500 hover:bg-rose-50 hover:text-rose-600"><Trash size={14} /></button>
        </div>
        <Pills value={tab} options={[{ key: 'content', label: t('landingBuilder.inspector.content') }, { key: 'style', label: t('landingBuilder.inspector.style') }, { key: 'settings', label: t('landingBuilder.inspector.settings') }]} onChange={(v) => v && setTab(v)} />
      </div>
      <div className="flex-1 overflow-y-auto">
        {tab === 'style' && <StylePanel key={node.id} node={node} doc={doc} breakpoint={breakpoint} onDoc={onDoc} />}
        {tab === 'content' && <ContentPanel node={node} doc={doc} onDoc={onDoc} customCode={props.customCode} />}
        {tab === 'settings' && <SettingsPanel node={node} doc={doc} onDoc={onDoc} onAction={onAction} inSymbol={inSymbol} />}
      </div>
    </div>
  )
}

