'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowSquareOut, CloudArrowUp, ImageSquare, Images, PaintBrush, Plus, SignIn, Trash } from '@phosphor-icons/react'
import { Button, ConfirmDialog, INPUT, SectionCard, SegmentedControl, Skeleton, TEXTAREA } from '@/design'
import { deleteOrgImage, updateOrgConfigSection, uploadOrgImage } from '@services/ee/platform/api'
import type { OrgConfigTheme, OrgConfiguration, OrgImageSlot } from '@services/ee/platform/types'
import { usePlatformMe, useAccessToken } from '@components/Admin/hooks'
import { QueryError } from '@components/Admin/Shared/AdminKit'
import { checkerStyle } from '@components/Dashboard/Pages/Org/OrgEditBranding/BrandingShared'
import { constructAcceptValue } from '@/lib/constants'
import { IMAGE_SLOTS, MAX_PREVIEWS, normalizeHex, sameValue, type ImageShape } from '../orgConfig'
import { CardSaveBar, ConfigRow, orgImageUrl, useConfigWrite, useDraft, useOrgConfiguration } from './configKit'

// Every image an org uses, shown at its real size on a choice of backdrop,
// with upload / replace / remove, then the brand theme and the sign-in page.
// Writes go through the org's own services on the API side.

const ACCEPT = constructAcceptValue(['png', 'jpg', 'gif', 'webp'])
type Backdrop = 'checker' | 'light' | 'dark'

const BACKDROP: Record<Backdrop, React.CSSProperties> = {
  checker: checkerStyle,
  light: { backgroundColor: '#ffffff' },
  dark: { backgroundColor: '#111113' },
}

// One box height for every slot so the grid lines up; images keep their own size inside.
const BOX: Record<ImageShape, string> = { wide: 'h-36', square: 'h-36', icon: 'h-36', banner: 'h-36' }

// Dashboard copy already names the three logos; the rest are console strings.
function slotText(t: (_k: string, _o?: Record<string, unknown>) => string, slot: OrgImageSlot) {
  switch (slot) {
    case 'logo':
      return { title: t('dashboard.organization.branding.logos.wide.title'), where: t('admin.org_cfg.where.logo') }
    case 'square_logo':
      return { title: t('dashboard.organization.branding.logos.square.title'), where: t('admin.org_cfg.where.square_logo') }
    case 'favicon':
      return { title: t('dashboard.organization.branding.logos.favicon.title'), where: t('admin.org_cfg.where.favicon') }
    default:
      return { title: t(`admin.org_cfg.slot.${slot}`), where: t(`admin.org_cfg.where.${slot}`) }
  }
}

// ─── one image ───────────────────────────────────────────────────────────────

