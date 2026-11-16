'use client'
import React from 'react'
import LanguageSwitcher from '@components/Utils/LanguageSwitcher'
import { ThemeIconButton } from '@components/Objects/Theme/ThemeSwitch'
import AuthBrandingPanel from '@components/Auth/AuthBrandingPanel'
import AuthMobileHeader from '@components/Auth/AuthMobileHeader'
import { AuthDots } from '@components/Auth/AuthUI'
import { AuthFooter } from '@components/Footers/LegalFooters'

interface AuthLayoutProps {
  org: any
  welcomeText?: string
  // No-org (apex) branding copy: platform-style title + subtitle.
  title?: string
  subtitle?: string
  children: React.ReactNode
}

/**
 * Shell for the auth forms. Desktop: the form column at the start, the org's
 * branding panel inset at the end. Below lg: a brand row (or the org's photo
 * as a slim banner) above the form. Pages pass only their content; it lands
 * in a 380px column centred in the remaining height.
 */
export default function AuthLayout({ org, welcomeText, title, subtitle, children }: AuthLayoutProps) {
  return (
    <div className="lh-auth min-h-dvh bg-white flex">
      <div className="relative isolate flex min-w-0 flex-1 flex-col pb-[var(--lh-safe-bottom)]">
        <AuthDots className="h-72 -z-10" />

        <header className="px-4 pt-[calc(1rem+var(--lh-safe-top))] sm:px-8 lg:pt-5">
          <div className="lg:hidden">
            <AuthMobileHeader org={org} />
          </div>
          <div className="hidden lg:flex justify-end items-center gap-1">
            <ThemeIconButton className="h-9 w-9 text-gray-600 hover:bg-gray-100" />
            <LanguageSwitcher />
          </div>
        </header>

        <main className="flex flex-1 flex-col justify-start px-4 pb-6 pt-8 sm:justify-center sm:px-8 sm:py-10">
          <div className="mx-auto w-full max-w-[380px]">{children}</div>
        </main>

        <AuthFooter className="shrink-0" />
      </div>

      <aside className="hidden lg:block w-[46%] max-w-[820px] shrink-0 p-3 h-dvh sticky top-0">
        <AuthBrandingPanel org={org} welcomeText={welcomeText} title={title} subtitle={subtitle} />
      </aside>
    </div>
  )
}
