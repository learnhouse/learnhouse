'use client'
import React from 'react'

// Folder color presets — key is stored on folder.color; maps to a soft icon
// tile and a solid swatch for the picker. Keep these in sync with the picker.
export const FOLDER_COLORS: Record<string, { tile: string; dot: string }> = {
  violet: { tile: 'bg-violet-50 text-violet-500', dot: 'bg-violet-500' },
  blue: { tile: 'bg-blue-50 text-blue-500', dot: 'bg-blue-500' },
  emerald: { tile: 'bg-emerald-50 text-emerald-500', dot: 'bg-emerald-500' },
  amber: { tile: 'bg-amber-50 text-amber-500', dot: 'bg-amber-500' },
  rose: { tile: 'bg-rose-50 text-rose-500', dot: 'bg-rose-500' },
  cyan: { tile: 'bg-cyan-50 text-cyan-500', dot: 'bg-cyan-500' },
  fuchsia: { tile: 'bg-fuchsia-50 text-fuchsia-500', dot: 'bg-fuchsia-500' },
  slate: { tile: 'bg-slate-100 text-slate-500', dot: 'bg-slate-500' },
}
export const DEFAULT_FOLDER_COLOR = 'violet'
export const folderTone = (color?: string) =>
  FOLDER_COLORS[color || DEFAULT_FOLDER_COLOR]?.tile || FOLDER_COLORS[DEFAULT_FOLDER_COLOR].tile

export const PRIMARY_BTN =
  'inline-flex items-center gap-2 rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white nice-shadow hover:bg-neutral-800 transition-colors'
export const SECONDARY_BTN =
  'inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-700 nice-shadow hover:bg-gray-50 transition-colors'

export function StatPill({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: number
}) {
  return (
    <div className="flex items-center gap-2 bg-white nice-shadow rounded-xl px-3.5 py-2">
      {icon}
      <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-400">{label}</span>
      <span className="text-sm font-bold text-gray-900">{value}</span>
    </div>
  )
}

export function FilterPill({
  icon,
  label,
  active,
  activeClass,
  onClick,
}: {
  icon?: React.ReactNode
  label: string
  active: boolean
  activeClass: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full transition-colors whitespace-nowrap ${
        active ? activeClass : 'bg-white nice-shadow text-gray-600 hover:bg-gray-50'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}
