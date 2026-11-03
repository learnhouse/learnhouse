// Translation helpers for the static plan catalog in ./plans.ts. The catalog
// keeps English fallbacks; these resolve the displayed text through i18next.
import type { Plan, PlanFeature, PlanId } from './plans'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TFn = (..._args: any[]) => any

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

export function planName(t: TFn, plan: { id: PlanId | string; name: string }): string {
  return planNameById(t, plan.id, plan.name)
}

export function planNameById(t: TFn, id: string, fallback: string): string {
  return t(`billing.catalog.names.${id.replace(/-/g, '_')}`, { defaultValue: fallback })
}

/** Translate a plan name referenced by its English label (e.g. `inheritsFrom`). */
export function planNameByLabel(t: TFn, label: string): string {
  return t(`billing.catalog.names.${slug(label)}`, { defaultValue: label })
}

export function planTagline(t: TFn, plan: Plan): string {
  return t(`billing.catalog.taglines.${plan.id.replace(/-/g, '_')}`, { defaultValue: plan.tagline })
}

export function featureLabel(t: TFn, f: PlanFeature): string {
  if (f.limitKey) {
    const unlimited = /^unlimited/i.test(f.label)
    const n = parseInt(f.label.replace(/,/g, ''), 10)
    const formatted = Number.isNaN(n) ? '' : n.toLocaleString()
    if (f.limitKey === 'courses') {
      if (unlimited) return t('billing.catalog.unlimited_courses')
      if (!Number.isNaN(n)) return t('billing.catalog.courses_count', { count: n, formatted })
    } else if (f.limitKey === 'members') {
      if (unlimited) return t('billing.catalog.unlimited_members')
      if (!Number.isNaN(n)) return t('billing.catalog.members_count', { count: n, formatted })
    } else if (f.limitKey === 'admin_seats') {
      if (unlimited) return t('billing.catalog.unlimited_admin_seats')
      if (!Number.isNaN(n)) return t('billing.catalog.admin_seats_count', { count: n, formatted })
    }
  }
  return t(`billing.catalog.features.${slug(f.label)}`, { defaultValue: f.label })
}

export function featureBadge(t: TFn, f: PlanFeature): string | undefined {
  if (!f.badge) return f.badge
  if (f.badgeLimitKey === 'ai_credits') {
    const n = parseInt(f.badge.replace(/,/g, ''), 10)
    if (!Number.isNaN(n)) return t('billing.catalog.credits_badge', { formatted: n.toLocaleString() })
  }
  return t(`billing.catalog.badges.${slug(f.badge)}`, { defaultValue: f.badge })
}

export function packLabel(t: TFn, pack: { type: string; quantity: number; label: string }): string {
  if (pack.type === 'ai_credits') {
    return t('billing.catalog.pack_ai_credits', { formatted: pack.quantity.toLocaleString() })
  }
  return pack.label
}
