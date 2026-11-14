'use client'
/** Builder dialogs: templates, publish (with the diff), history, AI, pages, messages. */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  ArrowCounterClockwise, ArrowsClockwise, ClockCounterClockwise, FilePlus, Layout, Plus, Rocket,
  Sparkle, Tray, Trash, Warning,
} from '@phosphor-icons/react'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { Button, Chip, EmptyState, formatRelative } from '@components/Dashboard/Shared/DashKit/DashKit'
import { AIButton } from '@components/Objects/AI/AIBrand'
import PlanBadge from '@components/Dashboard/Shared/PlanRestricted/PlanBadge'
import {
  deleteLandingSubmission, getLandingSubmissions, getLandingVersion, getLandingVersions, getTemplatePreview, landingQueryKeys,
  type LandingCaps, type LandingTemplate, type LandingVersion, type TemplatePalette,
} from '@services/landing/landing'
import type { LandingDoc } from '../model/types'
import { asDoc } from '../model/types'
import { diffDocs, isEmptyDiff, type DocDiff } from '../model/diff'
import LandingRenderer from '../render/LandingRenderer'
import TemplateGallery from '../gallery/TemplateGallery'
import { AREA, FIELD } from './controls'

function Preview({ doc, orgslug, org, height = 360, scale = 0.42 }: { doc: LandingDoc | null; orgslug: string; org: any; height?: number; scale?: number }) {
  return (
    <div className="relative overflow-hidden rounded-xl bg-white ring-1 ring-inset ring-neutral-200" style={{ height }}>
      {doc ? (
        <div className="pointer-events-none absolute start-0 top-0 origin-top-left rtl:origin-top-right" style={{ width: `${100 / scale}%`, transform: `scale(${scale})` }}>
          <LandingRenderer doc={doc} mode="thumbnail" orgslug={orgslug} org={org} />
        </div>
      ) : (
        <div className="absolute inset-0 animate-pulse bg-neutral-50" />
      )}
    </div>
  )
}

/* ── templates ──────────────────────────────────────────────────────────── */

export function TemplatePicker({ open, onClose, templates, token, orgslug, org, onPick, onBlank, onAI }: {
  open: boolean
  onClose: () => void
  templates: LandingTemplate[]
  orgId: number
  token?: string
  orgslug: string
  org: any
  onPick: (id: string, palette: TemplatePalette) => void
  onBlank: () => void
  onAI?: () => void
}) {
  const { t } = useTranslation()
  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('[data-testid=template-preview]') && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  // A full-screen sheet (not a dialog box): the gallery needs the room, and
  // its own full-size preview opens above it.
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[#f8f8f8]" role="dialog" aria-modal="true" aria-label={t('landingBuilder.templates.title')} data-testid="template-picker">
      <div className="flex flex-none items-center gap-3 border-b border-neutral-200/80 bg-white px-4 py-3 sm:px-6">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-600"><Layout size={18} /></span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold text-neutral-900">{t('landingBuilder.templates.title')}</div>
          <div className="truncate text-[12.5px] text-neutral-500">{t('landingBuilder.templates.subtitle')}</div>
        </div>
        <Button variant="secondary" size="sm" onClick={onClose} data-testid="template-picker-close">{t('landingBuilder.actions.close')}</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-6 px-4 py-6 sm:px-8">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:max-w-2xl">
            <button type="button" onClick={onBlank} className="flex items-center gap-3 rounded-xl bg-white p-3 text-start nice-shadow hover:bg-neutral-50" data-testid="template-blank">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600"><FilePlus size={18} /></span>
              <span><span className="block text-[13px] font-semibold text-neutral-900">{t('landingBuilder.templates.blank')}</span><span className="block text-[12px] text-neutral-500">{t('landingBuilder.templates.blank_hint')}</span></span>
            </button>
            {onAI && (
              <button type="button" onClick={onAI} className="flex items-center gap-3 rounded-xl bg-white p-3 text-start nice-shadow hover:bg-neutral-50">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-violet-50 text-violet-600"><Sparkle size={18} weight="duotone" /></span>
                <span><span className="block text-[13px] font-semibold text-neutral-900">{t('landingBuilder.templates.ai')}</span><span className="block text-[12px] text-neutral-500">{t('landingBuilder.templates.ai_hint')}</span></span>
              </button>
            )}
          </div>
          <TemplateGallery templates={templates} org={org} orgslug={orgslug} token={token} onUse={(id, palette) => onPick(id, palette)} useLabel={t('landingBuilder.gallery.use_here')} />
        </div>
      </div>
    </div>
  )
}

