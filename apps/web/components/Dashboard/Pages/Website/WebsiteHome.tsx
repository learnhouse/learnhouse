'use client'
/**
 * The Website area (/dash/website): the org's public site as a product of
 * its own. What visitors see right now, publish state and pages, the theme at
 * a glance, and the template gallery, with the page builder one click away.
 */
import React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  ArrowRight, ArrowSquareOut, Copy, File, FilePlus, Globe, House, LinkSimple, Palette, PencilSimple, Rocket, SquaresFour, Swatches,
} from '@phosphor-icons/react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { Button, Chip, DashPage, DashPageHeader, Modal, SectionCard, buttonClass, formatRelative } from '@/design'
import { getUriWithOrg } from '@services/config/config'
import {
  applyLandingTemplate, createLandingPage, getLandingPage, getLandingSite, getLandingTemplates, getPublicLandingPage, landingQueryKeys,
  type LandingPageSummary, type TemplatePalette,
} from '@services/landing/landing'
import { asDoc } from '@components/LandingPages/model/types'
import TemplateGallery, { ScaledPage } from '@components/LandingPages/gallery/TemplateGallery'
import { NewPageDialog } from '@components/LandingPages/builder/dialogs'
import { readOrgTheme, resolveAccent } from '@/lib/theme/orgTheme'

const BUILDER = '/dash/org/landing-builder'

function StatusChip({ page }: { page: LandingPageSummary }) {
  const { t } = useTranslation()
  if (page.published) {
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <Chip tone="emerald">{t('landingBuilder.card.live', { version: page.published_version })}</Chip>
        {page.has_unpublished_changes && <Chip tone="amber">{t('landingBuilder.card.unpublished_changes')}</Chip>}
      </span>
    )
  }
  return page.is_home ? <Chip tone="sky">{t('landingBuilder.card.default_home')}</Chip> : <Chip tone="neutral">{t('landingBuilder.card.draft')}</Chip>
}

function PageRow({ page, orgslug }: { page: LandingPageSummary; orgslug: string }) {
  const { t, i18n } = useTranslation()
  const path = page.is_home ? '/' : `/p/${page.slug}`
  const edited = formatRelative(page.draft_updated_at, i18n.language)
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0" data-testid={`landing-page-row-${page.is_home ? 'home' : page.slug}`}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-500">
          {page.is_home ? <House size={17} weight="duotone" /> : <File size={17} weight="duotone" />}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-neutral-900">{page.is_home ? t('landingBuilder.card.home') : page.title}</span>
            <span className="truncate text-xs text-neutral-400" dir="ltr">{path}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <StatusChip page={page} />
            {edited && <span className="text-xs text-neutral-400">{t('landingBuilder.card.edited', { when: edited })}</span>}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {(page.published || page.is_home) && (
          <a href={getUriWithOrg(orgslug, path)} target="_blank" rel="noreferrer" className={buttonClass('ghost', 'sm')}>
            <ArrowSquareOut size={14} /> {t('landingBuilder.card.view')}
          </a>
        )}
        <Link href={page.is_home ? BUILDER : `${BUILDER}?page=${page.page_uuid}`} className={buttonClass('secondary', 'sm')} data-testid={`edit-page-${page.is_home ? 'home' : page.slug}`}>
          <PencilSimple size={14} /> {t('landingBuilder.card.edit')}
        </Link>
      </div>
    </li>
  )
}

function ThemeGlance({ org }: { org: any }) {
  const { t } = useTranslation()
  const theme = readOrgTheme(org)
  const accent = resolveAccent(theme)
  const swatches = [theme.color, accent, theme.theme.secondary_color].filter(Boolean) as string[]
  const font = theme.font || t('website.theme.default_font')
  return (
    <div className="flex items-center gap-3">
      <div className="flex -space-x-1.5 rtl:space-x-reverse" aria-hidden>
        {(swatches.length ? swatches : ['#171717', '#e5e5e5']).map((c, i) => <span key={i} className="h-7 w-7 rounded-full ring-2 ring-white" style={{ backgroundColor: c }} />)}
      </div>
      <div className="min-w-0">
        <div className="truncate text-[13px] font-semibold text-neutral-900">{theme.theme.preset && theme.theme.preset !== 'custom' ? t(`dashboard.organization.branding.theming.presets.${theme.theme.preset}`) : t('website.theme.custom')}</div>
        <div className="truncate text-[12px] text-neutral-500">{font}</div>
      </div>
    </div>
  )
}

