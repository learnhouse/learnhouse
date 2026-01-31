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
      <div className="min-h-screen bg-white">
        {children}
      </div>
    </OrgProvider>
  )
}
