'use client'
import React from 'react'
import Link from 'next/link'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import { getUriWithOrg } from '@services/config/config'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { ShoppingBag, RefreshCcw, SquareCheck, ArrowRight, Sparkles, BookOpen, Mic, Puzzle } from 'lucide-react'
import { useOrg } from '@components/Contexts/OrgContext'

interface Resource {
  resource_uuid: string
  resource_type: string
  name: string
  description: string
  thumbnail_image: string
  org_uuid: string
}

interface Offer {
  id: number
  offer_uuid: string
  name: string
  description: string
  offer_type: 'one_time' | 'subscription'
  price_type: 'fixed_price' | 'customer_choice'
  amount: number
  currency: string
  benefits: string
  payments_group_id: number | null
  included_resources: Resource[]
}

interface StoreProps {
  orgslug: string
  offers: Offer[]
}

function stripTypePrefix(uuid: string): string {
  return uuid.replace(/^[a-z]+_/, '')
}

function getResourceUrl(orgslug: string, resource: Resource): string | null {
  const id = stripTypePrefix(resource.resource_uuid)
  switch (resource.resource_type) {
    case 'course': return getUriWithOrg(orgslug, `/course/${id}`)
    case 'podcast': return getUriWithOrg(orgslug, `/podcast/${id}`)
    case 'playground': return getUriWithOrg(orgslug, `/playground/${id}`)
    default: return null
  }
}

function resourceIcon(type: string) {
  switch (type) {
    case 'course': return <BookOpen size={12} className="text-indigo-400" />
    case 'podcast': return <Mic size={12} className="text-pink-400" />
    default: return <Puzzle size={12} className="text-gray-300" />
  }
}