/** Where a template goes: the home page draft, or a new page. */
function ApplyTemplateDialog({ open, onClose, onHome, onNewPage, extraPages }: { open: boolean; onClose: () => void; onHome: () => Promise<void>; onNewPage: () => void; extraPages: boolean }) {
  const { t } = useTranslation()
  const [busy, setBusy] = React.useState(false)
  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={(o) => !o && onClose()}
      size="sm"
      icon={<SquaresFour size={18} />}
      dialogTitle={t('website.apply.title')}
      dialogDescription={t('website.apply.subtitle')}
      dialogContent={
        <div className="flex flex-col gap-2">
          <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { await onHome() } finally { setBusy(false) } }} className="flex items-start gap-3 rounded-xl bg-white p-3 text-start ring-1 ring-inset ring-neutral-200 hover:bg-neutral-50 disabled:opacity-60" data-testid="apply-home">
            <House size={18} className="mt-0.5 text-neutral-600" />
            <span><span className="block text-[13px] font-semibold text-neutral-900">{t('website.apply.home')}</span><span className="block text-[12px] text-neutral-500">{t('website.apply.home_hint')}</span></span>
          </button>
          <button type="button" disabled={busy || !extraPages} onClick={onNewPage} className="flex items-start gap-3 rounded-xl bg-white p-3 text-start ring-1 ring-inset ring-neutral-200 hover:bg-neutral-50 disabled:opacity-60" data-testid="apply-new-page">
            <FilePlus size={18} className="mt-0.5 text-neutral-600" />
            <span><span className="block text-[13px] font-semibold text-neutral-900">{t('website.apply.new_page')}</span><span className="block text-[12px] text-neutral-500">{extraPages ? t('website.apply.new_page_hint') : t('website.apply.new_page_plan')}</span></span>
          </button>
        </div>
      }
    />
  )
}

