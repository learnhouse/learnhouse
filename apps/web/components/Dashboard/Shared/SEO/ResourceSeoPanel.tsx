'use client'
import React, { useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  Gear,
  GoogleLogo,
  ListChecks,
  MagnifyingGlass,
  Plus,
  ShareNetwork,
  Sparkle,
  Trash,
  UploadSimple,
  X,
} from '@phosphor-icons/react'
import { Switch } from '@components/ui/switch'
import { Button, INPUT, SectionCard, SegmentedControl, SettingRow, TEXTAREA } from '@components/Dashboard/Shared/DashKit/DashKit'
import { SubTabPanel, SubTabs, useSubTab, type SubTabItem } from '@components/Dashboard/Shared/DashKit/SubTabs'
import { AIButton } from '@components/Objects/AI/AIBrand'
import { useOrg } from '@components/Contexts/OrgContext'
import { aiSuggestSeo, uploadSeoImage } from '@services/seo/seo'
import { getOrgFaviconMediaDirectory, getOrgLogoMediaDirectory } from '@services/media/media'
import { buildPageTitle, getOrgSeoConfig } from '@/lib/seo/utils'
import { seoImageUrl, type ResourceSeo } from '@/lib/seo/meta'
import { resourceSegment, type SeoResourceType } from '@/lib/seo/paths'
import { seoChecks, seoScore, DESCRIPTION_RANGE, TITLE_RANGE } from '@/lib/seo/score'
import { useAbsoluteUrl } from '@/lib/seo/useAbsoluteUrl'
import { useSeoT } from '@/lib/seo/i18n'
import { SerpPreview, SocialPreview } from './SeoPreviews'
import { SeoScoreCard } from './SeoScoreCard'
import { SlugField } from './SlugField'

const SECTIONS = ['search', 'social', 'rich', 'advanced'] as const
type Section = (typeof SECTIONS)[number]

export type ResourceSeoPanelProps = {
  type: SeoResourceType
  /** Full uuid with its prefix (`course_…`). */
  uuid: string
  orgslug: string
  token?: string
  name: string
  description?: string | null
  /** Long text on the page (course About). */
  body?: string | null
  /** Absolute thumbnail URL, when the resource has one. */
  thumbnailUrl?: string | null
  slug: string | null
  learnings?: number
  chapters?: number
  isPublic?: boolean
  value: ResourceSeo
  onChange: (next: ResourceSeo) => void
  onSlugSaved?: (slug: string) => void
}

function Counter({ n, min, max }: { n: number; min?: number; max: number }) {
  const tone = n === 0 ? 'text-neutral-400' : n > max ? 'text-rose-600 font-medium' : min && n < min ? 'text-amber-600' : 'text-emerald-600'
  return <span className={`tabular-nums text-xs ${tone}`}>{n}/{max}</span>
}

function Field({ id, label, hint, aside, children }: { id: string; label: React.ReactNode; hint?: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid">
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <label htmlFor={id} className="text-sm font-semibold text-neutral-800">{label}</label>
        {aside}
      </div>
      {children}
      {hint && <p className="mt-1.5 text-xs text-neutral-400">{hint}</p>}
    </div>
  )
}

/**
 * Every SEO setting of one resource, in sub-tabs (Search / Social / Rich
 * results / Advanced) next to a live score and checklist. Controlled: the
 * caller decides how `value` is saved. The slug saves on its own (explicitly),
 * because changing a public URL deserves a deliberate click.
 */
