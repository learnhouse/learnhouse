'use client'
import React from 'react'
import Image from 'next/image'
import Link from 'next/link'
import learnhouseIcon from 'public/learnhouse_bigicon_1.png'
import { getOrgLogoMediaDirectory, getOrgAuthBackgroundMediaDirectory } from '@services/media/media'
import { getUriWithOrg } from '@services/config/config'
import { cn } from '@/lib/utils'
import { isOSSMode } from '@services/config/config'
import { usePlan } from '@components/Hooks/usePlan'

interface AuthBrandingPanelProps {
  org: any
  welcomeText?: string
}

export default function AuthBrandingPanel({ org, welcomeText }: AuthBrandingPanelProps) {
  const authBranding = org?.config?.config?.general?.auth_branding || {}
  const {
    welcome_message = '',
    background_type = 'gradient',
    background_image = '',
    text_color = 'light'
  } = authBranding

  // Check if org has enterprise plan - hide LearnHouse branding for enterprise users
  // In OSS mode, always show branding regardless of plan
  const plan = usePlan()
  const isEnterprise = plan === 'enterprise'

  const getBackgroundStyle = (): React.CSSProperties => {
    if (background_type === 'gradient' || !background_image) {
      // Keep the original black gradient
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

  const displayMessage = welcome_message || welcomeText || ''
  const hasCustomBackground = background_type !== 'gradient' && background_image

  return (
    <div
      className="relative flex flex-col h-full w-full"
      style={getBackgroundStyle()}
    >
      {/* Overlay for custom backgrounds only */}
      {hasCustomBackground && (
        <div className="absolute inset-0 bg-black/30" />
      )}

      {/* Content */}
      <div className="relative z-10 flex flex-col h-full p-10">
        {/* Top bar with LearnHouse lrn.svg logo - hidden for enterprise users */}
        {!isEnterprise && (
          <div className="login-topbar">
            <Link prefetch href="https://learnhouse.app" target="_blank">
              <img
                src="/lrn.svg"
                alt="LearnHouse"
                width={30}
                height={30}
                className={cn(
                  "transition-opacity hover:opacity-100",
                  text_color === 'light' ? "opacity-60 invert" : "opacity-40"
                )}
              />
            </Link>
          </div>
        )}

        {/* Content - vertically and horizontally centered */}
        <div className="flex-1 flex items-center justify-center">
          <div className={cn(
            "flex flex-col items-center text-center gap-6",
            text_color === 'light' ? "text-white" : "text-gray-900"
          )}>
            {/* Organization logo */}
            <Link prefetch href={getUriWithOrg(org?.slug, '/')}>
              <div className="w-24 h-24 rounded-2xl ring-1 ring-inset ring-white/10 bg-white flex items-center justify-center overflow-hidden">
                {org?.logo_image ? (
                  <img
                    src={getOrgLogoMediaDirectory(org.org_uuid, org.logo_image)}
                    alt={org.name}
                    className="w-full h-full object-contain p-3"
                  />
                ) : (
                  <Image
                    quality={100}
                    width={96}
                    height={96}
                    src={learnhouseIcon}
                    alt="LearnHouse"
                    className="object-contain"
                  />
                )}
              </div>
            </Link>

            {/* Text content */}
            <div className="space-y-1">
              <h1 className="font-bold text-3xl tracking-tight">{org?.name}</h1>
              {displayMessage && (
                <p className={cn(
                  "text-lg max-w-sm leading-relaxed",
                  text_color === 'light' ? "text-white/70" : "text-gray-600"
                )}>
                  {displayMessage}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Bottom spacer for visual balance */}
        <div className="h-10" />
      </div>
    </div>
  )
}
