'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'

/** "You don't have access" for a signed-in member who can't open a community, discussion or podcast. */
export default function NoAccessNotice({ kind }: { kind: 'community' | 'discussion' | 'podcast' }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-center min-h-[50vh] px-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-600">{t('common.no_access.title')}</h1>
        <p className="text-gray-400 mt-2">{t(`common.no_access.${kind}`)}</p>
      </div>
    </div>
  )
}
