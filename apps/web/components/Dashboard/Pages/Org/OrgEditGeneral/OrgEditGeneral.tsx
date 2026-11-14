'use client'
// Settings → General: one page, five plainly labelled sections (Organization,
// Contact & links, Language & email, Features, Footer) with a sticky section
// nav on desktop and a jump select on phones. One draft, one save/discard bar.
// Each section still saves through the endpoint it always used; the old
// Features tab lives here now (its URL redirects to General#features).
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-hot-toast'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  Broadcast,
  Buildings,
  Circuitry,
  EnvelopeSimple,
  Garage,
  LockSimple,
  Rows,
  ShareNetwork,
  ShieldWarning,
  ToggleRight,
  Translate,
  WarningCircle,
} from '@phosphor-icons/react'
import {
  updateOrganization,
  updateOrgDefaultLanguageConfig,
  updateOrgEmailSenderNameConfig,
  updateOrgFeatureToggle,
  updateOrgFooterTextConfig,
} from '@services/settings/org'
import { AVAILABLE_LANGUAGES } from '@/lib/languages'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import { getOrgLogoMediaDirectory } from '@services/media/media'
import { revalidateTags } from '@services/utils/ts/requests'
import { OPTIONAL_FEATURES, getOptionalFeatureState, type OptionalFeature } from '@services/features/optionalFeatures'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { queryKeys } from '@/lib/query/keys'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { Chip, FieldLabel, INPUT, SectionCard, StickySaveBar, TEXTAREA, buttonClass } from '@/design'
import { Switch } from '@components/ui/switch'
import OrgEditSocials from '@components/Dashboard/Pages/Org/OrgEditSocials/OrgEditSocials'
import { FooterLinksVignette } from '@components/Dashboard/Pages/Org/OrgEditBranding/BrandingVignettes'
import { CharCount, FieldHint, Notice, useDraft } from '@components/Dashboard/Pages/Org/OrgSettingsShared/orgSettingsUi'
import { planNameById } from '@/app/(hub)/_billing/planText'
import {
  ABOUT_MAX,
  DESCRIPTION_MAX,
  FEATURE_GROUPS,
  FOOTER_MAX,
  MAX_EMAIL_SENDER_NAME_LENGTH,
  NAME_MAX,
  SECTIONS,
  diffGeneral,
  firstInvalidSection,
  readGeneral,
  sectionDirty,
  validateGeneral,
  type FieldError,
  type Section,
} from './generalModel'

const G = 'dashboard.organization.general2'

const ORG_LABELS = [
  { value: 'languages', emoji: '🌐' },
  { value: 'business', emoji: '💰' },
  { value: 'ecommerce', emoji: '🛍' },
  { value: 'gaming', emoji: '🎮' },
  { value: 'music', emoji: '🎸' },
  { value: 'sports', emoji: '⚽' },
  { value: 'cars', emoji: '🚗' },
  { value: 'sales_marketing', emoji: '🚀' },
  { value: 'tech', emoji: '💻' },
  { value: 'photo_video', emoji: '📸' },
  { value: 'pets', emoji: '🐕' },
  { value: 'personal_development', emoji: '📚' },
  { value: 'real_estate', emoji: '🏠' },
  { value: 'beauty_fashion', emoji: '👠' },
  { value: 'travel', emoji: '✈️' },
  { value: 'productivity', emoji: '⏳' },
  { value: 'health_fitness', emoji: '🍎' },
  { value: 'finance', emoji: '📈' },
  { value: 'arts_crafts', emoji: '🎨' },
  { value: 'education', emoji: '📚' },
  { value: 'stem', emoji: '🔬' },
  { value: 'humanities', emoji: '📖' },
  { value: 'professional_skills', emoji: '💼' },
  { value: 'digital_skills', emoji: '💻' },
  { value: 'creative_arts', emoji: '🎨' },
  { value: 'social_sciences', emoji: '🌍' },
  { value: 'test_prep', emoji: '✍️' },
  { value: 'vocational', emoji: '🔧' },
  { value: 'early_education', emoji: '🎯' },
] as const

