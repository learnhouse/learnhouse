'use client'
import React from 'react'
import { ChevronDown, MessageSquare, HelpCircle, Lightbulb, Megaphone, Star, X } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@components/ui/dropdown-menu"
import { DISCUSSION_LABELS, DiscussionLabel } from '@services/communities/discussions'

interface LabelFilterProps {
  value: string | null
  onChange: (value: string | null) => void
}

// Get the icon component for a label
function getLabelIcon(iconName: string, size: number = 12) {
  switch (iconName) {
    case 'HelpCircle':
      return <HelpCircle size={size} />
    case 'Lightbulb':
      return <Lightbulb size={size} />
    case 'Megaphone':
      return <Megaphone size={size} />
    case 'Star':
      return <Star size={size} />
    default:
      return <MessageSquare size={size} />
  }
}

export function LabelFilter({ value, onChange }: LabelFilterProps) {
  const currentLabel = value ? DISCUSSION_LABELS.find(l => l.id === value) : null

  return (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-1.5 px-3 py-2 h-8 text-xs bg-gray-50 border border-gray-200 rounded-md hover:bg-gray-100 transition-colors">
            {currentLabel ? (
              <>
                <span style={{ color: currentLabel.color }}>
                  {getLabelIcon(currentLabel.icon, 12)}
                </span>
                <span className="font-medium text-gray-700">{currentLabel.name}</span>
              </>
            ) : (
              <>
                <span className="text-gray-500">Label:</span>
                <span className="font-medium text-gray-700">All</span>
              </>
            )}
            <ChevronDown size={12} className="text-gray-400" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          <DropdownMenuItem
            onClick={() => onChange(null)}
            className={`flex items-center gap-2 text-sm cursor-pointer ${!value ? 'bg-gray-100 text-gray-900' : 'text-gray-600'}`}
          >
            <MessageSquare size={14} className="text-gray-400" />
            <span>All discussions</span>
          </DropdownMenuItem>
          {DISCUSSION_LABELS.map((label) => (
            <DropdownMenuItem
              key={label.id}
              onClick={() => onChange(label.id)}
              className={`flex items-center gap-2 text-sm cursor-pointer ${value === label.id ? 'bg-gray-100 text-gray-900' : 'text-gray-600'}`}
            >
              <span style={{ color: label.color }}>
                {getLabelIcon(label.icon, 14)}
              </span>
              <span>{label.name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Clear button when filter is active */}
      {value && (
        <button
          onClick={() => onChange(null)}
          className="p-1 hover:bg-gray-100 rounded transition-colors"
          title="Clear filter"
        >
          <X size={12} className="text-gray-400" />
        </button>
      )}
    </div>
  )
}

export default LabelFilter
