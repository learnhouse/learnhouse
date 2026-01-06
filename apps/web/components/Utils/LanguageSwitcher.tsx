'use client'

import React from 'react'
import { useTranslation } from 'react-i18next'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Languages, ChevronDown } from 'lucide-react'

const LanguageSwitcher = () => {
  const { i18n, t } = useTranslation()

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng)
  }

  const currentLanguage = i18n.language === 'fr' ? 'Français' : 'English'

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="flex items-center space-x-2 px-3 py-2 rounded-md hover:bg-gray-100 transition-colors text-sm font-medium outline-none">
          <Languages size={18} />
          <span>{currentLanguage}</span>
          <ChevronDown size={14} />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="min-w-[150px] bg-white rounded-md p-1 shadow-lg border border-gray-200 z-[100]"
          sideOffset={5}
        >
          <DropdownMenu.Item
            className="flex items-center px-2 py-2 text-sm text-gray-700 rounded-sm cursor-pointer hover:bg-gray-100 outline-none"
            onClick={() => changeLanguage('en')}
          >
            English
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className="flex items-center px-2 py-2 text-sm text-gray-700 rounded-sm cursor-pointer hover:bg-gray-100 outline-none"
            onClick={() => changeLanguage('fr')}
          >
            Français
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

export default LanguageSwitcher

