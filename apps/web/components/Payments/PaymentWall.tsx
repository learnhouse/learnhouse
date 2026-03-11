'use client';
import React from 'react';
import { Lock, ShoppingCart } from 'lucide-react';
import { Button } from '@components/ui/button';
import Link from 'next/link';
import { useOrg } from '@components/Contexts/OrgContext';
import { getUriWithOrg } from '@services/config/config';

interface OfferMeta {
  offer_id: number;
  offer_name: string;
  amount: number;
  currency: string;
}

interface PaymentWallProps {
  offer: OfferMeta;
  resourceName?: string;
  resourceThumbnail?: string;
  orgslug?: string;
}

/**
 * Universal payment wall — displayed when any resource returns HTTP 402.
 * Works for courses, podcasts, playgrounds, or any future resource
 * type without any per-type code changes.
 *
 * Usage:
 *   if (error?.status === 402) {
 *     return <PaymentWall offer={error.data} resourceName="My Course" />
 *   }
 */
function PaymentWall({ offer, resourceName, resourceThumbnail, orgslug }: PaymentWallProps) {
  const org = useOrg() as any;
  const slug = orgslug ?? org?.slug;

  const formattedPrice = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: offer.currency,
  }).format(offer.amount);

  const storeHref = slug
    ? getUriWithOrg(slug, `/store/offers/${offer.offer_id}`)
    : '#';

  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] p-8 text-center space-y-6">
      {resourceThumbnail && (
        <div className="relative w-full max-w-sm">
          <img
            src={resourceThumbnail}
            alt={resourceName ?? 'Resource'}
            className="w-full rounded-xl object-cover opacity-40 blur-sm"
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <Lock className="w-12 h-12 text-gray-700" />
          </div>
        </div>
      )}

      {!resourceThumbnail && (
        <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center">
          <Lock className="w-8 h-8 text-gray-500" />
        </div>
      )}

      <div className="space-y-2 max-w-md">
        {resourceName && (
          <h2 className="text-xl font-bold text-gray-900">{resourceName}</h2>
        )}
        <p className="text-gray-500 text-sm">
          This content is part of <strong>{offer.offer_name}</strong> and requires a purchase to access.
        </p>
      </div>

      <div className="bg-white border rounded-xl p-6 space-y-4 max-w-xs w-full nice-shadow">
        <div className="text-center">
          <p className="text-3xl font-bold text-gray-900">{formattedPrice}</p>
          <p className="text-sm text-gray-500">{offer.offer_name}</p>
        </div>

        <Link href={storeHref}>
          <Button className="w-full flex items-center space-x-2">
            <ShoppingCart size={16} />
            <span>Get Access</span>
          </Button>
        </Link>
      </div>
    </div>
  );
}

export default PaymentWall;
