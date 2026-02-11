'use client'
import React from 'react'
import Image from 'next/image'
import Link from 'next/link'
import learnhouseIcon from 'public/learnhouse_bigicon_1.png'
import { getOrgLogoMediaDirectory, getOrgAuthBackgroundMediaDirectory } from '@services/media/media'
import { getUriWithOrg } from '@services/config/config'

interface AuthMobileHeaderProps {
  org: any
}

export default function AuthMobileHeader({ org }: AuthMobileHeaderProps) {
  const authBranding = org?.config?.config?.general?.auth_branding || {}
  const {
    background_type = 'gradient',
    background_image = '',
  } = authBranding

  const getBackgroundStyle = (): React.CSSProperties => {
    if (background_type === 'gradient' || !background_image) {
      return {
        background: 'linear-gradient(041.61deg, #202020 7.15%, #000000 90.96%)',
      }
    }
    if (background_type === 'custom' && background_image) {
      return {
        backgroundImage: `url(${getOrgAuthBackgroundMediaDirectory(org?.org_uuid, background_image)})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    }
    if (background_type === 'unsplash' && background_image) {
      return {
        backgroundImage: `url(${background_image})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    }
    return {
      background: 'linear-gradient(041.61deg, #202020 7.15%, #000000 90.96%)',
    }
  }

  const hasCustomBackground = background_type !== 'gradient' && background_image

  return (
    <div
      className="relative flex items-center gap-4 px-5 py-4"
      style={getBackgroundStyle()}
    >
      {hasCustomBackground && (
        <div className="absolute inset-0 bg-black/30" />
      )}

      <Link prefetch href={getUriWithOrg(org?.slug, '/')} className="relative z-10">
        <div className="w-10 h-10 rounded-lg ring-1 ring-inset ring-white/10 bg-white flex items-center justify-center overflow-hidden shrink-0">
          {org?.logo_image ? (
            <img
              src={getOrgLogoMediaDirectory(org.org_uuid, org.logo_image)}
              alt={org.name}
              className="w-full h-full object-contain p-1.5"
            />
          ) : (
            <Image
              quality={100}
              width={40}
              height={40}
              src={learnhouseIcon}
              alt="LearnHouse"
              className="object-contain"
            />
          )}
        </div>
      </Link>

      <span className="relative z-10 font-semibold text-white text-lg truncate">
        {org?.name}
      </span>
    </div>
  )
}