export function ResourceSeoPanel(props: ResourceSeoPanelProps) {
  const st = useSeoT()
  const org = useOrg() as any
  const { value, onChange } = props
  const set = (patch: Partial<ResourceSeo>) => onChange({ ...value, ...patch })
  const showRich = props.type === 'course' || props.type === 'path'
  const visible = SECTIONS.filter((s) => s !== 'rich' || showRich)
  const [section, setSection] = useSubTab<Section>('search', visible, { rememberAs: 'seo-panel' })

  const orgSeo = getOrgSeoConfig(org)
  const orgName = org?.name || ''
  const key = props.slug || props.uuid.replace(/^[a-z]+_/, '')
  const siteBase = useAbsoluteUrl(props.orgslug, '/')
  const pageUrl = `${siteBase}${resourceSegment(props.type)}${key}`
  const generatedImage = `${siteBase}/og/${props.type}/${key}`

  const fullTitle = value.title?.trim() || buildPageTitle(props.name, orgName, orgSeo)
  const description = value.description?.trim() || props.description || orgSeo.default_meta_description || ''
  const shareImage = seoImageUrl(org?.org_uuid, value.og_image) || props.thumbnailUrl || generatedImage
  const favicon = (() => {
    const general = org?.config?.config?.customization?.general || org?.config?.config?.general || {}
    if (general.favicon_image) return getOrgFaviconMediaDirectory(org.org_uuid, general.favicon_image)
    return org?.logo_image ? getOrgLogoMediaDirectory(org.org_uuid, org.logo_image) : null
  })()

  const checks = useMemo(
    () =>
      seoChecks({
        type: props.type,
        name: props.name,
        slug: props.slug,
        description: props.description,
        body: props.body,
        hasImage: !!props.thumbnailUrl,
        seo: value,
        titleSuffixLength: value.title?.trim() ? 0 : fullTitle.length - props.name.length,
        learnings: props.learnings,
        chapters: props.chapters,
        isPublic: props.isPublic,
      }),
    [props.type, props.name, props.slug, props.description, props.body, props.thumbnailUrl, value, fullTitle, props.learnings, props.chapters, props.isPublic],
  )
  const score = seoScore(checks)

  // AI suggestion for title + description (spends AI credits).
  const [aiBusy, setAiBusy] = useState(false)
  const runAi = async () => {
    setAiBusy(true)
    try {
      const s = await aiSuggestSeo(org?.id, props.type, props.uuid, [props.body, value.keywords].filter(Boolean).join('\n'), props.token)
      set({ title: s.title, description: s.description })
      toast.success(st('search.ai_done'))
    } catch (e: any) {
      toast.error(typeof e?.message === 'string' && e.message ? e.message : st('search.ai_failed'))
    } finally {
      setAiBusy(false)
    }
  }

  // Share image upload
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const upload = async (file?: File) => {
    if (!file) return
    setUploading(true)
    try {
      set({ og_image: await uploadSeoImage(props.type, props.uuid, file, props.token) })
    } catch {
      toast.error(st('save_failed'))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const items: SubTabItem<Section>[] = [
    { key: 'search', label: st('tabs.search'), icon: <MagnifyingGlass size={15} /> },
    { key: 'social', label: st('tabs.social'), icon: <ShareNetwork size={15} /> },
    { key: 'rich', label: st('tabs.rich'), icon: <ListChecks size={15} />, hidden: !showRich },
    { key: 'advanced', label: st('tabs.advanced'), icon: <Gear size={15} /> },
  ]

  const toggle = (name: 'robots_noindex' | 'robots_nofollow' | 'enable_jsonld', checked: boolean) => (
    <SettingRow
      title={<label htmlFor={`${name}-${props.uuid}`}>{st(`advanced.${name === 'robots_noindex' ? 'noindex' : name === 'robots_nofollow' ? 'nofollow' : 'jsonld'}`)}</label>}
      description={st(`advanced.${name === 'robots_noindex' ? 'noindex_hint' : name === 'robots_nofollow' ? 'nofollow_hint' : 'jsonld_hint'}`)}
      control={<Switch id={`${name}-${props.uuid}`} checked={checked} onCheckedChange={(c) => set({ [name]: c } as Partial<ResourceSeo>)} />}
    />
  )

  const faq = value.faq || []

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-5 items-start">
      <div className="min-w-0 space-y-5">
        <SlugField
          type={props.type}
          uuid={props.uuid}
          orgId={org?.id}
          orgslug={props.orgslug}
          title={props.name}
          slug={props.slug}
          token={props.token}
          onSaved={props.onSlugSaved}
        />
        <SubTabs items={items} value={section} onChange={setSection} ariaLabel={st('tab')} idPrefix="seo">
          <SubTabPanel tab="search">
            <SectionCard
              icon={<GoogleLogo size={18} />}
              title={st('search.title')}
              description={st('search.subtitle')}
              actions={
                <AIButton variant="soft" size="sm" onClick={runAi} loading={aiBusy}>
                  {aiBusy ? st('search.ai_working') : st('search.ai')}
                </AIButton>
              }
              bodyClassName="p-5 space-y-5"
            >
              <Field id={`seo-title-${props.uuid}`} label={st('search.meta_title')} hint={st('search.meta_title_hint')} aside={<Counter n={fullTitle.length} min={TITLE_RANGE.min} max={TITLE_RANGE.max} />}>
                <input id={`seo-title-${props.uuid}`} className={INPUT} value={value.title || ''} placeholder={buildPageTitle(props.name, orgName, orgSeo)} maxLength={120} onChange={(e) => set({ title: e.target.value })} />
              </Field>
              <Field id={`seo-desc-${props.uuid}`} label={st('search.meta_description')} hint={st('search.meta_description_hint')} aside={<Counter n={description.length} min={DESCRIPTION_RANGE.min} max={DESCRIPTION_RANGE.max} />}>
                <textarea id={`seo-desc-${props.uuid}`} className={`${TEXTAREA} h-20`} value={value.description || ''} placeholder={props.description || ''} maxLength={320} onChange={(e) => set({ description: e.target.value })} />
              </Field>
              <Field id={`seo-kw-${props.uuid}`} label={st('search.keywords')} hint={st('search.keywords_hint')}>
                <input id={`seo-kw-${props.uuid}`} className={INPUT} value={value.keywords || ''} maxLength={500} onChange={(e) => set({ keywords: e.target.value })} />
              </Field>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-neutral-400 mb-2">{st('search.preview')}</div>
                <SerpPreview url={pageUrl} title={fullTitle} description={description} siteName={orgName} favicon={favicon} />
              </div>
            </SectionCard>
          </SubTabPanel>

          <SubTabPanel tab="social">
            <SectionCard icon={<ShareNetwork size={18} />} title={st('social.title')} description={st('social.subtitle')} bodyClassName="p-5 space-y-5">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="space-y-5 min-w-0">
                  <Field id={`og-title-${props.uuid}`} label={st('social.og_title')} aside={<Counter n={(value.og_title || '').length} max={TITLE_RANGE.max + 10} />}>
                    <input id={`og-title-${props.uuid}`} className={INPUT} value={value.og_title || ''} placeholder={fullTitle} maxLength={120} onChange={(e) => set({ og_title: e.target.value })} />
                  </Field>
                  <Field id={`og-desc-${props.uuid}`} label={st('social.og_description')} aside={<Counter n={(value.og_description || '').length} max={200} />}>
                    <textarea id={`og-desc-${props.uuid}`} className={`${TEXTAREA} h-20`} value={value.og_description || ''} placeholder={description} maxLength={320} onChange={(e) => set({ og_description: e.target.value })} />
                  </Field>
                  <div>
                    <div className="text-sm font-semibold text-neutral-800 mb-1.5">{st('social.image')}</div>
                    <div className="flex flex-wrap items-center gap-2">
                      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
                      <Button onClick={() => fileRef.current?.click()} loading={uploading} icon={<UploadSimple size={14} />}>
                        {uploading ? st('social.uploading') : value.og_image ? st('social.replace') : st('social.upload')}
                      </Button>
                      {value.og_image && (
                        <Button onClick={() => set({ og_image: null })} icon={<X size={14} />}>
                          {st('social.remove')}
                        </Button>
                      )}
                    </div>
                    <p className="mt-1.5 text-xs text-neutral-400">{!value.og_image && !props.thumbnailUrl && generatedImage ? st('social.generated') : st('social.image_hint')}</p>
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-neutral-800 mb-1.5">{st('social.card')}</div>
                    <SegmentedControl
                      ariaLabel={st('social.card')}
                      value={value.twitter_card === 'summary' ? 'summary' : 'summary_large_image'}
                      options={[
                        { key: 'summary_large_image', label: st('social.card_large') },
                        { key: 'summary', label: st('social.card_small') },
                      ]}
                      onChange={(v) => v && set({ twitter_card: v })}
                    />
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold uppercase tracking-wide text-neutral-400 mb-2">{st('social.preview')}</div>
                  <SocialPreview
                    image={shareImage}
                    title={value.og_title || fullTitle}
                    description={value.og_description || description}
                    host={siteBase.replace(/^https?:\/\//, '')}
                    small={value.twitter_card === 'summary'}
                  />
                </div>
              </div>
            </SectionCard>
          </SubTabPanel>

          <SubTabPanel tab="rich">
            <SectionCard icon={<Sparkle size={18} />} title={st('rich.title')} description={st('rich.subtitle')} bodyClassName="p-5 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <Field id={`lvl-${props.uuid}`} label={st('rich.level')}>
                  <select id={`lvl-${props.uuid}`} className={INPUT} value={value.educational_level || ''} onChange={(e) => set({ educational_level: (e.target.value || null) as ResourceSeo['educational_level'] })}>
                    <option value="">{st('rich.level_none')}</option>
                    <option value="beginner">{st('rich.level_beginner')}</option>
                    <option value="intermediate">{st('rich.level_intermediate')}</option>
                    <option value="advanced">{st('rich.level_advanced')}</option>
                  </select>
                </Field>
                <Field id={`lang-${props.uuid}`} label={st('rich.language')}>
                  <input id={`lang-${props.uuid}`} className={INPUT} dir="ltr" value={value.in_language || ''} placeholder="en" maxLength={16} onChange={(e) => set({ in_language: e.target.value.trim() || null })} />
                </Field>
                <Field id={`work-${props.uuid}`} label={st('rich.workload')}>
                  <input id={`work-${props.uuid}`} type="number" min={1} className={INPUT} value={value.workload_minutes ?? ''} onChange={(e) => set({ workload_minutes: e.target.value ? Math.max(1, Number(e.target.value)) : null })} />
                </Field>
              </div>
              <Field id={`pre-${props.uuid}`} label={st('rich.prerequisites')}>
                <textarea id={`pre-${props.uuid}`} className={`${TEXTAREA} h-16`} value={value.prerequisites || ''} maxLength={1000} onChange={(e) => set({ prerequisites: e.target.value })} />
              </Field>
              <Field id={`aud-${props.uuid}`} label={st('rich.audience')}>
                <input id={`aud-${props.uuid}`} className={INPUT} value={value.audience || ''} maxLength={300} onChange={(e) => set({ audience: e.target.value })} />
              </Field>
              <div>
                <div className="text-sm font-semibold text-neutral-800">{st('rich.faq')}</div>
                <p className="text-xs text-neutral-400 mb-3">{st('rich.faq_hint')}</p>
                <div className="space-y-3">
                  {faq.map((item, i) => (
                    <div key={i} className="rounded-xl ring-1 ring-inset ring-neutral-200 p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <input
                          aria-label={st('rich.faq_question')}
                          className={INPUT}
                          value={item.question}
                          placeholder={st('rich.faq_question')}
                          maxLength={300}
                          onChange={(e) => set({ faq: faq.map((f, j) => (j === i ? { ...f, question: e.target.value } : f)) })}
                        />
                        <button type="button" aria-label={st('rich.faq_remove')} onClick={() => set({ faq: faq.filter((_, j) => j !== i) })} className="h-9 w-9 shrink-0 rounded-lg text-neutral-400 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center">
                          <Trash size={15} />
                        </button>
                      </div>
                      <textarea
                        aria-label={st('rich.faq_answer')}
                        className={`${TEXTAREA} h-16`}
                        value={item.answer}
                        placeholder={st('rich.faq_answer')}
                        maxLength={2000}
                        onChange={(e) => set({ faq: faq.map((f, j) => (j === i ? { ...f, answer: e.target.value } : f)) })}
                      />
                    </div>
                  ))}
                  {faq.length < 20 && (
                    <Button size="sm" icon={<Plus size={13} />} onClick={() => set({ faq: [...faq, { question: '', answer: '' }] })}>
                      {st('rich.faq_add')}
                    </Button>
                  )}
                </div>
              </div>
            </SectionCard>
          </SubTabPanel>

          <SubTabPanel tab="advanced">
            <SectionCard icon={<Gear size={18} />} title={st('advanced.title')} description={st('advanced.subtitle')} bodyClassName="px-5 pb-5 pt-4 divide-y divide-neutral-100">
              {toggle('robots_noindex', !!value.robots_noindex)}
              {toggle('robots_nofollow', !!value.robots_nofollow)}
              {toggle('enable_jsonld', value.enable_jsonld !== false)}
            </SectionCard>
            <SectionCard bodyClassName="p-5 space-y-5">
              {props.thumbnailUrl && (
                <Field id={`alt-${props.uuid}`} label={st('advanced.image_alt')} hint={st('advanced.image_alt_hint')}>
                  <input id={`alt-${props.uuid}`} className={INPUT} value={value.image_alt || ''} placeholder={props.name} maxLength={250} onChange={(e) => set({ image_alt: e.target.value })} />
                </Field>
              )}
              <Field id={`can-${props.uuid}`} label={st('advanced.canonical')} hint={st('advanced.canonical_hint')}>
                <input id={`can-${props.uuid}`} className={INPUT} dir="ltr" type="url" value={value.canonical_url || ''} placeholder={pageUrl} onChange={(e) => set({ canonical_url: e.target.value })} />
              </Field>
              <Field id={`ogt-${props.uuid}`} label={st('advanced.og_type')}>
                <select id={`ogt-${props.uuid}`} className={INPUT} value={value.og_type || ''} onChange={(e) => set({ og_type: e.target.value || null })}>
                  <option value="">—</option>
                  <option value="website">website</option>
                  <option value="article">article</option>
                  <option value="video.other">video.other</option>
                  <option value="music.playlist">music.playlist</option>
                </select>
              </Field>
            </SectionCard>
          </SubTabPanel>
        </SubTabs>
      </div>
      <div className="xl:sticky xl:top-4 min-w-0">
        <SeoScoreCard score={score} checks={checks} />
      </div>
    </div>
  )
}

/** Drop empty strings and empty FAQ rows before saving. */
export function cleanSeoForSave(seo: ResourceSeo): ResourceSeo {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(seo)) {
    if (k === 'faq') {
      const faq = (v as ResourceSeo['faq'] || []).filter((f) => f.question.trim() && f.answer.trim())
      if (faq.length) out.faq = faq
      continue
    }
    if (v === '' || v === undefined) continue
    out[k] = typeof v === 'string' ? v.trim() || null : v
  }
  return out as ResourceSeo
}
