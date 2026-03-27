'use client'
import React from 'react'
import { Input } from '@components/ui/input'
import { useTranslation } from 'react-i18next'

interface MigrationPromptFormProps {
  courseName: string
  onCourseNameChange: (name: string) => void
  description: string
  onDescriptionChange: (desc: string) => void
  disabled: boolean
}

export default function MigrationPromptForm({
  courseName,
  onCourseNameChange,
  description,
  onDescriptionChange,
  disabled,
}: MigrationPromptFormProps) {
  const { t } = useTranslation()

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('migration.course_name')} *
        </label>
        <Input
          value={courseName}
          onChange={(e) => onCourseNameChange(e.target.value)}
          placeholder={t('migration.course_name_placeholder')}
          disabled={disabled}
          maxLength={100}
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('migration.description')}
        </label>
        <Input
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder={t('migration.description_placeholder')}
          disabled={disabled}
          maxLength={200}
        />
      </div>
    </div>
  )
}