/* ── publish ────────────────────────────────────────────────────────────── */

export function DiffList({ diff }: { diff: DocDiff }) {
  const { t } = useTranslation()
  const tone = { added: 'emerald', removed: 'rose', changed: 'sky', moved: 'neutral' } as const
  if (isEmptyDiff(diff)) return <p className="text-[13px] text-neutral-500">{t('landingBuilder.publish.no_changes')}</p>
  return (
    <div className="flex max-h-72 flex-col divide-y divide-neutral-100 overflow-y-auto rounded-xl ring-1 ring-inset ring-neutral-200">
      {diff.theme && (
        <div className="flex items-center gap-2 px-3 py-2 text-[13px]"><Chip tone="violet">{t('landingBuilder.diff.changed')}</Chip><span className="text-neutral-700">{t('landingBuilder.diff.theme')}</span></div>
      )}
      {diff.page && (
        <div className="flex items-center gap-2 px-3 py-2 text-[13px]"><Chip tone="violet">{t('landingBuilder.diff.changed')}</Chip><span className="text-neutral-700">{t('landingBuilder.diff.page')}</span></div>
      )}
      {diff.changes.slice(0, 60).map((c) => (
        <div key={`${c.kind}-${c.id}`} className="flex items-center gap-2 px-3 py-2 text-[13px]">
          <Chip tone={tone[c.kind]}>{t(`landingBuilder.diff.${c.kind}`)}</Chip>
          <span className="text-neutral-400">{t(`landingBuilder.elements.${c.type}`)}</span>
          <span className="min-w-0 flex-1 truncate text-neutral-800">{c.label === c.type ? '' : c.label}</span>
          {c.parts && <span className="text-[11px] text-neutral-400">{c.parts.map((p) => t(`landingBuilder.diff.part_${p}`)).join(', ')}</span>}
        </div>
      ))}
      {diff.changes.length > 60 && <div className="px-3 py-2 text-[12px] text-neutral-500">{t('landingBuilder.diff.more', { count: diff.changes.length - 60 })}</div>}
    </div>
  )
}

export function PublishDialog({ open, onClose, draft, live, onPublish }: {
  open: boolean
  onClose: () => void
  draft: LandingDoc
  live: LandingDoc | null
  onPublish: (opts: { label: string }) => Promise<void>
}) {
  const { t } = useTranslation()
  const [label, setLabel] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const diff = React.useMemo(() => diffDocs(live, draft), [live, draft])
  const run = async () => {
    setBusy(true)
    try {
      await onPublish({ label })
      onClose()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={(o) => !o && onClose()}
      size="md"
      icon={<Rocket size={18} />}
      dialogTitle={t('landingBuilder.publish.title')}
      dialogDescription={live ? t('landingBuilder.publish.subtitle_update') : t('landingBuilder.publish.subtitle_first')}
      dialogContent={
        <div className="flex flex-col gap-4">
          <div>
            <div className="mb-2 text-[12px] font-medium text-neutral-500">{t('landingBuilder.publish.changes')}</div>
            <DiffList diff={diff} />
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-neutral-500">{t('landingBuilder.publish.label')}</span>
            <input className={FIELD} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('landingBuilder.publish.label_placeholder')} maxLength={120} />
          </label>
        </div>
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('landingBuilder.actions.cancel')}</Button>
          <Button variant="primary" icon={<Rocket size={14} />} loading={busy} onClick={run} data-testid="publish-confirm">{t('landingBuilder.publish.confirm')}</Button>
        </>
      }
    />
  )
}

/* ── history ────────────────────────────────────────────────────────────── */

