'use client'

/*
 The Light / Dark switches. Every one goes through useColorScheme(), so they
 all paint, save to this browser and (signed in) save to the account the same
 way. Pick the one that fits the host:

   ThemeMenuSub     a "Theme" submenu for Radix dropdown user menus
   ThemeIconButton  a sun / moon button (public header, auth pages, footers)
   ThemeChoice      two option cards for the account settings
*/

import React from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Moon, Sun } from '@phosphor-icons/react'
import { useColorScheme } from '@components/Contexts/ColorSchemeContext'
import type { ColorScheme } from '@/lib/theme/colorScheme'
import {
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@components/ui/dropdown-menu'

export const THEME_OPTIONS: { key: ColorScheme; Icon: typeof Sun; labelKey: string }[] = [
  { key: 'light', Icon: Sun, labelKey: 'common.theme_light' },
  { key: 'dark', Icon: Moon, labelKey: 'common.theme_dark' },
]

/** Hydration-safe scheme: "light" on the server and the first client pass. */
const noopSubscribe = () => () => {}
function useMounted() {
  return React.useSyncExternalStore(noopSubscribe, () => true, () => false)
}

export function ThemeMenuSub({ iconSize = 14 }: { iconSize?: number }) {
  const { t } = useTranslation()
  const { colorScheme, setColorScheme } = useColorScheme()
  const CurrentIcon = colorScheme === 'dark' ? Moon : Sun
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="flex items-center gap-2 space-x-2" data-testid="theme-menu">
        <CurrentIcon size={iconSize} weight="fill" />
        <span>{t('common.theme')}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent>
          {THEME_OPTIONS.map(({ key, Icon, labelKey }) => (
            <DropdownMenuItem
              key={key}
              onClick={() => setColorScheme(key)}
              className="flex items-center justify-between gap-3"
              data-testid={`theme-option-${key}`}
            >
              <span className="flex items-center gap-2">
                <Icon size={14} weight={colorScheme === key ? 'fill' : 'regular'} />
                {t(labelKey)}
              </span>
              {colorScheme === key && <Check size={14} weight="bold" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  )
}

export function ThemeIconButton({ className = '', size = 16 }: { className?: string; size?: number }) {
  const { t } = useTranslation()
  const { colorScheme, toggleColorScheme } = useColorScheme()
  const mounted = useMounted()
  const dark = mounted && colorScheme === 'dark'
  const label = dark ? t('common.switch_to_light') : t('common.switch_to_dark')
  return (
    <button
      type="button"
      onClick={toggleColorScheme}
      aria-label={label}
      title={label}
      aria-pressed={dark}
      data-testid="theme-toggle"
      className={`inline-flex items-center justify-center rounded-lg outline-none transition-colors focus-visible:ring-2 focus-visible:ring-neutral-900/20 ${className}`}
    >
      {dark ? <Sun size={size} weight="bold" /> : <Moon size={size} weight="bold" />}
    </button>
  )
}

export function ThemeChoice() {
  const { t } = useTranslation()
  const { colorScheme, setColorScheme } = useColorScheme()
  const mounted = useMounted()
  const current = mounted ? colorScheme : 'light'
  return (
    <div role="radiogroup" aria-label={t('common.theme')} className="grid grid-cols-2 gap-3 max-w-md">
      {THEME_OPTIONS.map(({ key, Icon, labelKey }) => {
        const selected = current === key
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setColorScheme(key)}
            data-testid={`theme-choice-${key}`}
            className={`group flex flex-col gap-2.5 rounded-xl p-2.5 text-start transition-shadow ${
              selected ? 'ring-2 ring-neutral-900' : 'ring-1 ring-neutral-200 hover:ring-neutral-300'
            }`}
          >
            {/* A tiny preview of each look, painted with fixed colors so it
                shows the other scheme too. */}
            <span
              aria-hidden="true"
              className="block h-16 w-full overflow-hidden rounded-lg"
              style={{ background: key === 'dark' ? '#0b0b0c' : '#f8f8f8', boxShadow: 'inset 0 0 0 1px rgb(127 127 127 / 0.22)' }}
            >
              <span className="flex h-full gap-1.5 p-2">
                <span className="w-5 rounded" style={{ background: key === 'dark' ? '#0b0b0c' : '#171717', boxShadow: key === 'dark' ? 'inset -1px 0 0 rgb(255 255 255 / 0.06)' : undefined }} />
                <span className="flex flex-1 flex-col gap-1.5 rounded p-1.5" style={{ background: key === 'dark' ? '#131315' : '#ffffff', boxShadow: key === 'dark' ? 'inset 0 0 0 1px rgb(255 255 255 / 0.08)' : undefined }}>
                  <span className="h-1.5 w-2/3 rounded-full" style={{ background: key === 'dark' ? '#ededef' : '#171717' }} />
                  <span className="h-1.5 w-1/2 rounded-full" style={{ background: key === 'dark' ? '#3f3f46' : '#d4d4d4' }} />
                </span>
              </span>
            </span>
            <span className="flex items-center gap-2 px-0.5 text-sm font-semibold text-neutral-900">
              <Icon size={15} weight={selected ? 'fill' : 'regular'} />
              {t(labelKey)}
              {selected && <Check size={13} weight="bold" className="ms-auto" />}
            </span>
          </button>
        )
      })}
    </div>
  )
}
