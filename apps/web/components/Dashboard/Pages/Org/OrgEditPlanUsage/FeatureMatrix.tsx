'use client'
// Every feature by area, each with where it comes from (plan, POC, add-on) or
// the plan that has it, and its on/off switch when the org can flip it.
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { CheckCircle, Handshake, LockSimple, PlusCircle, SquaresFour } from '@phosphor-icons/react'
import { SectionCard, SegmentedControl, StatusPill, type Status } from '@/design'
import { planNameById } from '@/app/(hub)/_billing/planText'
import {
  featureCounts,
  groupFeatures,
  type FeatureFilter,
  type PlanFeature,
} from '@services/orgs/planOverview'

const P = 'dashboard.organization.plan_usage.features'

const STATE_STATUS: Record<PlanFeature['state'], Status> = {
  included: 'success',
  poc: 'info',
  addon: 'info',
  locked: 'neutral',
  edition: 'neutral',
}

const STATE_ICON: Record<PlanFeature['state'], React.ReactNode> = {
  included: <CheckCircle size={12} weight="fill" />,
  poc: <Handshake size={12} weight="fill" />,
  addon: <PlusCircle size={12} weight="fill" />,
  locked: <LockSimple size={12} weight="fill" />,
  edition: <LockSimple size={12} weight="fill" />,
}

// Units for the features whose plan limit is worth showing next to the name.
const LIMIT_KEY: Record<string, string> = { courses: 'up_to', assignments: 'up_to', newsletter: 'per_month' }

function StateChip({ feature }: { feature: PlanFeature }) {
  const { t } = useTranslation()
  const label =
    feature.state === 'locked'
      ? feature.upgrade_plan
        ? t(`${P}.state.locked`, { plan: planNameById(t, feature.upgrade_plan, feature.upgrade_plan) })
        : t(`${P}.state.locked_none`)
      : t(`${P}.state.${feature.state}`)
  return (
    <StatusPill status={STATE_STATUS[feature.state]} icon={STATE_ICON[feature.state]}>
      {label}
    </StatusPill>
  )
}

function FeatureRow({ feature, settingsBase }: { feature: PlanFeature; settingsBase: string }) {
  const { t } = useTranslation()
  const have = feature.state !== 'locked' && feature.state !== 'edition'
  const limitKey = LIMIT_KEY[feature.key]
  const showToggle = have && !!feature.toggle_tab
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 min-w-0" data-feature={feature.key} data-state={feature.state}>
      <div className="min-w-0 flex-1">
        <p className={`text-sm truncate ${have ? 'text-neutral-800' : 'text-neutral-500'}`}>{t(`${P}.names.${feature.key}`)}</p>
        {have && limitKey && feature.limit > 0 && (
          <p className="text-[11px] text-neutral-400 tabular-nums">
            {t(`${P}.${limitKey}`, { formatted: feature.limit.toLocaleString() })}
          </p>
        )}
      </div>
      {showToggle && (
        <Link
          // The feature switches live in General → Features since the tabs merged.
          href={feature.toggle_tab === 'features' ? `${settingsBase}/general#features` : `${settingsBase}/${feature.toggle_tab}`}
          className="hidden sm:inline-flex items-center gap-1 text-[11px] font-medium text-neutral-400 hover:text-neutral-700 whitespace-nowrap"
          title={t(`${P}.change`)}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${feature.enabled ? 'bg-emerald-500' : 'bg-neutral-300'}`} aria-hidden="true" />
          {feature.enabled ? t(`${P}.on`) : feature.disabled_by === 'platform' ? t(`${P}.off_platform`) : t(`${P}.off`)}
        </Link>
      )}
      <StateChip feature={feature} />
    </li>
  )
}

export default function FeatureMatrix({
  features,
  areas,
  settingsBase,
}: {
  features: PlanFeature[]
  areas: string[]
  settingsBase: string
}) {
  const { t } = useTranslation()
  const [filter, setFilter] = React.useState<FeatureFilter>('all')
  const counts = featureCounts(features)
  const groups = groupFeatures(features, areas, filter)

  return (
    <SectionCard
      icon={<SquaresFour size={18} />}
      title={t(`${P}.title`)}
      description={t(`${P}.desc`)}
      actions={
        <SegmentedControl<FeatureFilter>
          value={filter}
          onChange={setFilter}
          ariaLabel={t(`${P}.title`)}
          options={[
            { key: 'all', label: t(`${P}.filter_all`), count: counts.all },
            { key: 'have', label: t(`${P}.filter_have`), count: counts.have },
            { key: 'missing', label: t(`${P}.filter_missing`), count: counts.missing },
          ]}
        />
      }
    >
      {groups.length === 0 ? (
        <p className="text-sm text-neutral-400 text-center py-6">{t(`${P}.empty`)}</p>
      ) : (
        <div className="lg:columns-2 gap-5" data-testid="plan-feature-matrix">
          {groups.map((g) => (
            <div key={g.area} className="min-w-0 break-inside-avoid mb-5 last:mb-0" data-area={g.area}>
              <h3 className="text-xs font-semibold text-neutral-500 mb-2">{t(`${P}.areas.${g.area}`, { defaultValue: g.area })}</h3>
              <ul className="rounded-xl ring-1 ring-inset ring-neutral-200/70 divide-y divide-neutral-100">
                {g.features.map((f) => (
                  <FeatureRow key={f.key} feature={f} settingsBase={settingsBase} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  )
}