export function HistoryDialog({ open, onClose, pageUuid, token, orgslug, org, current, onRestore, onSaveVariant }: {
  open: boolean
  onClose: () => void
  pageUuid: string
  token?: string
  orgslug: string
  org: any
  current: LandingDoc
  onRestore: (versionUuid: string) => Promise<void>
  onSaveVariant: (label: string) => Promise<void>
}) {
  const { t, i18n } = useTranslation()
  const { data: versions, refetch } = useQuery({ queryKey: landingQueryKeys.versions(pageUuid), queryFn: () => getLandingVersions(pageUuid, token), enabled: open && !!pageUuid })
  const [selected, setSelected] = React.useState<string | null>(null)
  // Fresh every time it opens: saves, restores and Atlas add versions meanwhile.
  React.useEffect(() => {
    if (open) refetch()
  }, [open, refetch])
  const [variant, setVariant] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const list: LandingVersion[] = Array.isArray(versions) ? versions : []
  const active = selected || list[0]?.version_uuid || null
  const { data: version } = useQuery({ queryKey: ['landing', 'version', active], queryFn: () => getLandingVersion(active!, token), enabled: open && !!active })
  const doc = version ? asDoc(version.doc) : null
  const diff = React.useMemo(() => (doc ? diffDocs(current, doc) : null), [doc, current])
  const tone: Record<string, any> = { publish: 'emerald', atlas: 'violet', variant: 'sky', restore: 'amber', convert: 'amber', template: 'neutral', checkpoint: 'neutral' }
  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={(o) => !o && onClose()}
      size="xl"
      icon={<ClockCounterClockwise size={18} />}
      dialogTitle={t('landingBuilder.history.title')}
      dialogDescription={t('landingBuilder.history.subtitle')}
      dialogContent={
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[280px_minmax(0,1fr)]">
          <div className="flex flex-col gap-3 min-w-0">
            <div className="flex gap-1.5">
              <input className={FIELD} value={variant} onChange={(e) => setVariant(e.target.value)} placeholder={t('landingBuilder.history.variant_placeholder')} maxLength={120} />
              <Button size="sm" variant="secondary" icon={<Plus size={13} />} disabled={!variant.trim()} onClick={async () => { await onSaveVariant(variant.trim()); setVariant(''); refetch() }}>{t('landingBuilder.history.save_variant')}</Button>
            </div>
            <div className="flex max-h-[420px] flex-col gap-1 overflow-y-auto" data-testid="history-list">
              {list.length === 0 && <p className="p-2 text-[13px] text-neutral-500">{t('landingBuilder.history.empty')}</p>}
              {list.map((v) => (
                <button key={v.version_uuid} type="button" onClick={() => setSelected(v.version_uuid)} className={`flex flex-col gap-1 rounded-lg px-3 py-2 text-start ${active === v.version_uuid ? 'bg-sky-50 ring-1 ring-inset ring-sky-200' : 'hover:bg-neutral-50'}`}>
                  <span className="flex items-center gap-2">
                    <Chip tone={tone[v.kind] || 'neutral'}>{t(`landingBuilder.history.kind_${v.kind}`)}</Chip>
                    <span className="text-[11px] text-neutral-400">{formatRelative(v.creation_date, i18n.language)}</span>
                  </span>
                  <span className="truncate text-[13px] text-neutral-800">{v.label || t(`landingBuilder.history.kind_${v.kind}`)}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            <Preview doc={doc} orgslug={orgslug} org={org} height={340} scale={0.36} />
            {diff && (
              <div>
                <div className="mb-1.5 text-[12px] font-medium text-neutral-500">{t('landingBuilder.history.diff_title')}</div>
                <DiffList diff={diff} />
              </div>
            )}
          </div>
        </div>
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('landingBuilder.actions.close')}</Button>
          <Button variant="primary" icon={<ArrowCounterClockwise size={14} />} disabled={!active} loading={busy} onClick={async () => { if (!active) return; setBusy(true); try { await onRestore(active); onClose() } finally { setBusy(false) } }} data-testid="history-restore">
            {t('landingBuilder.history.restore')}
          </Button>
        </>
      }
    />
  )
}

/* ── AI ─────────────────────────────────────────────────────────────────── */

export function AIDialog({ open, onClose, onGenerate }: { open: boolean; onClose: () => void; onGenerate: (brief: string) => Promise<void> }) {
  const { t } = useTranslation()
  const [brief, setBrief] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={(o) => !o && !busy && onClose()}
      size="md"
      icon={<Sparkle size={18} weight="duotone" className="text-violet-600" />}
      dialogTitle={t('landingBuilder.ai.title')}
      dialogDescription={t('landingBuilder.ai.subtitle')}
      dialogContent={
        <div className="flex flex-col gap-3">
          <textarea className={AREA} rows={6} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder={t('landingBuilder.ai.placeholder')} maxLength={3000} />
          <p className="text-[12px] text-neutral-500">{t('landingBuilder.ai.note')}</p>
          {error && <p className="flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-700 ring-1 ring-inset ring-rose-600/10"><Warning size={14} className="mt-0.5 flex-none" />{error}</p>}
        </div>
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>{t('landingBuilder.actions.cancel')}</Button>
          <AIButton loading={busy} disabled={brief.trim().length < 3} onClick={async () => {
            setBusy(true)
            setError('')
            try {
              await onGenerate(brief.trim())
              onClose()
            } catch (e: any) {
              setError(e?.status === 402 || e?.status === 429 ? t('landingBuilder.ai.error_credits') : e?.status === 403 ? t('landingBuilder.ai.error_unavailable') : t('landingBuilder.ai.error'))
            } finally {
              setBusy(false)
            }
          }}>
            {t('landingBuilder.ai.generate')}
          </AIButton>
        </>
      }
    />
  )
}

