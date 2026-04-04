'use client'

import { use } from 'react'
import { OrgProvider } from '@components/Contexts/OrgContext'
import '@styles/globals.css'

export default function EmbedLayout(
  props: {
    children: React.ReactNode
    params: Promise<{ orgslug: string }>
  }
) {
  const params = use(props.params)
  const { children } = props

  return (
    <OrgProvider orgslug={params.orgslug}>
      {/* Suppress the root layout fade-in animation for embeds */}
      <style>{`.animate-fade-in{animation:none!important;opacity:1!important}`}</style>
      <div className="min-h-screen">
        {children}
      </div>
    </OrgProvider>
  )
}
