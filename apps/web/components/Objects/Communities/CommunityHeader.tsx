'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Users } from 'lucide-react'
import { Community } from '@services/communities/communities'

interface CommunityHeaderProps {
  community: Community
}

export function CommunityHeader({ community }: CommunityHeaderProps) {
  const { t } = useTranslation()
  return (
    <div className="relative inset-0 ring-1 ring-inset ring-black/10 rounded-lg shadow-xl w-full h-[150px] md:h-[250px] overflow-hidden">
      {/* Gradient Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-blue-500 via-purple-500 to-indigo-600">
        {/* Pattern overlay */}
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: 'radial-gradient(circle at center, #fff 1px, transparent 1px)',
            backgroundSize: '24px 24px'
          }}
        />
      </div>

      {/* Content */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 md:w-20 md:h-20 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center mx-auto mb-3 border border-white/30">
            <Users size={32} className="text-white md:w-10 md:h-10" />
          </div>
          <div className="px-4">
            <h2 className="text-white/80 text-sm font-medium">{t('communities.sidebar.community')}</h2>
          </div>
        </div>
      </div>
    </div>
  )
}

export default CommunityHeader
