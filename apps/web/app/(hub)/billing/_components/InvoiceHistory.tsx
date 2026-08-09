'use client'
import React, { useState } from 'react'
import { ChevronDown, ExternalLink, FileText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PastInvoice } from '../_lib/billingClient'
import { formatCurrency, formatDate } from '@/lib/format'

function formatMoney(minorUnits: number, currency: string, lng: string): string {
  return formatCurrency(minorUnits / 100, currency.toUpperCase(), lng)
}

const STATUS_STYLES: Record<string, string> = {
  paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  open: 'bg-amber-50 text-amber-700 border-amber-200',
  draft: 'bg-black/[0.04] text-black/50 border-black/[0.08]',
  uncollectible: 'bg-red-50 text-red-600 border-red-200',
  void: 'bg-black/[0.04] text-black/40 border-black/[0.08]',
}

export default function InvoiceHistory({ invoices }: { invoices: PastInvoice[] }) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)

  if (!invoices || invoices.length === 0) return null

  return (
    <div className="bg-white rounded-2xl nice-shadow overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full px-6 py-5 flex items-center justify-between gap-4 hover:bg-black/[0.01] transition-colors"
      >
        <div className="flex items-center gap-2">
          <FileText size={15} className="text-black/40" />
          <h2 className="font-bold text-base tracking-tight text-black">
            {t('billing.invoice_history', { defaultValue: 'Invoice history' })}
          </h2>
        </div>
        <ChevronDown
          size={16}
          className={`text-black/40 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="border-t border-black/[0.05] divide-y divide-black/[0.04]">
          {invoices.map((inv) => {
            const date = formatDate(inv.created * 1000, i18n.language, {
              dateStyle: undefined,
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })
            const badge = STATUS_STYLES[inv.status] ?? STATUS_STYLES.draft
            return (
              <div
                key={inv.id}
                className="px-6 py-3.5 flex items-center justify-between gap-4 flex-wrap"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-[13px] font-semibold text-black whitespace-nowrap">
                    {date}
                  </span>
                  {inv.number && (
                    <span className="text-[11px] text-black/30 font-medium truncate">
                      {inv.number}
                    </span>
                  )}
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${badge}`}
                  >
                    {inv.status}
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-[13px] font-semibold text-black whitespace-nowrap">
                    {formatMoney(
                      inv.status === 'paid' ? inv.amountPaid : inv.amountDue,
                      inv.currency,
                      i18n.language,
                    )}
                  </span>
                  {inv.hostedInvoiceUrl && (
                    <a
                      href={inv.hostedInvoiceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 text-[12px] font-semibold text-black/50 hover:text-black transition-colors"
                    >
                      <ExternalLink size={12} />
                      {t('billing.view', { defaultValue: 'View' })}
                    </a>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
