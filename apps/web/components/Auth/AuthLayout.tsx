'use client'
import React from 'react'
import LanguageSwitcher from '@components/Utils/LanguageSwitcher'
import AuthBrandingPanel from '@components/Auth/AuthBrandingPanel'
import AuthMobileHeader from '@components/Auth/AuthMobileHeader'

interface AuthLayoutProps {
  org: any
  welcomeText?: string
  children: React.ReactNode
}

export default function AuthLayout({ org, welcomeText, children }: AuthLayoutProps) {
  return (
    <div className="flex flex-col lg:grid lg:grid-cols-[1fr_600px] h-screen">
      <div className="absolute top-4 end-4 z-dropdown">
        <LanguageSwitcher />
      </div>

      {/* Mobile Header - visible only on small screens */}
      <div className="lg:hidden">
        <AuthMobileHeader org={org} />
      </div>

      {/* Left Panel - Branding (hidden on mobile) */}
      <div className="hidden lg:block h-full">
        <AuthBrandingPanel
          org={org}
          welcomeText={welcomeText}
        />
      </div>

      {/* Right Panel - Content */}
      <div className="bg-gray-50 flex flex-col relative flex-1 lg:h-full overflow-auto">
        {children}
      </div>
    </div>
  )
}
