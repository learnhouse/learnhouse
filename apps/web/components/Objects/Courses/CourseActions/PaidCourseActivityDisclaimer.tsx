'use client'
import React from 'react'
import useSWR from 'swr'
import { ShoppingBag, Loader2 } from 'lucide-react'
import { useOrg } from '@components/Contexts/OrgContext'
import { getOffersByResource } from '@services/payments/offers'
import { OfferCard } from './OfferCard'
import { useTranslation } from 'react-i18next'

interface PaidCourseActivityProps {
  course: any
}

function PaidCourseActivityDisclaimer({ course }: PaidCourseActivityProps) {
  const { t } = useTranslation()
  const org = useOrg() as any

  const { data: offersResult, isLoading } = useSWR(
    org?.id && course?.course_uuid ? ['offers-by-resource', org.id, course.course_uuid] : null,
    () => getOffersByResource(org.id, course.course_uuid)
  )

  const offers: any[] = offersResult?.data ?? []

  return (
    <div className="space-y-4 max-w-lg mx-auto">
      {/* Notice banner */}
      <div className="flex items-start gap-3 p-4 bg-amber-50 rounded-xl">
        <ShoppingBag className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <h3 className="text-amber-800 font-semibold text-sm">{t('payments.paid_content')}</h3>
          <p className="text-amber-700 text-sm mt-0.5">{t('payments.paid_content_description')}</p>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 size={18} className="animate-spin text-gray-300" />
        </div>
      )}

      {!isLoading && offers.length > 0 && (
        <>
          {offers.length > 1 && (
            <p className="text-xs text-gray-400 font-medium px-1">
              {offers.length} options available
            </p>
          )}
          <div className="space-y-3">
            {offers.map((offer: any) => (
              <OfferCard key={offer.offer_id} offer={offer} orgslug={org.slug} />
            ))}
          </div>
        </>
      )}

    </div>
  )
}

export default PaidCourseActivityDisclaimer
