'use client'
import React, { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Form, Formik } from 'formik'
import { updateOrgSeoConfig, uploadOrganizationOgImage, SeoOrgConfig } from '@services/settings/org'
import { revalidateTags } from '@services/utils/ts/requests'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { toast } from 'react-hot-toast'
import { Switch } from '@components/ui/switch'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { getOrgOgImageMediaDirectory } from '@services/media/media'
import {
  ArrowSquareOut,
  GoogleLogo,
  Heartbeat,
  Image as ImageIcon,
  Lightning,
  ListChecks,
  Robot,
  Rss,
  Sparkle,
  SealCheck,
  ShareNetwork,
  SlidersHorizontal,
  TextAa,
  TreeStructure,
  UploadSimple,
  X,
} from '@phosphor-icons/react'
import { useAbsoluteUrl } from '@/lib/seo/useAbsoluteUrl'
import { useSeoT } from '@/lib/seo/i18n'
import { buildPageTitle } from '@/lib/seo/utils'

// Sections with their own indexing switch (communities map to noindex_communities).
const SEO_FEATURES = ['courses', 'activities', 'paths', 'podcasts', 'communities', 'library', 'live', 'newsletters', 'pages', 'store'] as const
import FeatureGate from '@components/Dashboard/Shared/FeatureGate/FeatureGate'
import { Button, FieldLabel, INPUT, SectionCard, SettingRow, StickySaveBar, TEXTAREA, buttonClass } from '@components/Dashboard/Shared/DashKit/DashKit'
import { SubTabPanel, SubTabs, useSubTab, type SubTabItem } from '@components/Dashboard/Shared/DashKit/SubTabs'
import { CopyButton } from '@components/Dashboard/Pages/Org/Developers/devKit'
import { SeoHealthReport } from './SeoHealthReport'

const SECTIONS = ['general', 'indexing', 'verification', 'health'] as const
type Section = (typeof SECTIONS)[number]

const ORG_TYPES = ['', 'EducationalOrganization', 'Organization', 'CollegeOrUniversity', 'School', 'OnlineBusiness', 'Corporation']

