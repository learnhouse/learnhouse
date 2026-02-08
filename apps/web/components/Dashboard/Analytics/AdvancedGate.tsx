'use client'
import React from 'react'
import { Lock } from 'lucide-react'

export function AdvancedGate({
  isAdvanced,
  children,
}: {
  isAdvanced: boolean
  children: React.ReactNode
}) {
  if (isAdvanced) return <>{children}</>

  return (
    <div className="relative">
      <div className="blur-sm pointer-events-none select-none">{children}</div>
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/60 rounded-xl">
        <Lock className="text-gray-400 mb-2" size={24} />
        <p className="text-sm font-semibold text-gray-600">Pro Plan Required</p>
        <p className="text-xs text-gray-400 mt-1">Upgrade to unlock advanced analytics</p>
      </div>
    </div>
  )
}
