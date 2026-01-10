'use client'

import React from 'react'
import { useTranslation } from 'react-i18next'
import { Languages, ChevronDown, Check } from 'lucide-react'
import { AVAILABLE_LANGUAGES } from '@/lib/languages'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@components/ui/dropdown-menu"

const LanguageSwitcher = () => {
  const { i18n, t } = useTranslation()

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng)
  }

  const currentLangCode = i18n.language.split('-')[0].toUpperCase()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center space-x-1.5 px-2.5 py-2 rounded-lg hover:bg-gray-100 transition-colors text-sm font-bold outline-none text-gray-600">
          <Languages size={16} strokeWidth={2.5} />
          <span>{currentLangCode}</span>
          <ChevronDown size={12} className="opacity-50" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        className="min-w-[180px] z-[100]"
        align="end"
      >
        {AVAILABLE_LANGUAGES.map((language) => (
          <DropdownMenuItem
            key={language.code}
            className="flex items-center justify-between cursor-pointer"
            onClick={() => changeLanguage(language.code)}
          >
            <span className="flex items-center space-x-2">
              <span className="text-xs font-mono text-gray-400 w-5">{language.code.toUpperCase()}</span>
              <span>{language.nativeName}</span>
            </span>
            {i18n.language === language.code && <Check size={14} className="text-black" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default LanguageSwitcher

