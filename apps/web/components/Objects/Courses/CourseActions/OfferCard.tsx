'use client'
import React, { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, RefreshCcw, SquareCheck, Sparkles, ChevronDown, ChevronUp } from 'lucide-react'
import { getUriWithOrg } from '@services/config/config'

interface OfferCardProps {
  offer: {
    offer_id: number
    offer_uuid: string
    offer_name: string
    description?: string
    offer_type: 'subscription' | 'one_time'
    price_type?: string
    amount: number
    currency: string
    benefits?: string
  }
  orgslug: string
}

export function OfferCard({ offer, orgslug }: OfferCardProps) {
  const [expanded, setExpanded] = useState(false)
  const isSubscription = offer.offer_type === 'subscription'
  const benefits: string[] = offer.benefits
    ? offer.benefits.split(',').map((b) => b.trim()).filter(Boolean)
    : []

  const formattedPrice = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: offer.currency ?? 'USD',
  }).format(offer.amount)

  return (
    <div className="bg-white rounded-xl nice-shadow overflow-hidden">
      {/* Type stripe */}
      <div className={`px-4 py-2 flex items-center gap-2 ${isSubscription ? 'bg-indigo-50' : 'bg-gray-50'}`}>
        {isSubscription
          ? <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-700"><RefreshCcw size={11} /> Subscription</span>
          : <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600"><SquareCheck size={11} /> One-time payment</span>
        }
      </div>

      <div className="p-4">
        {/* Name + price */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="font-bold text-gray-900 text-base leading-snug">{offer.offer_name}</p>
            {offer.description && (
              <p className="text-sm text-gray-500 mt-1 leading-relaxed line-clamp-2">{offer.description}</p>
            )}
          </div>
          <div className="shrink-0 text-right">
            <div className={`text-xl font-black ${isSubscription ? 'text-indigo-700' : 'text-gray-900'}`}>
              {formattedPrice}
            </div>
            {offer.price_type === 'customer_choice' && (
              <p className="text-xs text-gray-400 leading-none">min.</p>
            )}
            {isSubscription && (
              <p className="text-xs text-indigo-400 leading-none font-medium">recurring</p>
            )}
          </div>
        </div>

        {/* Benefits */}
        {benefits.length > 0 && (
          <div className="mt-3">
            <div className={`space-y-1.5 overflow-hidden transition-all ${expanded ? '' : 'max-h-[3.5rem]'}`}>
              {benefits.map((b, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-gray-500">
                  <Sparkles size={10} className="text-indigo-300 mt-0.5 shrink-0" />
                  <span>{b}</span>
                </div>
              ))}
            </div>
            {benefits.length > 2 && (
              <button
                onClick={() => setExpanded(v => !v)}
                className="mt-1 flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                {expanded
                  ? <><ChevronUp size={12} /> Show less</>
                  : <><ChevronDown size={12} /> {benefits.length - 2} more benefits</>
                }
              </button>
            )}
          </div>
        )}

        {/* CTA */}
        <Link href={getUriWithOrg(orgslug, `/store/offers/${offer.offer_uuid}`)}>
          <div className={`mt-4 w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-bold text-sm transition-colors cursor-pointer ${
            isSubscription
              ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
              : 'bg-gray-900 hover:bg-gray-800 text-white'
          }`}>
            {isSubscription ? 'Subscribe now' : 'Get access'}
            <ArrowRight size={13} />
          </div>
        </Link>
      </div>
    </div>
  )
}