function CourseBoxes({ resources, orgUuid }: { resources: Resource[]; orgUuid: string }) {
  const items = resources.slice(0, 3)
  if (items.length === 0) return null
  return (
    <div className="flex -space-x-8 items-center justify-center w-full">
      {items.map((r, index) => {
        const src = r.thumbnail_image && r.resource_type === 'course'
          ? getCourseThumbnailMediaDirectory(r.org_uuid || orgUuid, r.resource_uuid, r.thumbnail_image)
          : null
        return (
          <div
            key={r.resource_uuid}
            className="relative h-20 w-32 overflow-hidden rounded-lg border-2 border-white shadow-lg shrink-0 bg-gray-200"
            style={{
              backgroundImage: src ? `url(${src})` : undefined,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              zIndex: 3 - index,
            }}
          >
            {!src && (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200">
                {resourceIcon(r.resource_type)}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function OfferCard({ offer, orgslug, orgUuid }: { offer: Offer; orgslug: string; orgUuid: string }) {
  const isSubscription = offer.offer_type === 'subscription'
  const benefits = offer.benefits ? offer.benefits.split(',').map(b => b.trim()).filter(Boolean) : []
  const resources = offer.included_resources ?? []

  return (
    <Link href={getUriWithOrg(orgslug, `/store/offers/${offer.offer_uuid}`)}>
      <div className="group bg-white rounded-xl nice-shadow overflow-hidden flex flex-col h-full cursor-pointer transition-all duration-200 hover:scale-[1.01]">

        {/* Thumbnail area */}
        <div className={`relative aspect-video overflow-hidden flex items-center justify-center ${
          isSubscription ? 'bg-gradient-to-br from-indigo-50 to-purple-50' : 'bg-gray-50'
        }`}>
          {resources.length > 0 ? (
            <div className="p-4 w-full">
              <CourseBoxes resources={resources} orgUuid={orgUuid} />
            </div>
          ) : (
            <ShoppingBag size={28} className="text-gray-200" strokeWidth={1.5} />
          )}

          {/* Type badge */}
          <div className="absolute top-2.5 left-2.5">
            {isSubscription ? (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-white bg-indigo-600/90 backdrop-blur-sm rounded-full px-2.5 py-0.5">
                <RefreshCcw size={10} /> Subscription
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-gray-700 bg-white/90 backdrop-blur-sm rounded-full px-2.5 py-0.5">
                <SquareCheck size={10} /> One-time
              </span>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="p-4 flex flex-col flex-1 gap-2">
          <h2 className="font-bold text-base text-gray-900 leading-snug group-hover:text-indigo-700 transition-colors">
            {offer.name}
          </h2>
          <p className="text-sm text-gray-500 line-clamp-2 leading-relaxed">{offer.description}</p>

          {/* Included resources list */}
          {resources.length > 0 && (
            <div className="space-y-1 mt-0.5">
              {resources.slice(0, 2).map(r => {
                const url = getResourceUrl(orgslug, r)
                const inner = (
                  <>
                    {resourceIcon(r.resource_type)}
                    <span className="truncate">{r.name}</span>
                  </>
                )
                return url ? (
                  <a
                    key={r.resource_uuid}
                    href={url}
                    onClick={e => e.stopPropagation()}
                    className="flex items-center gap-2 text-xs text-gray-500 hover:text-indigo-600 transition-colors"
                  >
                    {inner}
                  </a>
                ) : (
                  <div key={r.resource_uuid} className="flex items-center gap-2 text-xs text-gray-500">
                    {inner}
                  </div>
                )
              })}
              {resources.length > 2 && (
                <p className="text-xs text-gray-400">+{resources.length - 2} more included</p>
              )}
            </div>
          )}

          {benefits.length > 0 && (
            <div className="space-y-1">
              {benefits.slice(0, 2).map((b, i) => (
                <div key={i} className="flex items-start gap-1.5 text-xs text-gray-400">
                  <Sparkles size={10} className="text-indigo-300 mt-0.5 shrink-0" />
                  <span className="truncate">{b}</span>
                </div>
              ))}
            </div>
          )}

          {/* Price + CTA */}
          <div className="mt-auto pt-3 border-t border-gray-100 flex items-center justify-between">
            <div>
              <div className={`text-xl font-black ${isSubscription ? 'text-indigo-700' : 'text-gray-900'}`}>
                {new Intl.NumberFormat('en-US', { style: 'currency', currency: offer.currency }).format(offer.amount)}
              </div>
              {offer.price_type === 'customer_choice' && (
                <p className="text-xs text-gray-400 leading-none">min.</p>
              )}
              {isSubscription && (
                <p className="text-xs text-indigo-400 leading-none font-medium">recurring</p>
              )}
            </div>
            <div className={`flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-xl transition-colors ${
              isSubscription
                ? 'bg-indigo-600 text-white group-hover:bg-indigo-700'
                : 'bg-gray-900 text-white group-hover:bg-gray-800'
            }`}>
              {isSubscription ? 'Subscribe' : 'Get access'}
              <ArrowRight size={13} />
            </div>
          </div>
        </div>
      </div>
    </Link>
  )
}

function Store({ orgslug, offers }: StoreProps) {
  const org = useOrg() as any

  return (
    <div className="w-full">
      <GeneralWrapperStyled>
        <div className="flex items-center gap-3 my-6">
          <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-white nice-shadow">
            <ShoppingBag size={18} className="text-gray-800" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-gray-900 tracking-tight">Store</h1>
            {org?.name && (
              <p className="text-sm text-gray-400 mt-0.5">Unlock premium content from {org.name}</p>
            )}
          </div>
        </div>

        {offers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-white flex items-center justify-center mb-4 nice-shadow">
              <ShoppingBag size={28} className="text-gray-300" strokeWidth={1.5} />
            </div>
            <h2 className="text-xl font-bold text-gray-600 mb-2">No offers available yet</h2>
            <p className="text-gray-400 text-sm max-w-sm">
              Check back soon — offers and subscriptions will appear here when they become available.
            </p>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-400 mb-5">
              {offers.length} {offers.length === 1 ? 'offer' : 'offers'} available
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {offers.map((offer) => (
                <OfferCard key={offer.id} offer={offer} orgslug={orgslug} orgUuid={org?.org_uuid ?? ''} />
              ))}
            </div>
          </>
        )}
      </GeneralWrapperStyled>
    </div>
  )
}

export default Store
