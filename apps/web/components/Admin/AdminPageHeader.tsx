'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'

export default function AdminPageHeader({
  titleKey,
  descriptionKey,
  className = 'mb-8',
}: {
  titleKey: string
  descriptionKey: string
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <div className={className}>
      <h1 className="text-2xl font-bold text-white">{t(titleKey)}</h1>
      <p className="text-white/40 mt-1">{t(descriptionKey)}</p>
    </div>
  )
}