const SECTION_ICONS: Record<Section, React.ReactNode> = {
  organization: <Buildings size={18} />,
  contact: <ShareNetwork size={18} />,
  language: <Translate size={18} />,
  features: <ToggleRight size={18} />,
  footer: <Rows size={18} />,
}

// The dashboard-wide icons for these two changed; the shared list keeps the old ones.
const ICON_OVERRIDES: Partial<Record<string, React.ComponentType<any>>> = { paths: Circuitry, communities: Garage }
const FEATURE_BY_KEY = Object.fromEntries(OPTIONAL_FEATURES.map((f) => [f.key, f])) as Record<string, OptionalFeature>

function scrollPane(): HTMLElement | null {
  return document.getElementById('org-settings-scroll')
}

/** Scrolls to a section and remembers it in the URL hash (no history entry). */
function goTo(section: Section) {
  document.getElementById(section)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const { pathname, search } = window.location
  window.history.replaceState(window.history.state, '', `${pathname}${search}#${section}`)
}

/** The section at the top of the scroll pane. */
function useActiveSection(): [Section, (_s: Section) => void] {
  const [active, setActive] = React.useState<Section>('organization')
  React.useEffect(() => {
    const root = scrollPane()
    if (!root) return
    const onScroll = () => {
      const top = root.getBoundingClientRect().top + 120
      let current: Section = SECTIONS[0]
      for (const s of SECTIONS) {
        const el = document.getElementById(s)
        if (el && el.getBoundingClientRect().top <= top) current = s
      }
      // At the bottom the last short sections can't reach the top: pick the last one.
      if (root.scrollTop + root.clientHeight >= root.scrollHeight - 4) current = SECTIONS[SECTIONS.length - 1]
      setActive(current)
    }
    root.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => root.removeEventListener('scroll', onScroll)
  }, [])
  return [active, setActive]
}

