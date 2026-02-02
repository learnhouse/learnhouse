'use client'
import React from 'react'
import LanguageSwitcher from '@components/Utils/LanguageSwitcher'
import AuthBrandingPanel from '@components/Auth/AuthBrandingPanel'

interface AuthLayoutProps {
  org: any
  welcomeText?: string
  children: React.ReactNode
}

export default function AuthLayout({ org, welcomeText, children }: AuthLayoutProps) {
  return (
    <div className="grid grid-cols-[1fr_600px] h-screen">
      <div className="absolute top-4 right-4 z-dropdown">
        <LanguageSwitcher />
      </div>

      {/* Left Panel - Branding */}
      <div className="h-full">
        <AuthBrandingPanel
          org={org}
          welcomeText={welcomeText}
        />
      </div>

      {/* Right Panel - Content */}
      <div className="bg-gray-50 flex flex-col relative h-full overflow-auto">
        {children}
      </div>
    </div>
  )
}