function ImageTile({
  slot,
  shape,
  size,
  url,
  backdrop,
  canEdit,
  fallbackUrl,
  onUpload,
  onRemove,
}: {
  slot: OrgImageSlot
  shape: ImageShape
  size: string
  url: string | null
  backdrop: Backdrop
  canEdit: boolean
  fallbackUrl?: string | null
  onUpload: (_file: File) => Promise<unknown>
  onRemove: () => Promise<unknown>
}) {
  const { t } = useTranslation()
  const input = React.useRef<HTMLInputElement>(null)
  const [busy, setBusy] = React.useState(false)
  const [confirm, setConfirm] = React.useState(false)
  // Both are keyed by the image they describe, so a new image starts clean.
  const [loaded, setLoaded] = React.useState<{ src: string; w: number; h: number } | null>(null)
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null)
  const { title, where } = slotText(t, slot)
  const shown = url || fallbackUrl || null
  const dims = loaded && loaded.src === shown ? loaded : null
  const failed = !!shown && failedSrc === shown

  const pick = async (file?: File) => {
    if (!file) return
    setBusy(true)
    try {
      await onUpload(file)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col rounded-xl ring-1 ring-inset ring-neutral-200/80 overflow-hidden min-w-0" data-testid={`sa-image-${slot}`}>
      <div
        style={BACKDROP[backdrop]}
        className={`relative flex items-center justify-center ${BOX[shape]} border-b border-neutral-200/70 ${busy ? 'opacity-60' : ''}`}
      >
        {shown && !failed ? (
          // Real size: never upscaled, only scaled down to fit the box.
          <img
            src={shown}
            alt={title}
            onLoad={(e) => setLoaded({ src: shown, w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            onError={() => setFailedSrc(shown)}
            className={`max-w-[calc(100%-1.5rem)] max-h-[calc(100%-1.5rem)] object-contain ${url ? '' : 'opacity-50'}`}
          />
        ) : (
          <span className="flex flex-col items-center gap-1.5 text-neutral-400">
            <ImageSquare size={22} weight="duotone" />
            <span className="text-[11px] font-medium">{failed ? t('admin.org_cfg.image_missing') : t('admin.org_cfg.not_set')}</span>
          </span>
        )}
        {dims && url && (
          <span className="absolute bottom-1.5 end-1.5 rounded-md bg-neutral-900/75 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white" dir="ltr">
            {dims.w} × {dims.h}
          </span>
        )}
        {!url && fallbackUrl && (
          <span className="absolute top-1.5 start-1.5 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">
            {t('admin.org_cfg.uses_logo')}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2 p-3.5 flex-1">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-neutral-900">{title}</p>
          <p className="mt-0.5 text-xs text-neutral-500">{where}</p>
          <p className="mt-1 text-[11px] text-neutral-400" dir="auto">
            {t('admin.org_cfg.recommended', { size })}
          </p>
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
          {canEdit && (
            <Button size="sm" icon={<CloudArrowUp size={13} />} loading={busy} onClick={() => input.current?.click()}>
              {url ? t('admin.org_cfg.replace') : t('admin.org_cfg.upload')}
            </Button>
          )}
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
              aria-label={t('admin.org_cfg.open')}
              title={t('admin.org_cfg.open')}
            >
              <ArrowSquareOut size={15} />
            </a>
          )}
          {canEdit && url && (
            <button
              type="button"
              onClick={() => setConfirm(true)}
              className="ms-auto inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-rose-600 hover:bg-rose-50"
            >
              <Trash size={13} />
              {t('admin.org_cfg.remove')}
            </button>
          )}
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className="hidden"
        data-testid={`sa-image-input-${slot}`}
        onChange={(e) => {
          pick(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('admin.org_cfg.remove_title', { name: title.toLowerCase() })}
        message={t('admin.org_cfg.remove_desc')}
        confirmLabel={t('admin.org_cfg.remove')}
        onConfirm={async () => {
          setBusy(true)
          try {
            await onRemove()
          } finally {
            setBusy(false)
          }
        }}
      />
    </div>
  )
}

// ─── gallery ─────────────────────────────────────────────────────────────────

function Gallery({ cfg, orgId, canEdit, backdrop }: { cfg: OrgConfiguration; orgId: string; canEdit: boolean; backdrop: Backdrop }) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const write = useConfigWrite(orgId)
  const input = React.useRef<HTMLInputElement>(null)
  const [busy, setBusy] = React.useState(false)
  const files = cfg.images.preview || []
  const full = files.length >= MAX_PREVIEWS

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl ring-1 ring-inset ring-neutral-200/80 p-3.5" data-testid="sa-image-preview">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-neutral-900 flex items-center gap-2">
            <Images size={15} className="text-neutral-400" />
            {t('admin.org_cfg.slot.preview')}
            <span className="text-xs font-medium text-neutral-400 tabular-nums">
              {files.length}/{MAX_PREVIEWS}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-neutral-500">{t('admin.org_cfg.where.preview')}</p>
        </div>
        {canEdit && (
          <Button size="sm" icon={<Plus size={13} />} disabled={full} loading={busy} onClick={() => input.current?.click()} title={full ? t('admin.org_cfg.gallery_full') : undefined}>
            {t('admin.org_cfg.add_image')}
          </Button>
        )}
      </div>
      {files.length ? (
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {files.map((f) => (
            <div key={f} className="group relative aspect-video rounded-lg overflow-hidden ring-1 ring-inset ring-neutral-200/70" style={BACKDROP[backdrop]}>
              <img src={orgImageUrl('preview', cfg, f) ?? ''} alt="" className="h-full w-full object-contain" />
              {canEdit && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => write(() => deleteOrgImage(token, orgId, 'preview', f)))}
                  aria-label={t('admin.org_cfg.remove')}
                  className="absolute top-1.5 end-1.5 inline-flex h-7 w-7 items-center justify-center rounded-lg bg-neutral-900/70 text-white opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100"
                >
                  <Trash size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 rounded-lg bg-neutral-50 px-3 py-4 text-center text-xs text-neutral-400">{t('admin.org_cfg.not_set')}</p>
      )}
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) run(() => write(() => uploadOrgImage(token, orgId, 'preview', file), { success: t('admin.org_cfg.uploaded') }))
        }}
      />
    </div>
  )
}

function ImagesCard({ cfg, orgId, canEdit }: { cfg: OrgConfiguration; orgId: string; canEdit: boolean }) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const write = useConfigWrite(orgId)
  const [backdrop, setBackdrop] = React.useState<Backdrop>('checker')
  const logoUrl = orgImageUrl('logo', cfg, cfg.images.logo)

  return (
    <SectionCard
      icon={<ImageSquare size={18} />}
      title={t('admin.org_cfg.images.title')}
      description={t('admin.org_cfg.images.desc')}
      actions={
        <SegmentedControl
          value={backdrop}
          onChange={setBackdrop}
          ariaLabel={t('admin.org_cfg.backdrop')}
          options={[
            { key: 'checker', label: t('admin.org_cfg.bg.checker') },
            { key: 'light', label: t('admin.org_cfg.bg.light') },
            { key: 'dark', label: t('admin.org_cfg.bg.dark') },
          ]}
        />
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {IMAGE_SLOTS.map(({ slot, shape, size }) => (
          <ImageTile
            key={slot}
            slot={slot}
            shape={shape}
            size={size}
            backdrop={backdrop}
            canEdit={canEdit}
            url={orgImageUrl(slot, cfg, cfg.images[slot])}
            fallbackUrl={slot === 'square_logo' ? logoUrl : undefined}
            onUpload={(file) => write(() => uploadOrgImage(token, orgId, slot, file), { success: t('admin.org_cfg.uploaded') })}
            onRemove={() => write(() => deleteOrgImage(token, orgId, slot), { success: t('admin.org_cfg.removed') })}
          />
        ))}
      </div>
      <div className="mt-3">
        <Gallery cfg={cfg} orgId={orgId} canEdit={canEdit} backdrop={backdrop} />
      </div>
    </SectionCard>
  )
}

// ─── theme ───────────────────────────────────────────────────────────────────

const PRESETS = ['', 'classic', 'ocean', 'forest', 'midnight', 'sunset', 'orchid', 'slate', 'sand', 'atelier', 'harbor', 'grove', 'noir', 'ember', 'linen', 'citrus', 'glacier'] as const

type ThemeDraft = { color: string; font: string; theme: OrgConfigTheme }

function Choice<T extends string>({ value, options, onChange, disabled, label, prefix }: { value: T; options: readonly T[]; onChange: (_v: T) => void; disabled?: boolean; label: string; prefix: string }) {
  const { t } = useTranslation()
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-xs font-semibold text-neutral-700">{label}</p>
      {disabled ? (
        <span className="text-sm text-neutral-700">{t(`${prefix}.${value}`)}</span>
      ) : (
        <div className="overflow-x-auto -mx-1 px-1">
          <SegmentedControl value={value} onChange={onChange} ariaLabel={label} options={options.map((o) => ({ key: o, label: t(`${prefix}.${o}`) }))} />
        </div>
      )}
    </div>
  )
}

function ColorField({ value, onChange, disabled, label, id }: { value: string; onChange: (_v: string) => void; disabled?: boolean; label: string; id: string }) {
  const { t } = useTranslation()
  const valid = normalizeHex(value)
  return (
    <div className="flex items-center gap-2 max-w-xs">
      <input
        type="color"
        aria-label={t('dashboard.organization.branding.theming.color_field.picker', { label })}
        value={valid || '#ffffff'}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border border-neutral-200 bg-white p-0.5 disabled:cursor-not-allowed"
      />
      <input
        id={id}
        dir="ltr"
        value={value}
        disabled={disabled}
        placeholder="#1d4ed8"
        aria-label={t('dashboard.organization.branding.theming.color_field.hex', { label })}
        onChange={(e) => onChange(e.target.value)}
        className={`${INPUT} font-mono`}
      />
    </div>
  )
}

function ThemePreview({ cfg, draft }: { cfg: OrgConfiguration; draft: ThemeDraft }) {
  const { t } = useTranslation()
  const brand = normalizeHex(draft.color) || ''
  const accent = draft.theme.accent_mode === 'custom' ? normalizeHex(draft.theme.accent_color) || '' : draft.theme.accent_mode === 'brand' ? brand : ''
  const radius = draft.theme.radius === 'sharp' ? 4 : draft.theme.radius === 'round' ? 999 : 10
  const header =
    draft.theme.header_style === 'dark' ? '#111113' : draft.theme.header_style === 'white' || !brand ? '#ffffff' : draft.theme.header_style === 'glass' ? `${brand}22` : brand
  const darkHeader = draft.theme.header_style === 'dark' || (draft.theme.header_style === 'brand' && brand && !isLight(brand))
  const logo = orgImageUrl('logo', cfg, cfg.images.logo)
  const btn = accent || '#171717'
  return (
    <div className="rounded-xl overflow-hidden ring-1 ring-inset ring-neutral-200/80" aria-label={t('admin.org_cfg.theme.preview')} data-testid="sa-theme-preview">
      <div className="flex items-center gap-3 px-4 h-12" style={{ background: header, fontFamily: draft.theme.heading_font || draft.font || undefined }}>
        {logo ? <img src={logo} alt="" className="h-6 max-w-[120px] object-contain" /> : null}
        <span className="text-sm font-semibold truncate" style={{ color: darkHeader ? '#ffffff' : '#171717' }}>
          {cfg.org.name}
        </span>
      </div>
      {/* Inline colors only: this shows the org's light pages, in either console theme. */}
      <div
        className="p-4 flex flex-wrap items-center gap-3"
        style={{ background: brand && draft.theme.background === 'tint' ? `linear-gradient(${brand}0d, ${brand}0d), #ffffff` : '#ffffff', fontFamily: draft.font || undefined }}
      >
        <div
          className="flex-1 min-w-[140px] p-3"
          style={{
            background: '#ffffff',
            borderRadius: Math.min(radius, 16),
            boxShadow: draft.theme.card_style === 'shadow' ? '0 1px 3px rgba(0,0,0,0.12)' : undefined,
            border: draft.theme.card_style === 'border' ? '1px solid #e5e5e5' : '1px solid transparent',
          }}
        >
          <div className="h-2 w-20 rounded-full" style={{ background: '#e5e5e5' }} />
          <div className="mt-2 h-1.5 w-full rounded-full" style={{ background: '#f0f0f0' }}>
            <div className="h-1.5 w-2/3 rounded-full" style={{ background: btn }} />
          </div>
        </div>
        <span
          className="inline-flex h-8 items-center px-3.5 text-xs font-semibold"
          style={
            draft.theme.button_style === 'outline'
              ? { border: `1.5px solid ${btn}`, color: btn, borderRadius: radius }
              : draft.theme.button_style === 'soft'
                ? { background: `${btn}1f`, color: btn, borderRadius: radius }
                : { background: btn, color: isLight(btn) ? '#171717' : '#ffffff', borderRadius: radius }
          }
        >
          {t('dashboard.organization.branding.theming.preview.continue')}
        </span>
      </div>
    </div>
  )
}

function isLight(hex: string): boolean {
  const h = normalizeHex(hex)
  if (!h) return true
  const r = parseInt(h.slice(1, 3), 16)
  const g = parseInt(h.slice(3, 5), 16)
  const b = parseInt(h.slice(5, 7), 16)
  return (r * 299 + g * 587 + b * 114) / 1000 > 150
}

function ThemeCard({ cfg, orgId, canEdit }: { cfg: OrgConfiguration; orgId: string; canEdit: boolean }) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const write = useConfigWrite(orgId)
  const saved: ThemeDraft = React.useMemo(() => ({ color: cfg.general.color || '', font: cfg.general.font || '', theme: cfg.theme }), [cfg])
  const [draft, setDraft, discard] = useDraft(saved)
  const [saving, setSaving] = React.useState(false)
  const dirty = !sameValue(draft, saved)
  const set = (patch: Partial<OrgConfigTheme>) => setDraft((d) => ({ ...d, theme: { ...d.theme, ...patch, preset: patch.preset ?? (d.theme.preset ? 'custom' : '') } }))
  const colorError = normalizeHex(draft.color) === null || (draft.theme.accent_mode === 'custom' && !normalizeHex(draft.theme.accent_color))
  const p = 'dashboard.organization.branding.theming'
  const st = 'dashboard.organization.branding.studio'

  const save = async () => {
    setSaving(true)
    await write(() =>
      updateOrgConfigSection(token, orgId, 'theme', {
        color: normalizeHex(draft.color) ?? '',
        font: draft.font.trim(),
        theme: {
          ...draft.theme,
          accent_color: normalizeHex(draft.theme.accent_color) ?? '',
          heading_font: draft.theme.heading_font.trim(),
          ...(draft.theme.secondary_color !== undefined ? { secondary_color: normalizeHex(draft.theme.secondary_color) ?? '' } : {}),
        },
      })
    )
    setSaving(false)
  }

  return (
    <SectionCard icon={<PaintBrush size={18} />} title={t('admin.org_cfg.theme.title')} description={t('admin.org_cfg.theme.desc')}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="divide-y divide-neutral-100 min-w-0">
          <ConfigRow label={t(`${p}.colors.brand`)} hint={t('admin.org_cfg.theme.color_hint')}>
            <ColorField id="sa-brand-color" label={t(`${p}.colors.brand`)} value={draft.color} disabled={!canEdit} onChange={(color) => setDraft((d) => ({ ...d, color }))} />
          </ConfigRow>
          <ConfigRow label={t(`${p}.presets.title`)}>
            <select
              className={`${INPUT} max-w-xs`}
              value={PRESETS.includes(draft.theme.preset as (typeof PRESETS)[number]) ? draft.theme.preset : 'custom'}
              disabled={!canEdit}
              onChange={(e) => setDraft((d) => ({ ...d, theme: { ...d.theme, preset: e.target.value } }))}
            >
              {PRESETS.map((k) => (
                <option key={k || 'none'} value={k}>
                  {k ? t(`${p}.presets.${k}`) : t('admin.org_cfg.theme.no_preset')}
                </option>
              ))}
              {!PRESETS.includes(draft.theme.preset as (typeof PRESETS)[number]) && <option value="custom">{t(`${p}.accent.custom`)}</option>}
            </select>
          </ConfigRow>
          <div className="py-4 grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <Choice label={t(`${p}.accent.title`)} prefix={`${p}.accent`} value={draft.theme.accent_mode} options={['neutral', 'brand', 'custom'] as const} disabled={!canEdit} onChange={(accent_mode) => set({ accent_mode })} />
            {draft.theme.accent_mode === 'custom' && (
              <div className="min-w-0">
                <p className="mb-1.5 text-xs font-semibold text-neutral-700">{t(`${p}.accent.color`)}</p>
                <ColorField id="sa-accent-color" label={t(`${p}.accent.color`)} value={draft.theme.accent_color} disabled={!canEdit} onChange={(accent_color) => set({ accent_color })} />
              </div>
            )}
            <Choice label={t(`${p}.header.title`)} prefix={`${p}.header`} value={draft.theme.header_style} options={['brand', 'white', 'dark', 'glass'] as const} disabled={!canEdit} onChange={(header_style) => set({ header_style })} />
            <Choice label={t(`${p}.background.title`)} prefix={`${st}.background`} value={draft.theme.background} options={['tint', 'plain', 'pattern', 'grid', 'gradient'] as const} disabled={!canEdit} onChange={(background) => set({ background })} />
            <Choice label={t(`${p}.radius.title`)} prefix={`${st}.radius`} value={draft.theme.radius} options={['none', 'sharp', 'soft', 'round'] as const} disabled={!canEdit} onChange={(radius) => set({ radius })} />
            <Choice label={t(`${p}.buttons.title`)} prefix={`${p}.buttons`} value={draft.theme.button_style} options={['solid', 'soft', 'outline'] as const} disabled={!canEdit} onChange={(button_style) => set({ button_style })} />
            <Choice label={t(`${p}.cards.title`)} prefix={`${p}.cards`} value={draft.theme.card_style} options={['shadow', 'border', 'flat'] as const} disabled={!canEdit} onChange={(card_style) => set({ card_style })} />
            <Choice label={t(`${p}.density.title`)} prefix={`${p}.density`} value={draft.theme.density} options={['comfortable', 'compact'] as const} disabled={!canEdit} onChange={(density) => set({ density })} />
            {/* Theme studio options (shared schema with the org's Branding page). */}
            <Choice label={t(`${st}.colors.neutral`)} prefix={`${st}.neutral`} value={draft.theme.neutral || 'neutral'} options={['neutral', 'warm', 'cool'] as const} disabled={!canEdit} onChange={(neutral) => set({ neutral })} />
            <Choice label={t(`${st}.type.scale`)} prefix={`${st}.scale`} value={draft.theme.type_scale || 'default'} options={['compact', 'default', 'large'] as const} disabled={!canEdit} onChange={(type_scale) => set({ type_scale })} />
            <Choice label={t(`${st}.shape.button_shape`)} prefix={`${st}.button_shape`} value={draft.theme.button_shape || 'auto'} options={['auto', 'square', 'rounded', 'pill'] as const} disabled={!canEdit} onChange={(button_shape) => set({ button_shape })} />
            <Choice label={t(`${st}.shape.elevation`)} prefix={`${st}.elevation`} value={draft.theme.elevation || 'default'} options={['flat', 'default', 'lifted'] as const} disabled={!canEdit} onChange={(elevation) => set({ elevation })} />
            <Choice label={t(`${st}.layout.header_layout`)} prefix={`${st}.header_layout`} value={draft.theme.header_layout || 'standard'} options={['standard', 'centered', 'minimal'] as const} disabled={!canEdit} onChange={(header_layout) => set({ header_layout })} />
            <Choice label={t(`${st}.layout.footer`)} prefix={`${st}.footer`} value={draft.theme.footer_style || 'simple'} options={['simple', 'centered', 'bar'] as const} disabled={!canEdit} onChange={(footer_style) => set({ footer_style })} />
            <Choice label={t(`${st}.layout.images`)} prefix={`${st}.images`} value={draft.theme.image_style || 'default'} options={['default', 'rounded', 'framed', 'muted'] as const} disabled={!canEdit} onChange={(image_style) => set({ image_style })} />
            <Choice label={t(`${st}.layout.links`)} prefix={`${st}.links`} value={draft.theme.link_style || 'accent'} options={['accent', 'underline', 'subtle'] as const} disabled={!canEdit} onChange={(link_style) => set({ link_style })} />
            <Choice label={t(`${st}.dark.scheme`)} prefix={`${st}.scheme`} value={draft.theme.public_scheme || 'visitor'} options={['visitor', 'light'] as const} disabled={!canEdit} onChange={(public_scheme) => set({ public_scheme })} />
            <div className="min-w-0">
              <p className="mb-1.5 text-xs font-semibold text-neutral-700">{t(`${st}.colors.secondary`)}</p>
              <ColorField id="sa-secondary-color" label={t(`${st}.colors.secondary`)} value={draft.theme.secondary_color || ''} disabled={!canEdit} onChange={(secondary_color) => set({ secondary_color })} />
            </div>
          </div>
          <ConfigRow label={t(`${p}.type.body`)} hint={t('admin.org_cfg.theme.font_hint')}>
            <input className={`${INPUT} max-w-xs`} dir="ltr" value={draft.font} disabled={!canEdit} placeholder="Inter" onChange={(e) => setDraft((d) => ({ ...d, font: e.target.value }))} />
          </ConfigRow>
          <ConfigRow label={t(`${p}.type.heading`)}>
            <input
              className={`${INPUT} max-w-xs`}
              dir="ltr"
              value={draft.theme.heading_font}
              disabled={!canEdit}
              placeholder={t(`${p}.type.same_as_body`)}
              onChange={(e) => set({ heading_font: e.target.value })}
            />
          </ConfigRow>
        </div>
        <div className="lg:sticky lg:top-4 self-start space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{t('admin.org_cfg.theme.preview')}</p>
          <ThemePreview cfg={cfg} draft={draft} />
        </div>
      </div>
      <CardSaveBar
        dirty={dirty}
        saving={saving}
        onSave={save}
        onDiscard={discard}
        readOnly={!canEdit}
        error={colorError ? t('admin.org_cfg.theme.color_invalid') : null}
      />
    </SectionCard>
  )
}

