'use client'
import { buttonClass } from '@components/Dashboard/Shared/DashKit/DashKit'

// Folder color presets: key is stored on folder.color; maps to a soft icon
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

// Kept for older call sites; new code uses DashKit's <Button>.
export const PRIMARY_BTN = buttonClass('primary', 'md')
export const SECONDARY_BTN = buttonClass('secondary', 'md')
