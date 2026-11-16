'use client'

import React from 'react'
import { useTranslation } from 'react-i18next'

import { useOrg } from '@components/Contexts/OrgContext'
import { useResolvedFeature } from '@components/Hooks/useResolvedFeature'
import { getUpgradeUrl } from '@services/config/config'
import {
  FEATURE_METADATA,
  FeatureKey,
  getFeatureMeta,
} from '@services/features/featureMetadata'
import PlanBadge from '@components/Dashboard/Shared/PlanRestricted/PlanBadge'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import {
  FEATURES_SETTINGS_HREF,
  OPTIONAL_FEATURES,
} from '@services/features/optionalFeatures'
import type { DisabledBy } from '@lib/features/gateReason'
import type { PlanLevel } from '@services/plans/plans'
import Link from 'next/link'
import { CheckCircle, CircleNotch } from '@phosphor-icons/react'
import { billingCheckout, fetchSubscription } from '@/app/(hub)/billing/_lib/billingClient'
import { planNameById } from '@/app/(hub)/_billing/planText'
import { CONTACT_SALES_URL } from '@services/plans/contact'
import FeaturePreview, { accentFor, hasPreview } from './FeaturePreview'
import { useLHAnalytics, useTrackView, AnalyticsEvent } from '@services/analytics'

export interface FeatureGateProps {
  /** Feature key (drives icon, copy, upsell tier; see featureMetadata.ts). */
  feature: FeatureKey
  /**
   * Org slug for the upgrade deep-link in the plan-locked state. Optional;
   * falls back to the current org context when omitted.
   */
  orgslug?: string
  /**
   * Picks the wording of the admin-disabled card.
   * - 'dashboard': admin context, copy addressed to someone who can flip the
   *   toggle back on; org admins get a link to the Features settings.
   * - 'public': learner-facing context, plain "not available" message.
   */
  context?: 'dashboard' | 'public'
  /**
   * Escape hatch for a surface that HOSTS the toggle controlling this very
   * feature: without it, turning the feature off unmounts its own switch and
   * the admin is locked out with no way back. Bypasses the admin-disabled card
   * only; a plan-locked feature still shows the upgrade card.
   */
  allowWhenDisabled?: boolean
  /** Content rendered when the feature is granted. */
  children: React.ReactNode
}

/**
 * Unified feature gate. Reads resolved_features for the given feature, then:
 *   - renders children when granted
 *   - shows the upgrade card when the plan does not include the feature
 *   - shows the disabled card when the plan includes it but it is turned off;
 *     in the dashboard it links org admins to the Features settings
 *
 * Replaces the previous PlanRestrictedFeature + FeatureDisabledView nesting.
 */
export default function FeatureGate({
  feature,
  orgslug,
  context = 'dashboard',
  allowWhenDisabled = false,
  children,
}: FeatureGateProps) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const state = useResolvedFeature(feature, { allowWhenDisabled })
  const resolvedSlug = orgslug ?? org?.slug ?? 'default'

  if (!state.reason) {
    return <>{children}</>
  }

  if (state.reason === 'disabled') {
    return (
      <DisabledCard
        feature={feature}
        context={context}
        disabledBy={state.disabledBy}
        t={t}
      />
    )
  }

  return (
    <UpgradeCard
      feature={feature}
      currentPlan={state.currentPlan}
      upsellPlan={state.requiredPlan}
      orgSlug={resolvedSlug}
      t={t}
    />
  )
}