// ─── sign-in page ────────────────────────────────────────────────────────────

function SignInCard({ cfg, orgId, canEdit }: { cfg: OrgConfiguration; orgId: string; canEdit: boolean }) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const write = useConfigWrite(orgId)
  const saved = React.useMemo(
    () => ({
      welcome_message: cfg.auth_branding.welcome_message || '',
      background_type: cfg.auth_branding.background_type === 'custom' ? 'custom' : 'gradient',
      text_color: cfg.auth_branding.text_color || 'light',
    }),
    [cfg]
  )
  const [draft, setDraft, discard] = useDraft(saved)
  const [saving, setSaving] = React.useState(false)
  const hasImage = !!cfg.images.auth_background
  const bgUrl = orgImageUrl('auth_background', cfg, cfg.images.auth_background)
  const square = orgImageUrl('square_logo', cfg, cfg.images.square_logo) || orgImageUrl('logo', cfg, cfg.images.logo)
  const a = 'dashboard.organization.auth_branding'

  const save = async () => {
    setSaving(true)
    await write(() => updateOrgConfigSection(token, orgId, 'auth_branding', draft))
    setSaving(false)
  }

  const light = draft.text_color === 'light'
  return (
    <SectionCard icon={<SignIn size={18} />} title={t('admin.org_cfg.signin.title')} description={t('admin.org_cfg.signin.desc')}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="divide-y divide-neutral-100 min-w-0">
          <ConfigRow label={t('dashboard.organization.branding.auth.message_title')} hint={t(`${a}.welcome_desc`)}>
            <textarea
              rows={2}
              maxLength={300}
              className={TEXTAREA}
              value={draft.welcome_message}
              disabled={!canEdit}
              placeholder={t(`${a}.default_welcome`)}
              onChange={(e) => setDraft((d) => ({ ...d, welcome_message: e.target.value }))}
            />
          </ConfigRow>
          <ConfigRow label={t('dashboard.organization.branding.auth.background_title')} hint={!hasImage ? t('admin.org_cfg.signin.needs_image') : undefined}>
            <SegmentedControl
              value={draft.background_type as 'gradient' | 'custom'}
              ariaLabel={t('dashboard.organization.branding.auth.background_title')}
              onChange={(v) => canEdit && (v === 'gradient' || hasImage) && setDraft((d) => ({ ...d, background_type: v }))}
              options={[
                { key: 'gradient', label: t(`${a}.bg_gradient`) },
                { key: 'custom', label: t('admin.org_cfg.signin.bg_image') },
              ]}
            />
          </ConfigRow>
          <ConfigRow label={t('dashboard.organization.branding.auth.text_title')}>
            <SegmentedControl
              value={draft.text_color as 'light' | 'dark'}
              ariaLabel={t('dashboard.organization.branding.auth.text_title')}
              onChange={(v) => canEdit && setDraft((d) => ({ ...d, text_color: v }))}
              options={[
                { key: 'light', label: t(`${a}.text_light`) },
                { key: 'dark', label: t(`${a}.text_dark`) },
              ]}
            />
          </ConfigRow>
        </div>
        <div className="self-start space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{t('admin.org_cfg.theme.preview')}</p>
          <div
            className="aspect-[4/3] rounded-xl overflow-hidden flex flex-col items-center justify-center gap-2 p-5 text-center"
            style={
              draft.background_type === 'custom' && bgUrl
                ? { backgroundImage: `url(${bgUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                : { background: 'linear-gradient(41.61deg, #202020 7.15%, #000000 90.96%)' }
            }
          >
            {square && <img src={square} alt="" className="h-12 w-12 rounded-xl object-contain p-1.5" style={{ background: '#ffffff' }} />}
            <p className="text-sm font-semibold" style={{ color: light ? '#ffffff' : '#171717' }}>
              {cfg.org.name}
            </p>
            <p className="text-xs" style={{ color: light ? 'rgba(255,255,255,0.75)' : 'rgba(23,23,23,0.7)' }}>
              {draft.welcome_message || t(`${a}.default_welcome`)}
            </p>
          </div>
        </div>
      </div>
      <CardSaveBar dirty={!sameValue(draft, saved)} saving={saving} onSave={save} onDiscard={discard} readOnly={!canEdit} />
    </SectionCard>
  )
}

export default function BrandingSection({ orgId }: { orgId: string }) {
  const { t } = useTranslation()
  const me = usePlatformMe()
  const q = useOrgConfiguration(orgId)
  const canEdit = me.can('orgs.update')

  if (q.isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-[420px] rounded-2xl" />
        <Skeleton className="h-[360px] rounded-2xl" />
      </div>
    )
  }
  if (q.error || !q.data) return <QueryError error={q.error} onRetry={() => q.refetch()} />
  const cfg = q.data
  return (
    <div className="space-y-5" data-testid="sa-branding">
      {!canEdit && <p className="text-sm text-neutral-500">{t('admin.org.settings_readonly')}</p>}
      <ImagesCard cfg={cfg} orgId={orgId} canEdit={canEdit} />
      <ThemeCard cfg={cfg} orgId={orgId} canEdit={canEdit} />
      <SignInCard cfg={cfg} orgId={orgId} canEdit={canEdit} />
    </div>
  )
}
