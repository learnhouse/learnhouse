'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ArrowDownAZ, ArrowUpAZ, Clock, History, GripVertical } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'

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

export function FolderSortDropdown({ value, onChange }: FolderSortDropdownProps) {
  const { t } = useTranslation()

  const sortOptions = [
    { value: 'name_asc' as FolderSortMode, label: t('library.sort.name_asc', { defaultValue: 'Name (A–Z)' }), icon: ArrowDownAZ },
    { value: 'name_desc' as FolderSortMode, label: t('library.sort.name_desc', { defaultValue: 'Name (Z–A)' }), icon: ArrowUpAZ },
    { value: 'newest' as FolderSortMode, label: t('library.sort.newest', { defaultValue: 'Newest first' }), icon: Clock },
    { value: 'oldest' as FolderSortMode, label: t('library.sort.oldest', { defaultValue: 'Oldest first' }), icon: History },
    { value: 'manual' as FolderSortMode, label: t('library.sort.manual', { defaultValue: 'Manual' }), icon: GripVertical },
  ]

  const currentOption = sortOptions.find((opt) => opt.value === value) || sortOptions[0]
  const CurrentIcon = currentOption.icon

  return (
    // modal={false} avoids Radix's body scroll-lock, which otherwise removes the
    // page scrollbar on open and shifts the whole layout sideways.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-1.5 px-3 py-2 h-8 text-xs bg-gray-50 border border-gray-200 rounded-md hover:bg-gray-100 transition-colors">
          <CurrentIcon size={14} className="text-gray-400" />
          <span className="text-gray-500">{t('library.sort.sort_by', { defaultValue: 'Sort by' })}</span>
          <span className="font-medium text-gray-700">{currentOption.label}</span>
          <ChevronDown size={12} className="text-gray-400" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {sortOptions.map((option) => {
          const Icon = option.icon
          return (
            <DropdownMenuItem
              key={option.value}
              onClick={() => onChange(option.value)}
              className={`flex items-center gap-2 text-sm ${value === option.value ? 'bg-gray-100 text-gray-900' : 'text-gray-600'}`}
            >
              <Icon size={14} />
              <span>{option.label}</span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default FolderSortDropdown
