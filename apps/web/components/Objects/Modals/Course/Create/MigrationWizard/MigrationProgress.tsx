'use client'
import React from 'react'
import { CheckCircle2, XCircle, ArrowUpRight } from 'lucide-react'
import BarLoader from 'react-spinners/BarLoader'
import { useTranslation } from 'react-i18next'
import { MigrationCreateResult } from '@services/courses/migration'

interface MigrationProgressProps {
  status: 'creating' | 'success' | 'error'
  result?: MigrationCreateResult
  onGoToCourse?: () => void
  onRetry?: () => void
}

export default function MigrationProgress({
  status,
  result,
  onGoToCourse,
  onRetry,
}: MigrationProgressProps) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col items-center justify-center py-8 px-4">
      {status === 'creating' && (
        <>
          <div className="mb-6">
            <BarLoader color="#000" width={120} />
          </div>
          <p className="text-sm font-semibold text-gray-900">
            {t('migration.creating_course')}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {t('migration.creating_description')}
          </p>
        </>
      )}

      {status === 'success' && result && (
        <>
          <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mb-4">
            <CheckCircle2 size={28} className="text-green-600" />
          </div>
          <p className="text-sm font-semibold text-gray-900">
            {t('migration.course_created')}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {t('migration.created_summary', {
              chapters: result.chapters_created,
              activities: result.activities_created,
            })}
          </p>
          <button
            onClick={onGoToCourse}
            className="mt-6 rounded-lg bg-black transition-all duration-100 ease-linear antialiased p-2 px-5 text-xs font-bold text-white nice-shadow flex space-x-2 items-center hover:scale-105"
          >
            <span>{t('migration.go_to_course')}</span>
            <ArrowUpRight size={14} />
          </button>
        </>
      )}

      {status === 'error' && (
        <>
          <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mb-4">
            <XCircle size={28} className="text-red-600" />
          </div>
          <p className="text-sm font-semibold text-gray-900">
            {t('migration.creation_failed')}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {result?.error || t('migration.creation_error_generic')}
          </p>
          <button
            onClick={onRetry}
            className="mt-6 rounded-lg bg-black transition-all duration-100 ease-linear antialiased p-2 px-5 text-xs font-bold text-white nice-shadow flex space-x-2 items-center hover:scale-105"
          >
            <span>{t('migration.try_again')}</span>
          </button>
        </>
      )}
    </div>
  )
}