const OrgEditSEO: React.FC = () => {
  const { t } = useTranslation()
  const st = useSeoT()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as any
  const queryClient = useQueryClient()
  const ogImageInputRef = useRef<HTMLInputElement>(null)
  const [ogImageFile, setOgImageFile] = useState<File | null>(null)
  const [ogImagePreview, setOgImagePreview] = useState<string | null>(null)
  const [section, setSection] = useSubTab<Section>('general', SECTIONS)

  const seoConfig = org?.config?.config?.customization?.seo || org?.config?.config?.seo || {}

  const initialValues: Required<SeoOrgConfig> = {
    default_meta_title_suffix: seoConfig.default_meta_title_suffix || '',
    default_title_template: seoConfig.default_title_template || '',
    default_meta_description: seoConfig.default_meta_description || '',
    default_og_image: seoConfig.default_og_image || '',
    google_site_verification: seoConfig.google_site_verification || '',
    bing_site_verification: seoConfig.bing_site_verification || '',
    yandex_verification: seoConfig.yandex_verification || '',
    pinterest_verification: seoConfig.pinterest_verification || '',
    twitter_handle: seoConfig.twitter_handle || '',
    noindex_communities: seoConfig.noindex_communities || false,
    indexing_disabled: seoConfig.indexing_disabled || false,
    robots_extra_rules: seoConfig.robots_extra_rules || '',
    organization_type: seoConfig.organization_type || '',
    ai_crawler_policy: seoConfig.ai_crawler_policy || 'allow',
    ai_crawlers_blocked: seoConfig.ai_crawlers_blocked || [],
    indexable_features: seoConfig.indexable_features || {},
    thin_thread_noindex_days: seoConfig.thin_thread_noindex_days ?? 90,
    feeds_enabled: seoConfig.feeds_enabled !== false,
    llms_txt_enabled: seoConfig.llms_txt_enabled !== false,
    indexnow_enabled: !!seoConfig.indexnow_enabled,
    indexnow_key: seoConfig.indexnow_key || '',
  }

  // Absolute: these are handed to Google Search Console, not clicked in-app
  const sitemapUrl = useAbsoluteUrl(org?.slug, '/sitemap.xml')
  const robotsUrl = useAbsoluteUrl(org?.slug, '/robots.txt')
  const llmsUrl = useAbsoluteUrl(org?.slug, '/llms.txt')
  const feedUrl = useAbsoluteUrl(org?.slug, '/feed.xml')
  const indexNowKeyUrl = useAbsoluteUrl(org?.slug, `/${seoConfig.indexnow_key || 'key'}.txt`)

  const handleOgImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setOgImageFile(file)
      const reader = new FileReader()
      reader.onloadend = () => setOgImagePreview(reader.result as string)
      reader.readAsDataURL(file)
    }
  }

  const clearOgImage = () => {
    setOgImageFile(null)
    setOgImagePreview(null)
    if (ogImageInputRef.current) ogImageInputRef.current.value = ''
  }

  const saveSeoConfig = async (values: SeoOrgConfig): Promise<boolean> => {
    const loadingToast = toast.loading(t('dashboard.organization.seo.saving'))
    try {
      if (ogImageFile) {
        const uploadResult = await uploadOrganizationOgImage(org.id, ogImageFile, access_token)
        values.default_og_image = uploadResult.filename
      }
      await updateOrgSeoConfig(org.id, values, access_token)
      await revalidateTags(['organizations'], org.slug)
      queryClient.invalidateQueries({ queryKey: queryKeys.org.detail(org.slug) })
      setOgImageFile(null)
      toast.success(t('dashboard.organization.seo.saved'), { id: loadingToast })
      return true
    } catch (e: any) {
      toast.error(typeof e?.message === 'string' && e.message ? e.message : t('dashboard.organization.seo.save_failed'), { id: loadingToast })
      return false
    }
  }

  const existingOgImageUrl = seoConfig.default_og_image ? getOrgOgImageMediaDirectory(org?.org_uuid, seoConfig.default_og_image) : null

  const items: SubTabItem<Section>[] = [
    { key: 'general', label: st('tabs.general'), icon: <TextAa size={15} /> },
    { key: 'indexing', label: st('tabs.indexing'), icon: <Robot size={15} /> },
    { key: 'verification', label: st('tabs.verification'), icon: <SealCheck size={15} /> },
    { key: 'health', label: st('tabs.health'), icon: <Heartbeat size={15} /> },
  ]

  return (
    <FeatureGate feature="seo">
      <Formik
        enableReinitialize
        initialValues={initialValues}
        onSubmit={async (values, { resetForm }) => {
          const ok = await saveSeoConfig({ ...values })
          // Mark the form clean right away instead of waiting for the org refetch.
          if (ok) resetForm({ values })
        }}
      >
        {({ isSubmitting, values, handleChange, setFieldValue, dirty, submitForm, resetForm }) => (
          <Form className="flex flex-col gap-5">
            <SubTabs items={items} value={section} onChange={setSection} ariaLabel="SEO" idPrefix="org-seo">
              <SubTabPanel tab="general">
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
                  <div className="flex flex-col gap-5 min-w-0">
                    <SectionCard
                      icon={<TextAa size={18} />}
                      title={t('dashboard.organization.seo.org_seo.default_meta_tags')}
                      description={t('dashboard.organization.seo.org_seo.set_default_metadata')}
                    >
                      <div className="flex flex-col gap-4">
                        <label className="block">
                          <FieldLabel hint={values.default_title_template ? buildPageTitle('Intro to Python', org?.name || '', values) : undefined}>
                            {st('org.title_template')}
                          </FieldLabel>
                          <input
                            id="default_title_template"
                            name="default_title_template"
                            className={INPUT}
                            value={values.default_title_template}
                            onChange={handleChange}
                            placeholder={`%s · ${org?.name || 'My Academy'}`}
                            maxLength={120}
                          />
                          <p className="mt-1.5 text-xs text-neutral-500">{st('org.title_template_hint')}</p>
                        </label>
                        <label className="block">
                          <FieldLabel hint={t('dashboard.organization.seo.characters_left', { count: 30 - (values.default_meta_title_suffix?.length || 0) })}>
                            {t('dashboard.organization.seo.org_seo.title_suffix')}
                          </FieldLabel>
                          <input
                            id="default_meta_title_suffix"
                            name="default_meta_title_suffix"
                            className={INPUT}
                            value={values.default_meta_title_suffix}
                            onChange={handleChange}
                            placeholder=" | My Academy"
                            maxLength={30}
                            disabled={!!values.default_title_template}
                          />
                          <p className="mt-1.5 text-xs text-neutral-500">{t('dashboard.organization.seo.org_seo.title_suffix_hint')}</p>
                        </label>
                        <label className="block">
                          <FieldLabel hint={t('dashboard.organization.seo.characters_left', { count: 160 - (values.default_meta_description?.length || 0) })}>
                            {t('dashboard.organization.seo.org_seo.default_description')}
                          </FieldLabel>
                          <textarea
                            id="default_meta_description"
                            name="default_meta_description"
                            className={`${TEXTAREA} h-20`}
                            value={values.default_meta_description}
                            onChange={handleChange}
                            placeholder={t('dashboard.organization.seo.description_placeholder')}
                            maxLength={160}
                          />
                          <p className="mt-1.5 text-xs text-neutral-500">{t('dashboard.organization.seo.org_seo.default_description_hint')}</p>
                        </label>
                        <label className="block">
                          <FieldLabel>{st('org.org_type')}</FieldLabel>
                          <select id="organization_type" name="organization_type" className={INPUT} value={values.organization_type} onChange={handleChange}>
                            {ORG_TYPES.map((type) => (
                              <option key={type} value={type}>
                                {type || 'EducationalOrganization (default)'}
                              </option>
                            ))}
                          </select>
                          <p className="mt-1.5 text-xs text-neutral-500">{st('org.org_type_hint')}</p>
                        </label>
                      </div>
                    </SectionCard>
                  </div>

                  <div className="flex flex-col gap-5 min-w-0">
                    <SectionCard
                      icon={<ShareNetwork size={18} />}
                      title={t('dashboard.organization.seo.org_seo.social_open_graph')}
                      description={t('dashboard.organization.seo.org_seo.social_open_graph_hint')}
                    >
                      <div className="flex flex-col gap-4">
                        <div>
                          <FieldLabel>{t('dashboard.organization.seo.org_seo.default_og_image')}</FieldLabel>
                          <p className="-mt-0.5 mb-2.5 text-xs text-neutral-500">{t('dashboard.organization.seo.org_seo.default_og_image_hint')}</p>
                          <div className="flex flex-wrap items-start gap-4">
                            <div className="relative w-56 aspect-[1200/630] rounded-xl overflow-hidden bg-neutral-50 ring-1 ring-inset ring-neutral-200/80 flex items-center justify-center shrink-0">
                              {ogImagePreview || existingOgImageUrl ? (
                                <img
                                  src={ogImagePreview || existingOgImageUrl || ''}
                                  alt={t('dashboard.organization.seo.og_image_preview')}
                                  width={1200}
                                  height={630}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <ImageIcon size={24} className="text-neutral-300" />
                              )}
                              {ogImagePreview && (
                                <button
                                  type="button"
                                  onClick={clearOgImage}
                                  aria-label={t('common.cancel')}
                                  className="absolute top-1.5 end-1.5 w-6 h-6 rounded-full bg-neutral-900/80 text-white flex items-center justify-center hover:bg-neutral-900"
                                >
                                  <X size={12} weight="bold" />
                                </button>
                              )}
                            </div>
                            <div className="flex flex-col gap-1.5">
                              <input ref={ogImageInputRef} type="file" accept="image/*" onChange={handleOgImageChange} className="hidden" />
                              <Button onClick={() => ogImageInputRef.current?.click()} icon={<UploadSimple size={14} />}>
                                {existingOgImageUrl || ogImagePreview ? t('dashboard.organization.seo.change_image') : t('dashboard.organization.seo.upload_image')}
                              </Button>
                              <span className="text-[11px] font-mono text-neutral-400">1200 × 630</span>
                            </div>
                          </div>
                        </div>
                        <label className="block">
                          <FieldLabel>{t('dashboard.organization.seo.org_seo.twitter_handle')}</FieldLabel>
                          <input id="twitter_handle" name="twitter_handle" className={INPUT} value={values.twitter_handle} onChange={handleChange} placeholder="@yourhandle" />
                          <p className="mt-1.5 text-xs text-neutral-500">{t('dashboard.organization.seo.org_seo.twitter_handle_hint')}</p>
                        </label>
                      </div>
                    </SectionCard>
                  </div>
                </div>
              </SubTabPanel>

              <SubTabPanel tab="indexing">
                <SectionCard
                  icon={<TreeStructure size={18} />}
                  title={t('dashboard.organization.seo.org_seo.quick_links')}
                  description={t('dashboard.organization.seo.org_seo.important_seo_urls')}
                >
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <UrlRow label={t('dashboard.organization.seo.org_seo.sitemap')} url={sitemapUrl} />
                    <UrlRow label={t('dashboard.organization.seo.org_seo.robots_txt')} url={robotsUrl} />
                    {values.llms_txt_enabled && values.ai_crawler_policy !== 'block_all' && <UrlRow label={st('org.links_llms')} url={llmsUrl} />}
                    {values.feeds_enabled && <UrlRow label={st('org.links_feed')} url={feedUrl} />}
                  </div>
                </SectionCard>
                <SectionCard icon={<Robot size={18} />} title={st('org.indexing_title')} description={st('org.indexing_subtitle')} bodyClassName="px-5 pb-5 pt-4 divide-y divide-neutral-100">
                  <SettingRow
                    title={st('org.indexing_disabled')}
                    description={st('org.indexing_disabled_hint')}
                    control={
                      <Switch
                        checked={values.indexing_disabled}
                        onCheckedChange={(checked) => setFieldValue('indexing_disabled', checked)}
                        aria-label={st('org.indexing_disabled')}
                      />
                    }
                  />
                </SectionCard>
                <SectionCard
                  icon={<ListChecks size={18} />}
                  title={st('org.features_title')}
                  description={st('org.features_subtitle')}
                  bodyClassName="px-5 pb-5 pt-4 divide-y divide-neutral-100"
                >
                  {SEO_FEATURES.map((feature) => {
                    const on = feature === 'communities' ? !values.noindex_communities : values.indexable_features?.[feature] !== false
                    return (
                      <SettingRow
                        key={feature}
                        title={st(`org.feature.${feature}`)}
                        control={
                          <Switch
                            checked={on && !values.indexing_disabled}
                            disabled={values.indexing_disabled}
                            onCheckedChange={(checked) =>
                              feature === 'communities'
                                ? setFieldValue('noindex_communities', !checked)
                                : setFieldValue('indexable_features', { ...(values.indexable_features || {}), [feature]: checked })
                            }
                            aria-label={st(`org.feature.${feature}`)}
                          />
                        }
                      />
                    )
                  })}
                  <div className="pt-4">
                    <label className="block">
                      <FieldLabel>{st('org.thin_threads')}</FieldLabel>
                      <div className="flex items-center gap-2">
                        <input
                          id="thin_thread_noindex_days"
                          name="thin_thread_noindex_days"
                          type="number"
                          min={0}
                          max={3650}
                          inputMode="numeric"
                          className={`${INPUT} w-28`}
                          value={values.thin_thread_noindex_days}
                          onChange={(e) => setFieldValue('thin_thread_noindex_days', Math.max(0, Math.min(3650, parseInt(e.target.value || '0', 10) || 0)))}
                        />
                        <span className="text-sm text-neutral-500">{st('org.days')}</span>
                      </div>
                      <p className="mt-1.5 text-xs text-neutral-500">{st('org.thin_threads_hint')}</p>
                    </label>
                  </div>
                </SectionCard>
                <SectionCard icon={<Sparkle size={18} />} title={st('org.ai_title')} description={st('org.ai_subtitle')}>
                  <div className="flex flex-col gap-4">
                    <fieldset className="flex flex-col gap-2">
                      <legend className="sr-only">{st('org.ai_policy')}</legend>
                      {(['allow', 'block_training', 'block_all'] as const).map((policy) => (
                        <label
                          key={policy}
                          className={`flex items-start gap-3 rounded-xl p-3 ring-1 ring-inset cursor-pointer transition-colors ${
                            values.ai_crawler_policy === policy ? 'ring-neutral-900 bg-neutral-50' : 'ring-neutral-200 hover:ring-neutral-300'
                          }`}
                        >
                          <input
                            type="radio"
                            name="ai_crawler_policy"
                            value={policy}
                            checked={values.ai_crawler_policy === policy}
                            onChange={() => setFieldValue('ai_crawler_policy', policy)}
                            className="mt-1"
                          />
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold text-neutral-900">{st(`org.ai_${policy}`)}</span>
                            <span className="block text-xs text-neutral-500 mt-0.5">{st(`org.ai_${policy}_hint`)}</span>
                          </span>
                        </label>
                      ))}
                    </fieldset>
                    <label className="block">
                      <FieldLabel>{st('org.ai_blocked_extra')}</FieldLabel>
                      <CrawlerListField value={values.ai_crawlers_blocked || []} onChange={(list) => setFieldValue('ai_crawlers_blocked', list)} />
                      <p className="mt-1.5 text-xs text-neutral-500">{st('org.ai_blocked_extra_hint')}</p>
                    </label>
                    <SettingRow
                      title={st('org.llms_enabled')}
                      description={st('org.llms_enabled_hint')}
                      control={
                        <Switch
                          checked={values.llms_txt_enabled && values.ai_crawler_policy !== 'block_all'}
                          disabled={values.ai_crawler_policy === 'block_all'}
                          onCheckedChange={(checked) => setFieldValue('llms_txt_enabled', checked)}
                          aria-label={st('org.llms_enabled')}
                        />
                      }
                    />
                  </div>
                </SectionCard>
                <SectionCard icon={<Rss size={18} />} title={st('org.feeds_title')} description={st('org.feeds_enabled_hint')} bodyClassName="px-5 pb-5 pt-4 divide-y divide-neutral-100">
                  <SettingRow
                    title={st('org.feeds_enabled')}
                    control={<Switch checked={values.feeds_enabled} onCheckedChange={(checked) => setFieldValue('feeds_enabled', checked)} aria-label={st('org.feeds_enabled')} />}
                  />
                </SectionCard>
                <SectionCard icon={<Lightning size={18} />} title={st('org.indexnow_title')} description={st('org.indexnow_subtitle')} bodyClassName="px-5 pb-5 pt-4 divide-y divide-neutral-100">
                  <SettingRow
                    title={st('org.indexnow_enabled')}
                    description={st('org.indexnow_enabled_hint')}
                    control={
                      <Switch
                        checked={values.indexnow_enabled}
                        disabled={values.indexing_disabled}
                        onCheckedChange={(checked) => setFieldValue('indexnow_enabled', checked)}
                        aria-label={st('org.indexnow_enabled')}
                      />
                    }
                  />
                  {values.indexnow_enabled && seoConfig.indexnow_key ? (
                    <div className="pt-4">
                      <UrlRow label={st('org.indexnow_key')} url={indexNowKeyUrl} />
                    </div>
                  ) : null}
                </SectionCard>
                <SectionCard icon={<SlidersHorizontal size={18} />} title={st('org.robots_extra')} description={st('org.robots_extra_hint')}>
                  <textarea
                    id="robots_extra_rules"
                    name="robots_extra_rules"
                    aria-label={st('org.robots_extra')}
                    className={`${TEXTAREA} h-32 font-mono text-[12.5px]`}
                    dir="ltr"
                    value={values.robots_extra_rules}
                    onChange={handleChange}
                    placeholder={'User-agent: GPTBot\nDisallow: /'}
                    maxLength={2000}
                  />
                </SectionCard>
              </SubTabPanel>

              <SubTabPanel tab="verification">
                <SectionCard icon={<GoogleLogo size={18} />} title={st('org.verification_title')} description={st('org.verification_subtitle')}>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {(
                      [
                        ['google_site_verification', st('org.google')],
                        ['bing_site_verification', st('org.bing')],
                        ['yandex_verification', st('org.yandex')],
                        ['pinterest_verification', st('org.pinterest')],
                      ] as const
                    ).map(([name, label]) => (
                      <label key={name} className="block">
                        <FieldLabel>{label}</FieldLabel>
                        <input id={name} name={name} className={`${INPUT} font-mono text-[13px]`} dir="ltr" value={values[name]} onChange={handleChange} maxLength={400} />
                      </label>
                    ))}
                  </div>
                </SectionCard>
              </SubTabPanel>

              <SubTabPanel tab="health" unmountWhenHidden>
                <SeoHealthReport />
              </SubTabPanel>
            </SubTabs>

            <StickySaveBar
              visible={dirty || !!ogImageFile}
              saving={isSubmitting}
              onSave={submitForm}
              onDiscard={() => {
                resetForm()
                clearOgImage()
              }}
            />
          </Form>
        )}
      </Formik>
    </FeatureGate>
  )
}

