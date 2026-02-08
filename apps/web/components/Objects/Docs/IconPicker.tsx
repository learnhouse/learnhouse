'use client'

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import PhosphorIconRenderer from './PhosphorIconRenderer'
import { Search, X } from 'lucide-react'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@components/ui/popover'

const ICON_LIST = [
  'File', 'FileText', 'FileDashed', 'FileCode', 'FileCss', 'FileHtml', 'FileJs', 'FileTs',
  'Article', 'ArticleNyTimes', 'Notebook', 'NotePencil', 'Note', 'Notepad',
  'Book', 'BookOpen', 'BookBookmark', 'Books', 'BookmarkSimple',
  'Lightning', 'LightningSlash', 'Lightbulb', 'LightbulbFilament',
  'Rocket', 'RocketLaunch',
  'Star', 'StarFour', 'Sparkle', 'MagicWand', 'Fire', 'Flame',
  'House', 'HouseSimple', 'HouseLine',
  'Gear', 'GearSix', 'GearFine', 'Wrench', 'Hammer', 'SlidersHorizontal', 'Faders',
  'Lock', 'LockSimple', 'LockKey', 'Key', 'Shield', 'ShieldCheck', 'ShieldStar',
  'User', 'Users', 'UserCircle', 'UserGear', 'UserPlus',
  'Globe', 'GlobeSimple', 'GlobeHemisphereWest',
  'Cloud', 'CloudArrowUp', 'CloudArrowDown', 'CloudCheck',
  'Database', 'HardDrive', 'HardDrives',
  'Terminal', 'TerminalWindow', 'Code', 'CodeSimple', 'CodeBlock', 'BracketsCurly',
  'Bug', 'BugBeetle', 'BugDroid',
  'Cpu', 'CircuitBoard', 'Plugs', 'Plug',
  'ChartBar', 'ChartLine', 'ChartPie', 'TrendUp', 'TrendDown', 'PresentationChart',
  'Eye', 'EyeSlash', 'Binoculars', 'MagnifyingGlass',
  'ChatCircle', 'ChatText', 'ChatDots', 'Chats',
  'Envelope', 'EnvelopeOpen', 'EnvelopeSimple', 'PaperPlane', 'PaperPlaneTilt',
  'Bell', 'BellRinging', 'BellSimple',
  'CheckCircle', 'Check', 'CheckSquare', 'XCircle', 'Warning', 'WarningCircle', 'Info',
  'ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'ArrowsClockwise',
  'Link', 'LinkSimple', 'LinkBreak',
  'MapPin', 'MapPinLine', 'NavigationArrow', 'Compass',
  'Calendar', 'CalendarBlank', 'Clock', 'Timer', 'Hourglass',
  'Camera', 'Image', 'ImageSquare', 'Images',
  'Play', 'PlayCircle', 'Pause', 'Stop', 'VideoCamera',
  'Microphone', 'Speaker', 'Headphones',
  'Folder', 'FolderOpen', 'FolderSimple', 'FolderStar',
  'Tag', 'TagSimple', 'Hash',
  'Palette', 'PaintBrush', 'PaintBucket', 'Eyedropper',
  'Puzzle', 'PuzzlePiece',
  'Trophy', 'Medal', 'Crown',
  'Heart', 'ThumbsUp', 'ThumbsDown', 'Smiley',
  'Tree', 'Leaf', 'Plant', 'Flower',
  'Sun', 'Moon', 'CloudSun',
  'Atom', 'Flask', 'TestTube', 'Dna',
  'Cube', 'Stack', 'StackSimple',
  'Table', 'GridFour', 'SquaresFour', 'Rows',
  'ListBullets', 'ListNumbers', 'ListChecks',
  'Question', 'QuestionMark',
  'Coin', 'CurrencyDollar', 'CreditCard', 'Wallet', 'Receipt',
  'Truck', 'Airplane', 'Car', 'Bicycle',
  'Gift', 'Package', 'ShoppingCart', 'Storefront',
  'Handshake', 'HandWaving', 'Megaphone',
  'Lifebuoy', 'FirstAid', 'Pill',
  'Gauge', 'Speedometer',
  'Power', 'BatteryFull', 'Broadcast', 'WifiHigh',
  'Desktop', 'DeviceMobile', 'Devices',
  'Fingerprint', 'SealCheck', 'Certificate',
  'Robot', 'Brain', 'Strategy',
  'Scroll', 'Newspaper',
  'Crosshair', 'Target',
]

interface IconPickerProps {
  value?: string | null
  onChange: (iconName: string | null) => void
  compact?: boolean
}

const IconPicker = ({ value, onChange, compact = false }: IconPickerProps) => {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const gridRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const filteredIcons = useMemo(() => {
    if (!search.trim()) return ICON_LIST
    const q = search.toLowerCase()
    return ICON_LIST.filter((name) => name.toLowerCase().includes(q))
  }, [search])

  const handleSelect = useCallback(
    (iconName: string) => {
      onChange(iconName)
      setIsOpen(false)
      setSearch('')
    },
    [onChange]
  )

  const handleClear = useCallback(() => {
    onChange(null)
    setIsOpen(false)
    setSearch('')
  }, [onChange])

  // Focus search when opened
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => searchRef.current?.focus())
    }
  }, [isOpen])

  // Intercept wheel on the grid so Radix Dialog scroll-lock doesn't steal it
  useEffect(() => {
    if (!isOpen || !gridRef.current) return
    const el = gridRef.current
    const handler = (e: WheelEvent) => {
      e.stopPropagation()
      e.preventDefault()
      el.scrollTop += e.deltaY
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [isOpen])

  return (
    <Popover open={isOpen} onOpenChange={(open) => { setIsOpen(open); if (!open) setSearch('') }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`flex items-center justify-center transition-colors flex-shrink-0 ${
            compact
              ? 'w-6 h-6 rounded-md hover:bg-white/20'
              : 'w-9 h-9 border border-gray-200 rounded-lg hover:bg-gray-50'
          }`}
          title={value || 'Choose icon'}
        >
          <PhosphorIconRenderer
            iconName={value}
            size={compact ? 14 : 16}
            className={compact ? '' : 'text-gray-500'}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[300px] p-0 bg-white rounded-xl border border-gray-200 shadow-xl"
        style={{ zIndex: 9999 }}
        align="start"
        sideOffset={4}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {/* Search */}
        <div className="p-2.5 border-b border-gray-100">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              className="w-full pl-8 pr-3 py-1.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-1 focus:bg-white"
              placeholder="Search icons..."
            />
          </div>
        </div>

        {/* Icon grid */}
        <div
          ref={gridRef}
          className="p-2 overflow-y-auto overscroll-contain"
          style={{ maxHeight: '220px' }}
        >
          {value && (
            <button
              type="button"
              onClick={handleClear}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-red-500 hover:bg-red-50 rounded-lg mb-1 transition-colors"
            >
              <X size={12} />
              Remove icon
            </button>
          )}
          {filteredIcons.length > 0 ? (
            <div className="grid grid-cols-8 gap-0.5">
              {filteredIcons.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => handleSelect(name)}
                  title={name}
                  className={`flex items-center justify-center p-1.5 rounded-md transition-colors ${
                    value === name
                      ? 'bg-gray-900 text-white'
                      : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                  }`}
                >
                  <PhosphorIconRenderer
                    iconName={name}
                    size={18}
                    className={value === name ? 'text-white' : ''}
                  />
                </button>
              ))}
            </div>
          ) : (
            <p className="text-center text-xs text-gray-400 py-4">
              No icons found
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default IconPicker
