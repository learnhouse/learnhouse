'use client'

import { use } from 'react'
import type React from 'react'
import { OrgProvider } from '@components/Contexts/OrgContext'
import OrgLanguageSync from '@components/Contexts/OrgLanguageSync'
import { useSearchParams } from 'next/navigation'
import { parseEmbedOptions } from '@/lib/embed/protocol'
import { SUPPORTED_LANGUAGES } from '@/lib/i18n'
import '@styles/globals.css'

export default function EmbedLayout(
  props: {
    children: React.ReactNode
    params: Promise<{ orgslug: string }>
  }
) {
  const params = use(props.params)
  const { children } = props
  const { locale } = parseEmbedOptions(useSearchParams(), SUPPORTED_LANGUAGES)

  return (
    <OrgProvider orgslug={params.orgslug}>
      <OrgLanguageSync locale={locale} />
      {/* Suppress the root layout fade-in animation for embeds */}
      {/* Force light color scheme: prevents browsers in OS dark mode from auto-inverting text colors */}
      <style>{`.animate-fade-in{animation:none!important;opacity:1!important}:root{color-scheme:light}html,body{color:#09090b}`}</style>
      <div className="min-h-screen">
        {children}
      </div>
    </OrgProvider>
  )
}
