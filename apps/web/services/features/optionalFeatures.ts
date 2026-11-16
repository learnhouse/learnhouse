/**
 * The optional features an organization can turn on or off, and the one rule
 * for reading their state out of resolved_features.
 *
 * Every optional feature is in exactly one state:
 *   - 'on':     in the plan and turned on; shows in the main navigation.
 *   - 'off':    in the plan but turned off, by the org (Features settings) or
 *               by the platform. Turning it back on is a settings change.
 *   - 'locked': not in the plan. Unlocking it is an upgrade, to `upgradePlan`.
 *
 * Keep the keys in sync with ORG_TOGGLEABLE_FEATURES in the API
 * (src/security/features_utils/resolve.py).
 */

import {
  ChalkboardSimple,
  Garage,
  Lightning,
  CurrencyCircleDollar,
  FolderSimple,
  Headphones,
  Circuitry,
  VideoCamera,
  Newspaper,
} from '@phosphor-icons/react'
import type { IconProps } from '@phosphor-icons/react'
import type { ComponentType } from 'react'

import type { DisabledBy, ResolvedFeaturePayload } from '@lib/features/gateReason'
import type { PlanLevel } from '@services/plans/plans'

export type OptionalFeatureKey =
  | 'paths'
  | 'folders'
  | 'communities'
  | 'podcasts'
  | 'live_sessions'
  | 'boards'
  | 'playgrounds'
  | 'payments'
  | 'newsletter'

export interface OptionalFeature {
  key: OptionalFeatureKey
  /** Dashboard page for the feature. */
  href: string
  /** i18n key for the feature name. */
  labelKey: string
  /** i18n key for the one-line description on the Features settings page. */
  descriptionKey: string
  Icon: ComponentType<IconProps>
}

/** In sidebar order. */
export const OPTIONAL_FEATURES: OptionalFeature[] = [
  { key: 'paths', href: '/dash/paths', labelKey: 'paths.title', descriptionKey: 'dashboard.organization.features.toggles.paths.description', Icon: Circuitry },
  { key: 'folders', href: '/dash/library', labelKey: 'library.library', descriptionKey: 'dashboard.organization.features.toggles.folders.description', Icon: FolderSimple },
  { key: 'communities', href: '/dash/communities', labelKey: 'communities.title', descriptionKey: 'dashboard.organization.features.toggles.communities.description', Icon: Garage },
  { key: 'podcasts', href: '/dash/podcasts', labelKey: 'podcasts.podcasts', descriptionKey: 'dashboard.organization.features.toggles.podcasts.description', Icon: Headphones },
  { key: 'live_sessions', href: '/dash/live-sessions', labelKey: 'live_sessions.title', descriptionKey: 'dashboard.organization.features.toggles.live_sessions.description', Icon: VideoCamera },
  { key: 'boards', href: '/dash/boards', labelKey: 'boards.boards', descriptionKey: 'dashboard.organization.features.toggles.boards.description', Icon: ChalkboardSimple },
  { key: 'playgrounds', href: '/dash/playgrounds', labelKey: 'common.playgrounds', descriptionKey: 'dashboard.organization.features.toggles.playgrounds.description', Icon: Lightning },
  { key: 'payments', href: '/dash/payments/overview', labelKey: 'common.payments', descriptionKey: 'dashboard.organization.features.toggles.payments.description', Icon: CurrencyCircleDollar },
  { key: 'newsletter', href: '/dash/newsletter/overview', labelKey: 'newsletter.common.title', descriptionKey: 'dashboard.organization.features.toggles.newsletter.description', Icon: Newspaper },
]

// The switches are a section of General since the Features tab merged into it.
export const FEATURES_SETTINGS_HREF = '/dash/org/settings/general#features'

export type OptionalFeatureStatus = 'on' | 'off' | 'locked'

export interface OptionalFeatureState {
  status: OptionalFeatureStatus
  /** Plan that unlocks the feature; set when status is 'locked'. */
  upgradePlan: PlanLevel | null
  /** Who turned it off; set when status is 'off' and the API says. */
  disabledBy: DisabledBy | null
}

export function getOptionalFeatureState(
  resolved: ResolvedFeaturePayload | null | undefined
): OptionalFeatureState {
  if (resolved?.enabled === true) {
    return { status: 'on', upgradePlan: null, disabledBy: null }
  }
  if (resolved?.available === false) {
    const plan = resolved.upgrade_plan ?? resolved.required_plan ?? null
    return { status: 'locked', upgradePlan: plan as PlanLevel | null, disabledBy: null }
  }
  return { status: 'off', upgradePlan: null, disabledBy: resolved?.disabled_by ?? null }
}