/* ── pages ──────────────────────────────────────────────────────────────── */

export function NewPageDialog({ open, onClose, caps, templates, onCreate, initialTemplate = '', hasNav = true }: {
  open: boolean
  onClose: () => void
  caps: LandingCaps | undefined
  templates: LandingTemplate[]
  onCreate: (body: { slug: string; title: string; template: string | null; palette: TemplatePalette; add_to_nav: boolean }) => Promise<void>
  /** Preselected template (from the gallery). */
  initialTemplate?: string
  /** Offer "add to the home page navigation" (the home page has a navbar). */
  hasNav?: boolean
}) {
  const { t } = useTranslation()
  const [title, setTitle] = React.useState('')
  const [slug, setSlug] = React.useState('')
  const [template, setTemplate] = React.useState(initialTemplate)
  const [palette, setPalette] = React.useState<TemplatePalette>('template')
  const [addToNav, setAddToNav] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => {
    if (open) setTemplate(initialTemplate)
  }, [open, initialTemplate])
  const allowed = !!caps?.extra_pages
  const auto = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={(o) => !o && onClose()}
      size="sm"
      icon={<FilePlus size={18} />}
      dialogTitle={t('landingBuilder.pages.new_title')}
      dialogDescription={t('landingBuilder.pages.new_subtitle')}
      dialogContent={
        allowed ? (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5"><span className="text-[12px] font-medium text-neutral-500">{t('landingBuilder.pages.page_title')}</span>
              <input className={FIELD} value={title} onChange={(e) => { setTitle(e.target.value); if (!slug || slug === auto(title)) setSlug(auto(e.target.value)) }} placeholder={t('landingBuilder.pages.title_placeholder')} data-testid="new-page-title" />
            </label>
            <label className="flex flex-col gap-1.5"><span className="text-[12px] font-medium text-neutral-500">{t('landingBuilder.pages.address')}</span>
              <div className="flex items-center gap-1.5"><span className="text-[13px] text-neutral-400">/p/</span><input className={FIELD} value={slug} onChange={(e) => setSlug(auto(e.target.value))} placeholder="about" data-testid="new-page-slug" /></div>
            </label>
            <label className="flex flex-col gap-1.5"><span className="text-[12px] font-medium text-neutral-500">{t('landingBuilder.pages.start_from')}</span>
              <select className={FIELD} value={template} onChange={(e) => setTemplate(e.target.value)}>
                <option value="">{t('landingBuilder.templates.blank')}</option>
                {templates.filter((tpl) => !tpl.legacy).map((tpl) => <option key={tpl.id} value={tpl.id}>{t(`landingBuilder.templates.${tpl.id}.name`, { defaultValue: tpl.name })}</option>)}
              </select>
            </label>
            {template && (
              <label className="flex items-center gap-2 text-[13px] text-neutral-700">
                <input type="checkbox" checked={palette === 'org'} onChange={(e) => setPalette(e.target.checked ? 'org' : 'template')} data-testid="new-page-org-palette" />
                {t('landingBuilder.gallery.use_my_brand')}
              </label>
            )}
            {hasNav && (
              <label className="flex items-center gap-2 text-[13px] text-neutral-700">
                <input type="checkbox" checked={addToNav} onChange={(e) => setAddToNav(e.target.checked)} data-testid="new-page-add-nav" />
                {t('landingBuilder.pages.add_to_nav')}
              </label>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3">
            <PlanBadge currentPlan={(caps?.plan as any) || 'free'} requiredPlan={(caps?.extra_pages_plan as any) || 'standard'} alwaysShow noMargin />
            <p className="text-[13px] text-neutral-600">{t('landingBuilder.pages.plan_gate', { plan: t(`landingBuilder.plans.${caps?.extra_pages_plan || 'standard'}`) })}</p>
          </div>
        )
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('landingBuilder.actions.cancel')}</Button>
          {allowed && <Button variant="primary" loading={busy} disabled={!slug} onClick={async () => { setBusy(true); try { await onCreate({ slug, title: title || slug, template: template || null, palette, add_to_nav: hasNav && addToNav }); onClose() } finally { setBusy(false) } }} data-testid="new-page-create">{t('landingBuilder.pages.create')}</Button>}
        </>
      }
    />
  )
}

