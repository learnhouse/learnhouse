'use client'
import React from 'react'
import { Receipt, TrendingUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatCurrency, formatDate as fmtDate } from '@/lib/format'
import type { UpcomingInvoice } from '../_lib/billingClient'

function formatMoney(minorUnits: number, currency: string, lng: string): string {
  return formatCurrency(minorUnits / 100, currency.toUpperCase(), lng)
}

function formatDate(unixSeconds: number | undefined, lng: string): string | null {
  if (!unixSeconds) return null
  return fmtDate(unixSeconds * 1000, lng, {
    dateStyle: undefined,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * "What am I about to be charged" card.
 *
 * `accruingUsd` is the active-member overage that has built up in the CURRENT
 * month. It is deliberately shown apart from the Stripe preview: the overage
 * line is only attached when the renewal invoice is created, and only for
 * COMPLETE prior months, so it is genuinely not part of `invoice.amountDue`
 * yet. Folding it into the total would show a number the user is never charged.
 *
 * It is rendered in the invoice's currency because that is how it is charged:
 * the overage item is created at 100 minor units in the invoice's own currency,
 * so one "USD" unit bills as one EUR on a euro invoice.
 */
export default function BillingSummary({
  invoice,
  accruingUsd,
  hasActivePacks,
}: {
  invoice: UpcomingInvoice | null
  accruingUsd: number
  hasActivePacks: boolean
}) {
  const { t, i18n } = useTranslation()
  if (!invoice) return null

  const dueDate = formatDate(invoice.nextPaymentAttempt ?? invoice.periodEnd, i18n.language)

  return (
    <div className="bg-white rounded-2xl nice-shadow overflow-hidden">
      <div className="px-6 py-5 border-b border-black/[0.05] flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Receipt size={15} className="text-black/40" />
          <h2 className="font-bold text-base tracking-tight text-black">
            {t('billing.next_invoice', { defaultValue: 'Next invoice' })}
          </h2>
        </div>
        <div className="text-end">
          <p className="text-[20px] font-black leading-none text-black">
            {formatMoney(invoice.amountDue, invoice.currency, i18n.language)}
          </p>
          {dueDate && (
            <p className="text-[11px] text-black/35 font-medium mt-1">
              {t('billing.due_on', { defaultValue: `due ${dueDate}`, date: dueDate })}
            </p>
          )}
        </div>
      </div>

      <div className="px-6 py-4 space-y-2">
        {invoice.lines.map((line, i) => (
          <div key={i} className="flex items-start justify-between gap-4 text-[13px]">
            <span className="text-black/60 min-w-0">
              {line.description ||
                t('billing.line_subscription', { defaultValue: 'Subscription' })}
              {line.kind === 'overage' && (
                <span className="ms-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 whitespace-nowrap">
                  {t('billing.active_members_short', { defaultValue: 'Active members' })}
                </span>
              )}
            </span>
            <span className="font-semibold text-black whitespace-nowrap">
              {formatMoney(line.amount, line.currency, i18n.language)}
            </span>
          </div>
        ))}

        {accruingUsd > 0 && (
          <div className="flex items-start justify-between gap-4 text-[13px] pt-2 mt-2 border-t border-dashed border-black/[0.08]">
            <span className="text-black/60 flex items-start gap-1.5 min-w-0">
              <TrendingUp size={13} className="text-amber-600 mt-0.5 shrink-0" />
              {t('billing.accruing_this_month', {
                defaultValue: 'Active members this month (billed on your next renewal)',
              })}
            </span>
            <span className="font-semibold text-amber-700 whitespace-nowrap">
              +{formatMoney(accruingUsd * 100, invoice.currency, i18n.language)}
            </span>
          </div>
        )}
      </div>

      {hasActivePacks && (
        <div className="px-6 py-3 border-t border-black/[0.04] bg-black/[0.01]">
          <p className="text-[11px] text-black/35 font-medium">
            {t('billing.packs_billed_separately', {
              defaultValue: 'Add-ons are separate subscriptions and are invoiced on their own schedule.',
            })}
          </p>
        </div>
      )}
    </div>
  )
}