const OrgEditGeneral: React.FC = () => {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as any
  const queryClient = useQueryClient()
  const { track } = useLHAnalytics('dashboard')
  const { canManageOrg } = useAdminStatus()

  const saved = readGeneral(org)
  const { draft, patch, dirty, reset } = useDraft(saved)
  const [saving, setSaving] = React.useState(false)
  const [showErrors, setShowErrors] = React.useState(false)
  const [active, setActive] = useActiveSection()

  const errors = validateGeneral(draft)
  const invalid = Object.keys(errors).length > 0
  const err = (key: FieldError) =>
    showErrors && errors[key]
      ? key === 'email'
        ? t(`${G}.email_invalid`)
        : t(`dashboard.organization.general.validation.${errors[key]}`)
      : undefined

  // Land on the section in the URL hash (General#features from the old Features tab).
  React.useEffect(() => {
    const hash = window.location.hash.replace('#', '') as Section
    if (!SECTIONS.includes(hash)) return
    const id = window.setTimeout(() => {
      document.getElementById(hash)?.scrollIntoView({ block: 'start' })
      setActive(hash)
    }, 150)
    return () => window.clearTimeout(id)
  }, [setActive])

  const rf = org?.config?.config?.resolved_features
  const featureRows = OPTIONAL_FEATURES.map((f) => ({ feature: f, ...getOptionalFeatureState(rf?.[f.key]) }))
  const switchable = Object.keys(draft.features)
  const onCount = switchable.filter((k) => draft.features[k as keyof typeof draft.features]).length

  const save = async () => {
    if (invalid) {
      setShowErrors(true)
      const first = firstInvalidSection(errors)
      if (first) goTo(first)
      toast.error(t(`${G}.fix_errors`))
      return
    }
    const changes = diffGeneral(draft, saved)
    setSaving(true)
    const loadingToast = toast.loading(t('dashboard.organization.settings.updating'))
    try {
      if (changes.profile) {
        await updateOrganization(
          org.id,
          {
            name: draft.name,
            description: draft.description,
            about: draft.about,
            label: draft.label,
            socials: draft.socials,
            links: draft.links,
            // Only a changed email is sent: it needs the organizations.update right.
            ...(draft.email.trim() !== saved.email ? { email: draft.email.trim() } : {}),
          },
          access_token
        )
      }
      if (changes.footer) await updateOrgFooterTextConfig(org.id, draft.footerText, access_token)
      // Name only; the sending address is always the platform's.
      if (changes.senderName) await updateOrgEmailSenderNameConfig(org.id, draft.emailSenderName, access_token)
      if (changes.language) await updateOrgDefaultLanguageConfig(org.id, draft.defaultLanguage, access_token)
      for (const f of changes.features) await updateOrgFeatureToggle(org.id, f.key, f.enabled, access_token)
      if (changes.liveEditing) {
        const res = await fetch(`${getAPIUrl()}orgs/${org.id}/live-editing`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ live_editing: draft.liveEditing }),
        })
        if (!res.ok) throw new Error(String(res.status))
      }
      await revalidateTags(['organizations'], org.slug)
      await queryClient.invalidateQueries({ queryKey: queryKeys.org.detail(org.slug) })
      track(AnalyticsEvent.OrgGeneralSettingsUpdated, { default_language: draft.defaultLanguage })
      setShowErrors(false)
      toast.success(t('dashboard.organization.settings.update_success'), { id: loadingToast })
    } catch {
      toast.error(t('dashboard.organization.settings.update_error'), { id: loadingToast })
    } finally {
      setSaving(false)
    }
  }

  const discard = () => {
    reset()
    setShowErrors(false)
  }

  const sectionLabel = (s: Section) => t(`${G}.sections.${s}`)
  const hasError = (s: Section) => showErrors && firstInvalidSection(errors) !== null && (
    (s === 'organization' && ['name', 'description', 'about', 'label'].some((k) => k in errors)) ||
    (s === 'contact' && 'email' in errors)
  )
  const logo = org?.logo_image ? getOrgLogoMediaDirectory(org.org_uuid, org.logo_image) : null
  const settingsBase = getUriWithOrg(org?.slug ?? '', '') + '/dash/org/settings'

  return (
    <div className="lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-8" data-testid="general-page">
      {/* Section nav: sticky list on desktop. */}
      <nav aria-label={t(`${G}.jump_to`)} className="hidden lg:block">
        <ul className="sticky top-6 flex flex-col gap-0.5">
          {SECTIONS.map((s) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => {
                  setActive(s)
                  goTo(s)
                }}
                aria-current={active === s ? 'true' : undefined}
                data-section-link={s}
                className={`w-full flex items-center gap-2.5 px-3 h-9 rounded-lg text-sm text-start transition-colors ${
                  active === s ? 'bg-white text-neutral-900 font-semibold nice-shadow' : 'text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100'
                }`}
              >
                <span className="text-neutral-400 [&>svg]:w-4 [&>svg]:h-4">{SECTION_ICONS[s]}</span>
                <span className="flex-1 truncate">{sectionLabel(s)}</span>
                {hasError(s) ? (
                  <WarningCircle size={14} weight="fill" className="text-rose-500 shrink-0" />
                ) : sectionDirty(s, draft, saved) ? (
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" aria-hidden="true" />
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex flex-col gap-5 min-w-0">
        {/* Section jump on phones and tablets. */}
        <label className="lg:hidden block sticky top-2 z-10">
          <span className="sr-only">{t(`${G}.jump_to`)}</span>
          <select
            value={active}
            onChange={(e) => {
              const s = e.target.value as Section
              setActive(s)
              goTo(s)
            }}
            className={`${INPUT} cursor-pointer`}
            data-testid="general-jump"
          >
            {SECTIONS.map((s) => (
              <option key={s} value={s}>
                {sectionLabel(s)}
              </option>
            ))}
          </select>
        </label>

        {canManageOrg === false && (
          <Notice tone="amber" icon={<ShieldWarning size={16} />}>
            {t('dashboard.organization.features.admin_only')}
          </Notice>
        )}

        {/* Organization */}
        <div id="organization" className="scroll-mt-6">
          <SectionCard icon={SECTION_ICONS.organization} title={sectionLabel('organization')} description={t(`${G}.sections.organization_desc`)}>
            <div className="grid gap-5">
              <div className="flex items-center gap-4 rounded-xl ring-1 ring-inset ring-neutral-200/70 p-3">
                {/* The org's own logo keeps its colors on a light tile in dark mode too. */}
                <div data-lh-user-content className="w-12 h-12 rounded-xl bg-white ring-1 ring-inset ring-neutral-900/5 overflow-hidden flex items-center justify-center shrink-0">
                  {logo ? (
                    <img src={logo} alt="" className="w-full h-full object-contain" />
                  ) : (
                    <Buildings size={20} className="text-neutral-400" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-neutral-800">{t(`${G}.logo`)}</p>
                  <p className="text-xs text-neutral-500">{t(`${G}.logo_hint`)}</p>
                </div>
                <Link href={`${settingsBase}/branding`} className={buttonClass('secondary', 'sm')}>
                  {t(`${G}.edit_in_branding`)}
                  <ArrowRight size={12} className="rtl:rotate-180" />
                </Link>
              </div>
              <div className="grid gap-5 md:grid-cols-2">
                <label className="block">
                  <FieldLabel error={err('name')} hint={<CharCount value={draft.name} max={NAME_MAX} />}>
                    {t('dashboard.organization.settings.name')}
                  </FieldLabel>
                  <input
                    id="name"
                    value={draft.name}
                    onChange={(e) => patch({ name: e.target.value })}
                    placeholder={t('dashboard.organization.settings.name_placeholder')}
                    maxLength={NAME_MAX}
                    aria-invalid={!!err('name')}
                    className={INPUT}
                  />
                </label>
                <label className="block">
                  <FieldLabel error={err('label')}>{t('dashboard.organization.settings.label')}</FieldLabel>
                  <select
                    id="label"
                    value={draft.label}
                    onChange={(e) => patch({ label: e.target.value })}
                    aria-invalid={!!err('label')}
                    className={`${INPUT} cursor-pointer`}
                  >
                    <option value="" disabled>
                      {t('dashboard.organization.settings.label_placeholder')}
                    </option>
                    {ORG_LABELS.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.emoji} {t(`dashboard.organization.general.org_labels.${type.value}`)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block">
                <FieldLabel error={err('description')} hint={<CharCount value={draft.description} max={DESCRIPTION_MAX} />}>
                  {t('dashboard.organization.settings.short_description')}
                </FieldLabel>
                <input
                  id="description"
                  value={draft.description}
                  onChange={(e) => patch({ description: e.target.value })}
                  placeholder={t('dashboard.organization.settings.short_description_placeholder')}
                  maxLength={DESCRIPTION_MAX}
                  aria-invalid={!!err('description')}
                  className={INPUT}
                />
              </label>
              <label className="block">
                <FieldLabel error={err('about')} hint={<CharCount value={draft.about} max={ABOUT_MAX} />}>
                  {t('dashboard.organization.settings.about')}
                </FieldLabel>
                <textarea
                  id="about"
                  value={draft.about}
                  onChange={(e) => patch({ about: e.target.value })}
                  placeholder={t('dashboard.organization.settings.about_placeholder')}
                  maxLength={ABOUT_MAX}
                  rows={5}
                  className={TEXTAREA}
                />
              </label>
            </div>
          </SectionCard>
        </div>

        {/* Contact & links */}
        <div id="contact" className="scroll-mt-6">
          <SectionCard icon={SECTION_ICONS.contact} title={sectionLabel('contact')} description={t(`${G}.sections.contact_desc`)}>
            <div className="grid gap-6">
              <label className="block max-w-md">
                <FieldLabel error={err('email')}>{t(`${G}.email`)}</FieldLabel>
                <div className="relative">
                  <EnvelopeSimple size={15} className="absolute start-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                  <input
                    id="email"
                    type="email"
                    dir="ltr"
                    value={draft.email}
                    onChange={(e) => patch({ email: e.target.value })}
                    placeholder={t(`${G}.email_placeholder`)}
                    aria-invalid={!!err('email')}
                    className={`${INPUT} ps-9`}
                  />
                </div>
                <FieldHint>{t(`${G}.email_hint`)}</FieldHint>
              </label>
              <OrgEditSocials socials={draft.socials} links={draft.links} onChange={(next) => patch(next)} disabled={saving} />
            </div>
          </SectionCard>
        </div>

        {/* Language & email */}
        <div id="language" className="scroll-mt-6">
          <SectionCard icon={SECTION_ICONS.language} title={sectionLabel('language')} description={t(`${G}.sections.language_desc`)}>
            <div className="grid gap-5 md:grid-cols-2">
              <label className="block">
                <FieldLabel>{t('dashboard.organization.settings.default_language')}</FieldLabel>
                <select
                  id="defaultLanguage"
                  value={draft.defaultLanguage}
                  onChange={(e) => patch({ defaultLanguage: e.target.value })}
                  className={`${INPUT} cursor-pointer`}
                >
                  {AVAILABLE_LANGUAGES.map((lang) => (
                    <option key={lang.code} value={lang.code}>
                      {lang.code.toUpperCase()} · {lang.nativeName}
                    </option>
                  ))}
                </select>
                <FieldHint>{t('dashboard.organization.settings.default_language_desc')}</FieldHint>
              </label>
              <label className="block">
                <FieldLabel hint={<CharCount value={draft.emailSenderName} max={MAX_EMAIL_SENDER_NAME_LENGTH} />}>
                  {t('dashboard.organization.settings.email_sender_name')}
                </FieldLabel>
                <input
                  id="emailSenderName"
                  value={draft.emailSenderName}
                  onChange={(e) => patch({ emailSenderName: e.target.value })}
                  placeholder={org?.name || t('dashboard.organization.settings.email_sender_name_placeholder')}
                  maxLength={MAX_EMAIL_SENDER_NAME_LENGTH}
                  className={INPUT}
                />
                <FieldHint>{t('dashboard.organization.settings.email_sender_name_desc')}</FieldHint>
              </label>
            </div>
          </SectionCard>
        </div>

        {/* Features */}
        <div id="features" className="scroll-mt-6">
          <SectionCard
            icon={SECTION_ICONS.features}
            title={sectionLabel('features')}
            description={t(`${G}.sections.features_desc`)}
            actions={<Chip tone="neutral">{t(`${G}.features_count`, { count: onCount, total: switchable.length })}</Chip>}
          >
            <div className="flex flex-col gap-5" data-testid="general-features">
              {FEATURE_GROUPS.map((group) => (
                <div key={group.key}>
                  <h3 className="text-xs font-semibold text-neutral-500 mb-2">{t(`${G}.groups.${group.key}`)}</h3>
                  <ul className="rounded-xl ring-1 ring-inset ring-neutral-200/70 divide-y divide-neutral-100">
                    {group.features.map((key) => {
                      const row = featureRows.find((r) => r.feature.key === key)
                      const feature = FEATURE_BY_KEY[key]
                      if (!row || !feature) return null
                      const Icon = ICON_OVERRIDES[key] ?? feature.Icon
                      const locked = row.status === 'locked'
                      const byPlatform = !locked && row.disabledBy === 'platform'
                      const on = locked || byPlatform ? false : !!draft.features[key]
                      const id = `feature-${key}`
                      return (
                        <li key={key} className="flex items-center gap-3 px-4 py-3" data-feature-toggle={key} data-state={locked ? 'locked' : on ? 'on' : 'off'}>
                          <span
                            className={`w-8 h-8 shrink-0 rounded-lg flex items-center justify-center ${
                              on ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-400'
                            }`}
                          >
                            <Icon size={16} weight="fill" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <label htmlFor={id} className={`text-sm font-medium ${locked ? 'text-neutral-500' : 'text-neutral-900 cursor-pointer'}`}>
                              {t(feature.labelKey)}
                            </label>
                            <p className="text-xs leading-relaxed text-neutral-500">{t(feature.descriptionKey)}</p>
                            {byPlatform && <p className="text-xs text-amber-700 mt-0.5">{t('dashboard.organization.features.platform_disabled')}</p>}
                          </div>
                          {locked ? (
                            <Link
                              href={`${settingsBase}/overview?section=features`}
                              className="shrink-0"
                              title={t(`${G}.see_plans`)}
                              data-testid={`feature-locked-${key}`}
                            >
                              <Chip icon={<LockSimple size={11} weight="fill" />}>
                                {t(`${G}.needs_plan`, { plan: planNameById(t, row.upgradePlan ?? 'pro', row.upgradePlan ?? 'pro') })}
                              </Chip>
                            </Link>
                          ) : (
                            <Switch
                              id={id}
                              checked={on}
                              onCheckedChange={(checked) => patch({ features: { ...draft.features, [key]: checked } })}
                              disabled={!canManageOrg || byPlatform || saving}
                              aria-label={t(feature.labelKey)}
                            />
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
              <div>
                <h3 className="text-xs font-semibold text-neutral-500 mb-2">{t(`${G}.groups.editor`)}</h3>
                <div className="flex items-center gap-3 rounded-xl ring-1 ring-inset ring-neutral-200/70 px-4 py-3" data-feature-toggle="live_editing">
                  <span className={`w-8 h-8 shrink-0 rounded-lg flex items-center justify-center ${draft.liveEditing ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-400'}`}>
                    <Broadcast size={16} weight="fill" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <label htmlFor="org-live-editing" className="text-sm font-medium text-neutral-900 cursor-pointer">
                      {t('editor.live_editing.title')}
                    </label>
                    <p className="text-xs leading-relaxed text-neutral-500">{t('editor.live_editing.org_desc')}</p>
                    <p className="text-xs text-neutral-400">{t('editor.live_editing.org_hint')}</p>
                  </div>
                  <Switch
                    id="org-live-editing"
                    data-testid="org-live-editing"
                    checked={draft.liveEditing}
                    onCheckedChange={(checked) => patch({ liveEditing: checked })}
                    disabled={!canManageOrg || saving}
                    aria-label={t('editor.live_editing.title')}
                  />
                </div>
              </div>
              {featureRows.some((r) => r.status === 'locked') && (
                <Link href={`${settingsBase}/overview?section=features`} className="inline-flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-neutral-800 self-start">
                  {t(`${G}.see_plans`)}
                  <ArrowRight size={12} className="rtl:rotate-180" />
                </Link>
              )}
            </div>
          </SectionCard>
        </div>

        {/* Footer */}
        <div id="footer" className="scroll-mt-6">
          <SectionCard icon={SECTION_ICONS.footer} title={sectionLabel('footer')} description={t(`${G}.sections.footer_desc`)}>
            <div className="grid gap-4">
              <label className="block">
                <FieldLabel hint={<CharCount value={draft.footerText} max={FOOTER_MAX} />}>
                  {t('dashboard.organization.settings.footer_text')}
                </FieldLabel>
                <input
                  id="footerText"
                  value={draft.footerText}
                  onChange={(e) => patch({ footerText: e.target.value })}
                  placeholder={t('dashboard.organization.settings.footer_text_placeholder')}
                  maxLength={FOOTER_MAX}
                  className={INPUT}
                />
              </label>
              <FooterLinksVignette
                socials={draft.socials as Record<string, string | undefined>}
                links={draft.links}
                name={draft.name}
                footerText={draft.footerText}
                label={t('dashboard.organization.branding.vignettes.footer')}
              />
            </div>
          </SectionCard>
        </div>
      </div>

      <StickySaveBar visible={dirty || saving} saving={saving} onSave={save} onDiscard={discard} />
    </div>
  )
}

export default OrgEditGeneral
