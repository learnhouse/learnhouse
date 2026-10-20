/**
 * Billing period of a subscription offer. Offers created before the period
 * became configurable carry no value and have always renewed monthly.
 */
export type BillingInterval = 'month' | 'year'

export const BILLING_INTERVALS: BillingInterval[] = ['month', 'year']

export function normalizeBillingInterval(value: unknown): BillingInterval {
  return value === 'year' ? 'year' : 'month'
}

/** Accepts i18next's `t`; without one, labels fall back to English. */
type Translate = (key: string, options: { defaultValue: string }) => string

/** "per month" / "per year", for price captions. */
export function billingIntervalLabel(value: unknown, t?: Translate): string {
  const year = normalizeBillingInterval(value) === 'year'
  const fallback = year ? 'per year' : 'per month'
  return t ? t(year ? 'payments.billing_per_year' : 'payments.billing_per_month', { defaultValue: fallback }) : fallback
}

/** "/ month" / "/ year", for inline price suffixes. */
export function billingIntervalSuffix(value: unknown, t?: Translate): string {
  const year = normalizeBillingInterval(value) === 'year'
  const fallback = year ? '/ year' : '/ month'
  return t ? t(year ? 'payments.billing_suffix_year' : 'payments.billing_suffix_month', { defaultValue: fallback }) : fallback
}

/** "Monthly" / "Yearly", for selects and badges. */
export function billingIntervalName(value: unknown): string {
  return normalizeBillingInterval(value) === 'year' ? 'Yearly' : 'Monthly'
}
