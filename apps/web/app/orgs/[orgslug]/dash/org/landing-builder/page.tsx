'use client'
import React, { Suspense } from 'react'
import dynamic from 'next/dynamic'

// The page builder is its own chunk: nothing of it reaches the public pages
// or the rest of the dashboard.
const LandingBuilder = dynamic(() => import('@components/LandingPages/builder/LandingBuilder'), { ssr: false })

export default function LandingBuilderPage() {
  return (
    <Suspense fallback={null}>
      <LandingBuilder />
    </Suspense>
  )
}