/** One crawler name per line; the raw text is kept while typing (blank lines included). */
function CrawlerListField({ value, onChange }: { value: string[]; onChange: (_list: string[]) => void }) {
  const [text, setText] = useState(value.join('\n'))
  const joined = value.join('\n')
  const [last, setLast] = useState(joined)
  // A reset (discard) from outside replaces the text.
  if (joined !== last) {
    setLast(joined)
    if (parseCrawlers(text).join('\n') !== joined) setText(joined)
  }
  return (
    <textarea
      id="ai_crawlers_blocked"
      className={`${TEXTAREA} h-20 font-mono text-[12.5px]`}
      dir="ltr"
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        const list = parseCrawlers(e.target.value)
        setLast(list.join('\n'))
        onChange(list)
      }}
      placeholder="Bytespider"
    />
  )
}

function parseCrawlers(text: string): string[] {
  return Array.from(new Set(text.split(/[\r\n,]+/).map((l) => l.trim()).filter((l) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(l)))).slice(0, 40)
}

function UrlRow({ label, url }: { label: string; url: string }) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 text-xs font-medium text-neutral-500">{label}</div>
      <div className="flex items-center gap-1 h-9 ps-3 pe-1 rounded-lg bg-neutral-50 ring-1 ring-inset ring-neutral-200/80 min-w-0">
        <a href={url} target="_blank" rel="noopener noreferrer" dir="ltr" className="flex-1 min-w-0 truncate font-mono text-[12.5px] text-neutral-800 hover:underline">
          {url}
        </a>
        <CopyButton value={url} label={false} variant="ghost" />
        <a href={url} target="_blank" rel="noopener noreferrer" aria-label={label} className={buttonClass('ghost', 'icon')}>
          <ArrowSquareOut size={14} />
        </a>
      </div>
    </div>
  )
}

export default OrgEditSEO