/* ── conflict ───────────────────────────────────────────────────────────── */

export function ConflictDialog({ open, onReload, onOverwrite }: { open: boolean; onReload: () => void; onOverwrite: () => void }) {
  const { t } = useTranslation()
  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={() => {}}
      preventClose
      size="sm"
      icon={<ArrowsClockwise size={18} />}
      dialogTitle={t('landingBuilder.conflict.title')}
      dialogDescription={t('landingBuilder.conflict.text')}
      dialogContent={<p className="text-[13px] text-neutral-600">{t('landingBuilder.conflict.detail')}</p>}
      footer={
        <>
          <Button variant="secondary" onClick={onOverwrite} data-testid="conflict-overwrite">{t('landingBuilder.conflict.overwrite')}</Button>
          <Button variant="primary" onClick={onReload} data-testid="conflict-reload">{t('landingBuilder.conflict.reload')}</Button>
        </>
      }
    />
  )
}

/* ── form messages ──────────────────────────────────────────────────────── */

export function SubmissionsDialog({ open, onClose, orgId, token }: { open: boolean; onClose: () => void; orgId: number; token?: string }) {
  const { t, i18n } = useTranslation()
  const { data, refetch, isLoading } = useQuery({ queryKey: landingQueryKeys.submissions(orgId), queryFn: () => getLandingSubmissions(orgId, token), enabled: open && !!orgId })
  const items = data?.items ?? []
  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      icon={<Tray size={18} />}
      dialogTitle={t('landingBuilder.submissions.title')}
      dialogDescription={t('landingBuilder.submissions.subtitle')}
      dialogContent={
        isLoading ? (
          <div className="h-40 animate-pulse rounded-xl bg-neutral-50" />
        ) : items.length === 0 ? (
          <EmptyState icon={<Tray size={22} />} title={t('landingBuilder.submissions.empty_title')} description={t('landingBuilder.submissions.empty_text')} />
        ) : (
          <div className="flex max-h-[460px] flex-col divide-y divide-neutral-100 overflow-y-auto rounded-xl ring-1 ring-inset ring-neutral-200">
            {items.map((s) => (
              <div key={s.submission_uuid} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-neutral-400">{formatRelative(s.creation_date, i18n.language)}</div>
                  <dl className="mt-1 grid grid-cols-[100px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
                    {Object.entries(s.data || {}).map(([k, v]) => (
                      <React.Fragment key={k}>
                        <dt className="truncate text-neutral-500">{k}</dt>
                        <dd className="whitespace-pre-line break-words text-neutral-800">{String(v)}</dd>
                      </React.Fragment>
                    ))}
                  </dl>
                </div>
                <button type="button" aria-label={t('landingBuilder.actions.delete')} onClick={async () => { await deleteLandingSubmission(orgId, s.submission_uuid, token); refetch(); toast.success(t('landingBuilder.submissions.deleted')) }} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:bg-rose-50 hover:text-rose-600">
                  <Trash size={14} />
                </button>
              </div>
            ))}
          </div>
        )
      }
    />
  )
}

