/**
 * Billing period of a subscription offer. Offers created before the period
 * became configurable carry no value and have always renewed monthly.
 */
export type BillingInterval = 'month' | 'year'

export const BILLING_INTERVALS: BillingInterval[] = ['month', 'year']

export function normalizeBillingInterval(value: unknown): BillingInterval {
  return value === 'year' ? 'year' : 'month'
}

/** "per month" / "per year", for price captions. */
export function billingIntervalLabel(value: unknown): string {
  return normalizeBillingInterval(value) === 'year' ? 'per year' : 'per month'
}

/** "/ month" / "/ year", for inline price suffixes. */
export function billingIntervalSuffix(value: unknown): string {
  return normalizeBillingInterval(value) === 'year' ? '/ year' : '/ month'
}

/** "Monthly" / "Yearly", for selects and badges. */
export function billingIntervalName(value: unknown): string {
  return normalizeBillingInterval(value) === 'year' ? 'Yearly' : 'Monthly'
}
