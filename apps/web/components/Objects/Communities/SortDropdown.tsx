'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Clock, Flame, TrendingUp } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@components/ui/dropdown-menu"
import { DiscussionSortBy } from '@services/communities/discussions'

interface SortDropdownProps {
  value: DiscussionSortBy
  onChange: (value: DiscussionSortBy) => void
}

export function SortDropdown({ value, onChange }: SortDropdownProps) {
  const { t } = useTranslation()

  const sortOptions = [
    { value: 'recent' as DiscussionSortBy, label: t('communities.discussion_list.latest_activity'), icon: Clock },
    { value: 'upvotes' as DiscussionSortBy, label: t('communities.discussion_list.top'), icon: TrendingUp },
    { value: 'hot' as DiscussionSortBy, label: t('communities.discussion_list.hot'), icon: Flame },
  ]

  const currentOption = sortOptions.find(opt => opt.value === value) || sortOptions[0]
  const CurrentIcon = currentOption.icon

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-1.5 px-3 py-2 h-8 text-xs bg-gray-50 border border-gray-200 rounded-md hover:bg-gray-100 transition-colors">
          <span className="text-gray-500">{t('communities.discussion_list.sort_by')}</span>
          <span className="font-medium text-gray-700">{currentOption.label}</span>
          <ChevronDown size={12} className="text-gray-400" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-40">
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

export default SortDropdown