function UpgradeCard({
  feature,
  currentPlan,
  upsellPlan: resolvedUpsellPlan,
  orgSlug,
  t,
}: {
  feature: FeatureKey
  currentPlan: ReturnType<typeof useResolvedFeature>['currentPlan']
  /** Plan that actually includes the feature, from the backend. */
  upsellPlan: PlanLevel | null
  orgSlug: string
  t: ReturnType<typeof useTranslation>['t']
}) {
  const meta = getFeatureMeta(feature)
  const Icon = meta.Icon
  const { canManageOrg } = useAdminStatus()
  // The backend knows which plan includes the feature; the catalog tier is
  // only a fallback (it can name a plan that does not include it).
  const upsellPlan = resolvedUpsellPlan ?? meta.upsellPlan
  const contactSales = upsellPlan === 'enterprise'
  // Deep-link straight to the Confirm step for the plan this feature needs.
  const upgradeUrl = contactSales ? CONTACT_SALES_URL : getUpgradeUrl(orgSlug, upsellPlan)
  const planLabel = planNameById(t, upsellPlan, upsellPlan)
  const gate = `common.plans.gate.${feature}`
  const headline = t(`${gate}.title`, { defaultValue: '' })
  const benefits = (['b1', 'b2', 'b3'] as const)
    .map((k) => t(`${gate}.${k}`, { defaultValue: '' }))
    .filter(Boolean)

  const org = useOrg() as any
  const compareUrl = getUpgradeUrl(orgSlug)
  const [busy, setBusy] = React.useState(false)
  // One click from the gate: an org without a subscription goes straight to
  // Stripe checkout for the plan that unlocks this feature (Stripe's page is
  // the confirmation). An existing subscriber changes plan on the billing
  // page's confirm step instead, so a plan change is never made blind; and
  // when billing isn't reachable from here, that page is the fallback too.
  const startUpgrade = async () => {
    setBusy(true)
    try {
      const orgId = org?.id
      if (orgId && (await fetchSubscription(orgId)) === null) {
        const session = await billingCheckout({ plan: upsellPlan as any, billing: 'monthly', orgId, orgSlug })
        if (session?.url) {
          window.location.href = session.url
          return
        }
      }
    } catch {
      // fall through to the billing page
    }
    if (upgradeUrl) window.location.href = upgradeUrl
    setBusy(false)
  }

  // Impression: fires once per mount everywhere a feature is gated by plan, which
  // distinguishes "feature locked behind upgrade" across the whole app.
  const { track } = useLHAnalytics('dashboard')
  useTrackView(
    AnalyticsEvent.FeatureGateUpgradeShown,
    { feature, required_plan: upsellPlan, current_plan: currentPlan },
    true,
    'dashboard',
  )

  const accent = accentFor(feature)
  const badge = (
    <PlanBadge currentPlan={currentPlan} requiredPlan={upsellPlan} size="md" alwaysShow noMargin />
  )

  return (
    <GateShell variant="upgrade" feature={feature} wide>
      <div className="overflow-hidden rounded-2xl bg-white nice-shadow">
        {/* The feature itself, in its own color: a small mock of the real screen. */}
        <div className={`relative bg-gradient-to-b ${accent.wash} to-white px-6 pt-8 pb-12 sm:px-12`}>
          {/* A dotted field in the feature's color, fading out toward the copy. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage: `radial-gradient(rgba(${accent.dots},0.22) 1px, transparent 1px)`,
              backgroundSize: '14px 14px',
              maskImage: 'linear-gradient(to bottom, black, transparent 85%)',
              WebkitMaskImage: 'linear-gradient(to bottom, black, transparent 85%)',
            }}
          />
          {hasPreview(feature) ? (
            <div className="relative mx-auto max-w-sm" data-testid="gate-preview">
              <FeaturePreview feature={feature} />
            </div>
          ) : (
            <div className="h-10" />
          )}
        </div>
        <div className="relative flex flex-col items-center px-6 pb-10 text-center sm:px-12">
          <div className="-mt-8 mb-5 inline-flex rounded-xl bg-white p-3.5 nice-shadow">
            <Icon size={28} weight="duotone" className={accent.icon} />
          </div>
          <h2 className="max-w-md text-lg font-semibold leading-snug tracking-tight text-neutral-900" data-testid="gate-title">
            {headline || t(meta.titleKey)}
          </h2>
          {benefits.length > 0 ? (
            <ul className="mt-4 flex max-w-sm flex-col gap-2.5 text-start" data-testid="gate-benefits">
              {benefits.map((b) => (
                <li key={b} className="flex items-start gap-2.5 text-sm text-neutral-600">
                  <CheckCircle size={17} weight="fill" className={`mt-px shrink-0 ${accent.icon}`} />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 max-w-md text-sm leading-relaxed text-neutral-500">{t(meta.descriptionKey)}</p>
          )}
          <div className="mt-8 flex flex-col items-center gap-3">
            {canManageOrg && upgradeUrl ? (
              <a
                href={upgradeUrl}
                target={contactSales ? '_blank' : undefined}
                rel={contactSales ? 'noopener noreferrer' : undefined}
                onClick={(e) => {
                  track(AnalyticsEvent.FeatureGateUpgradeClicked, {
                    feature,
                    upsell_plan: upsellPlan,
                    mode: contactSales ? 'contact' : 'checkout',
                  })
                  if (!contactSales) {
                    e.preventDefault()
                    startUpgrade()
                  }
                }}
                aria-busy={busy}
                className={`flex items-center gap-2 rounded-lg bg-white px-6 py-2.5 font-semibold text-neutral-700 nice-shadow transition-colors hover:bg-neutral-50 ${busy ? 'pointer-events-none opacity-70' : ''}`}
                data-testid="gate-upgrade"
              >
                {busy && <CircleNotch size={14} className="animate-spin" />}
                {contactSales ? (
                  <span>{t('common.plans.gate.talk_to_us')}</span>
                ) : (
                  <>
                    <span>{t('common.plans.upgrade_to')}</span>
                    {badge}
                  </>
                )}
              </a>
            ) : (
              <p className="flex items-center gap-2 text-sm text-neutral-500">
                {t('common.plans.gate.ask_admin', { plan: planLabel })}
              </p>
            )}
            <p className="flex flex-wrap items-center justify-center gap-x-2 text-xs text-neutral-400">
              <span>
                {t('common.plans.current_plan')}:{' '}
                <span className="font-medium capitalize text-neutral-500">{planNameById(t, currentPlan, currentPlan)}</span>
              </span>
              {canManageOrg && !contactSales && compareUrl && (
                <>
                  <span aria-hidden="true">·</span>
                  <a href={compareUrl} className="font-medium text-neutral-500 underline-offset-2 hover:text-neutral-800 hover:underline">
                    {t('common.plans.gate.compare')}
                  </a>
                </>
              )}
            </p>
          </div>
        </div>
      </div>
    </GateShell>
  )
}

const isOptionalFeature = (feature: FeatureKey) =>
  OPTIONAL_FEATURES.some((f) => f.key === feature)

function DisabledCard({
  feature,
  context,
  disabledBy,
  t,
}: {
  feature: FeatureKey
  context: 'dashboard' | 'public'
  disabledBy?: DisabledBy
  t: ReturnType<typeof useTranslation>['t']
}) {
  const { canManageOrg } = useAdminStatus()
  // The platform kill switch is not the org's to undo, so no settings link.
  const byPlatform = disabledBy === 'platform'
  const showSettingsLink =
    context === 'dashboard' && canManageOrg && !byPlatform && isOptionalFeature(feature)
  const meta = getFeatureMeta(feature)
  const Icon = meta.Icon
  const featureDisplayName = t(
    `common.features.disabled.names.${feature}`,
    t(meta.titleKey)
  )

  return (
    <GateShell variant="disabled" feature={feature}>
      <GateCard gradient="from-gray-50/80">
        <IconBubble>
          <Icon size={32} weight="duotone" className="text-gray-500" />
        </IconBubble>

        <h2 className="text-lg font-semibold text-gray-800 mb-2">
          {context === 'public'
            ? t('common.features.disabled.public.title', { feature: featureDisplayName })
            : t('common.features.disabled.dashboard.title', { feature: featureDisplayName })}
        </h2>

        <p className="text-gray-500 text-sm mb-6 max-w-sm leading-relaxed">
          {context === 'public'
            ? t('common.features.disabled.public.description')
            : byPlatform
              ? t('common.features.disabled.platform.description')
              : t('common.features.disabled.dashboard.description')}
        </p>

        {showSettingsLink ? (
          <Link
            href={FEATURES_SETTINGS_HREF}
            className="bg-white text-gray-700 px-6 py-2.5 rounded-lg text-sm font-semibold hover:bg-gray-50 transition-colors nice-shadow"
          >
            {t('common.features.disabled.enable_feature')}
          </Link>
        ) : (
          <div className="bg-gray-100 text-gray-600 px-4 py-2 rounded-lg text-sm font-medium">
            {t('common.features.disabled.status')}
          </div>
        )}
      </GateCard>
    </GateShell>
  )
}

function GateShell({
  children,
  variant,
  feature,
  wide = false,
}: {
  children: React.ReactNode
  variant: 'upgrade' | 'disabled'
  feature: FeatureKey
  wide?: boolean
}) {
  // Fill the rest of the viewport below wherever the gate starts (under a
  // page header or straight below the top), so the card sits centred in what
  // is visible instead of hugging the top.
  const ref = React.useRef<HTMLDivElement>(null)
  const [minHeight, setMinHeight] = React.useState<number | null>(null)
  React.useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current
      if (!el) return
      const top = el.getBoundingClientRect().top + window.scrollY
      setMinHeight(Math.max(320, Math.round(window.innerHeight - top)))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])
  return (
    <div
      ref={ref}
      data-feature-gate={variant}
      data-feature={feature}
      style={minHeight ? { minHeight } : undefined}
      className="flex items-center justify-center min-h-[60vh] w-full p-4 sm:p-6 bg-[#f8f8f8]"
    >
      <div className={`w-full ${wide ? 'max-w-xl' : 'max-w-lg'}`}>{children}</div>
    </div>
  )
}

function GateCard({
  gradient,
  children,
}: {
  gradient: string
  children: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-xl nice-shadow overflow-hidden">
      <div className={`flex flex-col items-center justify-center py-14 px-6 text-center bg-gradient-to-b ${gradient} via-white to-white`}>
        {children}
      </div>
    </div>
  )
}

function IconBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white p-4 rounded-xl nice-shadow mb-6 inline-flex">
      {children}
    </div>
  )
}

// Re-export so callers can type-check the feature prop.
export type { FeatureKey }
export { FEATURE_METADATA }
