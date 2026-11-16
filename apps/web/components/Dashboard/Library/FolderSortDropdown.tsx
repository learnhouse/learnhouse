'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowsDownUp } from '@phosphor-icons/react'
import { ToolbarSelect } from '@components/Dashboard/Shared/DashKit/DashKit'

export type FolderSortMode =
  | 'name_asc'
  | 'name_desc'
  | 'newest'
  | 'oldest'
  | 'manual'

interface FolderSortDropdownProps {
  value: FolderSortMode
  onChange: (_value: FolderSortMode) => void
}

// The org-wide library order. Saved server-side by the caller, so it applies
// to the public library too.
export function FolderSortDropdown({ value, onChange }: FolderSortDropdownProps) {
  const { t } = useTranslation()
  const options: { value: FolderSortMode; label: string }[] = [
    { value: 'name_asc', label: t('library.sort.name_asc') },
    { value: 'name_desc', label: t('library.sort.name_desc') },
    { value: 'newest', label: t('library.sort.newest') },
    { value: 'oldest', label: t('library.sort.oldest') },
    { value: 'manual', label: t('library.sort.manual') },
  ]
  return (
    <ToolbarSelect
      value={value}
      onChange={(v) => onChange(v as FolderSortMode)}
      ariaLabel={t('library.sort.sort_by')}
      icon={<ArrowsDownUp size={14} />}
      options={options}
    />
  )
}

export default FolderSortDropdown