export default function WebsiteHome() {
  const { t, i18n } = useTranslation()
  const router = useRouter()
  const queryClient = useQueryClient()
  const org = useOrg() as any
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const { data: site } = useQuery({ queryKey: landingQueryKeys.site(org?.id), queryFn: () => getLandingSite(org.id, token), enabled: !!org?.id && !!token })
  const { data: library } = useQuery({ queryKey: landingQueryKeys.templates(), queryFn: () => getLandingTemplates(token), staleTime: 10 * 60_000, enabled: !!token })
  const { data: live } = useQuery({ queryKey: landingQueryKeys.publicPage(org?.slug, '', null), queryFn: () => getPublicLandingPage(org.slug, ''), enabled: !!org?.slug, staleTime: 30_000 })
  const liveDoc = React.useMemo(() => (live ? asDoc(live.doc) : null), [live])
  const pages = [...(site?.pages || [])].sort((a, b) => Number(b.is_home) - Number(a.is_home))
  const home = pages.find((p) => p.is_home)
  const [pending, setPending] = React.useState<{ id: string; palette: TemplatePalette } | null>(null)
  const [newPage, setNewPage] = React.useState<{ template: string; palette: TemplatePalette } | null>(null)
  const frame = React.useRef<HTMLDivElement>(null)
  const [w, setW] = React.useState(640)
  React.useLayoutEffect(() => {
    if (!frame.current || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(frame.current)
    return () => ro.disconnect()
  }, [])
  const siteUrl = getUriWithOrg(org?.slug, '/')
  // Single-tenant sites get a relative link: show the full address.
  const siteLabel = typeof window !== 'undefined' ? new URL(siteUrl, window.location.origin).href : siteUrl
  const published = home?.published_at ? formatRelative(home.published_at, i18n.language) : ''

  const copyPreview = async () => {
    if (!home) return
    try {
      const detail = await getLandingPage(home.page_uuid, token)
      await navigator.clipboard.writeText(`${siteLabel}?landing_preview=${encodeURIComponent(detail.preview_token)}`)
      toast.success(t('website.preview_copied'))
    } catch {
      toast.error(t('landingBuilder.toasts.load_failed'))
    }
  }

  const applyToHome = async () => {
    if (!pending || !home) return
    try {
      const detail = await getLandingPage(home.page_uuid, token)
      await applyLandingTemplate(home.page_uuid, pending.id, detail.draft_revision, token, pending.palette)
      queryClient.invalidateQueries({ queryKey: ['landing'] })
      toast.success(t('landingBuilder.toasts.template_applied'))
      router.push(getUriWithOrg(org.slug, BUILDER))
    } catch {
      toast.error(t('landingBuilder.toasts.load_failed'))
    }
  }

  return (
    <DashPage>
      <DashPageHeader
        breadcrumbs={[{ label: t('website.title'), href: '/dash/website', icon: <Globe size={14} /> }]}
        title={t('website.title')}
        subtitle={t('website.subtitle')}
        actions={
          <>
            <a href={siteUrl} target="_blank" rel="noreferrer" className={buttonClass('secondary', 'md')} data-testid="website-view-site">
              <ArrowSquareOut size={15} /> {t('website.view_site')}
            </a>
            <Link href={BUILDER} className={buttonClass('primary', 'md')} data-testid="website-open-builder">
              <PencilSimple size={15} /> {t('website.open_builder')}
            </Link>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="overflow-hidden rounded-2xl bg-white nice-shadow" data-testid="website-live-preview">
          <div className="flex h-10 items-center gap-2 border-b border-neutral-100 px-3">
            <span className="flex gap-1.5" aria-hidden>
              <span className="h-2.5 w-2.5 rounded-full bg-neutral-200" /><span className="h-2.5 w-2.5 rounded-full bg-neutral-200" /><span className="h-2.5 w-2.5 rounded-full bg-neutral-200" />
            </span>
            <span className="mx-auto flex min-w-0 max-w-[70%] items-center gap-1.5 truncate rounded-md bg-neutral-100 px-3 py-1 text-[12px] text-neutral-500" dir="ltr">
              <LinkSimple size={12} /> <span className="truncate">{siteLabel.replace(/^https?:\/\//, '')}</span>
            </span>
          </div>
          <div ref={frame} className="relative w-full" data-lh-user-content="">
            <ScaledPage doc={liveDoc} org={org} orgslug={org?.slug} scale={w / 1280} className="aspect-[16/10] w-full" />
            <Link href={BUILDER} className="absolute inset-0 flex items-end justify-center bg-gradient-to-t from-black/25 to-transparent p-4 opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100" aria-label={t('website.edit_home')}>
              <span className={buttonClass('primary', 'sm')}><PencilSimple size={13} /> {t('website.edit_home')}</span>
            </Link>
          </div>
        </div>

        <div className="flex flex-col gap-5">
          <SectionCard icon={<Rocket size={18} className="text-emerald-600" />} title={t('website.status.title')}>
            {home ? (
              <div className="flex flex-col gap-3">
                <StatusChip page={home} />
                <p className="text-[13px] leading-relaxed text-neutral-600">
                  {home.published ? t('website.status.live_since', { when: published }) : t('website.status.default_hint')}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Link href={BUILDER} className={buttonClass(home.published ? 'secondary' : 'primary', 'sm')} data-testid="website-design-home">
                    {home.published ? t('website.edit_home') : t('website.design_home')} <ArrowRight size={13} className="rtl:rotate-180" />
                  </Link>
                  <Button variant="ghost" size="sm" icon={<Copy size={13} />} onClick={copyPreview}>{t('website.copy_preview')}</Button>
                </div>
              </div>
            ) : (
              <div className="h-24 animate-pulse rounded-xl bg-neutral-100" />
            )}
          </SectionCard>
          <SectionCard
            icon={<Palette size={18} className="text-violet-600" />}
            title={t('website.theme.title')}
            description={t('website.theme.description')}
            actions={<Link href="/dash/org/settings/branding" className={buttonClass('ghost', 'sm')} data-testid="website-theme-link">{t('website.theme.edit')} <ArrowRight size={13} className="rtl:rotate-180" /></Link>}
          >
            <ThemeGlance org={org} />
          </SectionCard>
        </div>
      </div>

      <SectionCard
        icon={<File size={18} className="text-sky-600" />}
        title={t('website.pages.title')}
        description={t('website.pages.description')}
        actions={<Button variant="secondary" size="sm" icon={<FilePlus size={14} />} onClick={() => setNewPage({ template: '', palette: 'template' })} data-testid="website-new-page">{t('landingBuilder.pages.new')}</Button>}
      >
        {!site ? (
          <div className="space-y-3" aria-hidden>{[0, 1].map((i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-neutral-100" />)}</div>
        ) : (
          <ul className="divide-y divide-neutral-100">{pages.map((p) => <PageRow key={p.page_uuid} page={p} orgslug={org?.slug} />)}</ul>
        )}
      </SectionCard>

      <section className="flex flex-col gap-4" aria-labelledby="website-templates">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="website-templates" className="flex items-center gap-2 text-lg font-semibold tracking-tight text-neutral-900"><Swatches size={18} className="text-amber-600" /> {t('website.templates.title')}</h2>
            <p className="mt-0.5 text-[13px] text-neutral-500">{t('website.templates.subtitle')}</p>
          </div>
        </div>
        {library ? (
          <TemplateGallery
            templates={library.templates}
            org={org}
            orgslug={org?.slug}
            token={token}
            useLabel={t('website.templates.use')}
            onUse={(id, palette) => setPending({ id, palette })}
          />
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="aspect-[16/11] animate-pulse rounded-2xl bg-white nice-shadow" />)}</div>
        )}
      </section>

      <ApplyTemplateDialog
        open={!!pending}
        onClose={() => setPending(null)}
        extraPages={!!site?.caps.extra_pages}
        onHome={applyToHome}
        onNewPage={() => { if (pending) setNewPage({ template: pending.id, palette: pending.palette }); setPending(null) }}
      />
      <NewPageDialog
        open={!!newPage}
        onClose={() => setNewPage(null)}
        caps={site?.caps}
        templates={library?.templates ?? []}
        initialTemplate={newPage?.template || ''}
        hasNav={!!liveDoc && JSON.stringify(liveDoc.root).includes('"type":"navbar"')}
        onCreate={async (body) => {
          try {
            const detail = await createLandingPage(org.id, { ...body, palette: newPage?.template === body.template && newPage?.palette === 'org' ? 'org' : body.palette }, token)
            queryClient.invalidateQueries({ queryKey: landingQueryKeys.site(org.id) })
            router.push(`${getUriWithOrg(org.slug, BUILDER)}?page=${detail.page_uuid}`)
          } catch (e: any) {
            toast.error(e?.message || t('landingBuilder.toasts.load_failed'))
            throw e
          }
        }}
      />
    </DashPage>
  )
}
