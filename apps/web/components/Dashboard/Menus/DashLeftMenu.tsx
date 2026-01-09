'use client'
import { useOrg } from '@components/Contexts/OrgContext'
import { signOut } from 'next-auth/react'
import { Backpack, BadgeDollarSign, BookCopy, ChevronLeft, ChevronRight, HelpCircle, Home, LogOut, Package2, School, Settings, Users } from 'lucide-react'
import Link from 'next/link'
import React, { useEffect, useState } from 'react'
import UserAvatar from '../../Objects/UserAvatar'
import AdminAuthorization from '@components/Security/AdminAuthorization'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getUriWithOrg, getUriWithoutOrg } from '@services/config/config'
import useFeatureFlag from '@components/Hooks/useFeatureFlag'
import { useTranslation } from 'react-i18next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
} from "@components/ui/dropdown-menu"
import { Check, Languages } from 'lucide-react'
import { AVAILABLE_LANGUAGES } from '@/lib/languages'
import { cn } from '@/lib/utils'
import { useEEStatus } from '@components/Hooks/useEEStatus'
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'

function DashLeftMenu() {
  const org = useOrg() as any
  const session = useLHSession() as any
  const { t, i18n } = useTranslation()
  const [isCollapsed, setIsCollapsed] = useState(false)
  const { isEE } = useEEStatus()

  // Load collapse state from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('dash-menu-collapsed')
      if (saved !== null && saved === 'true') {
        setTimeout(() => setIsCollapsed(true), 0)
      }
    }
  }, [])

  const toggleCollapse = () => {
    const newState = !isCollapsed
    setIsCollapsed(newState)
    localStorage.setItem('dash-menu-collapsed', String(newState))
  }

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng)
  }
  const isPaymentsEnabled = useFeatureFlag({ path: ['features', 'payments', 'enabled'], defaultValue: false })

  async function logOutUI() {
    const res = await signOut({ redirect: true, callbackUrl: getUriWithoutOrg('/login?orgslug=' + org.slug) })
    if (res) {
      getUriWithOrg(org.slug, '/')
    }
  }

  if (!org || !session) return null

  const plan = org?.config?.cloud?.plan || 'free'

  return (
    <div
      style={{
        background:
          'linear-gradient(180deg, rgba(20, 19, 19, 1) 0%, rgba(10, 10, 10, 1) 100%)',
      }}
      className={cn(
        "flex flex-col text-white shadow-2xl h-screen sticky top-0 border-r border-white/5 transition-all duration-500 ease-in-out z-50",
        isCollapsed ? "w-20" : "w-64"
      )}
    >
      <div className="flex flex-col h-full px-4 relative">
        {/* Toggle Button */}
        <button
          onClick={toggleCollapse}
          className="absolute -right-3 top-12 bg-white text-black border border-white/10 rounded-full p-1 hover:scale-110 transition-all z-50 shadow-lg"
        >
          {isCollapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
        </button>

        <div className={cn("flex h-24 items-center transition-all duration-500", isCollapsed ? "justify-center" : "px-3")}>
          <Link
            className="flex items-center space-x-4 transition-all hover:opacity-80 group"
            href={'/'}
          >
            {!isCollapsed && (
              <div className="flex flex-col animate-in fade-in slide-in-from-left-2 duration-500 min-w-0 pr-2 overflow-visible">
                <div className="mb-1.5">
                  <span className={cn(
                    "px-1.5 py-0.5 rounded-[3px] text-[7px] font-black uppercase tracking-widest border transition-colors inline-block",
                    plan === 'pro' ? "bg-purple-500/20 text-purple-300 border-purple-500/20" :
                    plan === 'standard' ? "bg-blue-500/20 text-blue-300 border-blue-500/20" :
                    "bg-white/10 text-white/60 border-white/10"
                  )}>
                    {plan} PLAN
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="font-bold text-sm leading-[1.2] text-white whitespace-normal wrap-break-word">
                    {org?.name}
                  </span>
                </div>
              </div>
            )}
          </Link>
        </div>

        <div className="flex-1 flex flex-col justify-center space-y-1 py-8">
          <AdminAuthorization authorizationMode="component">
            <MenuLink 
              href="/dash" 
              icon={<Home size={18} />} 
              label={t('common.home')} 
              isCollapsed={isCollapsed} 
            />
            <MenuLink 
              href="/dash/courses" 
              icon={<BookCopy size={18} />} 
              label={t('courses.courses')} 
              isCollapsed={isCollapsed} 
            />
            <MenuLink 
              href="/dash/assignments" 
              icon={<Backpack size={18} />} 
              label={t('common.assignments')} 
              isCollapsed={isCollapsed} 
            />
            <MenuLink 
              href="/dash/users/settings/users" 
              icon={<Users size={18} />} 
              label={t('common.users')} 
              isCollapsed={isCollapsed} 
            />
            {isPaymentsEnabled && (
              <MenuLink 
                href="/dash/payments/customers" 
                icon={<BadgeDollarSign size={18} />} 
                label={t('common.payments')} 
                isCollapsed={isCollapsed} 
              />
            )}
            <MenuLink 
              href="/dash/org/settings/general" 
              icon={<School size={18} />} 
              label={t('common.organization')} 
              isCollapsed={isCollapsed} 
            />
            
            <div className="my-4 border-t border-white/5 mx-2 opacity-50" />
            
            <MenuLink 
              href="https://docs.learnhouse.app" 
              icon={<HelpCircle size={18} />} 
              label={t('common.help')} 
              isCollapsed={isCollapsed} 
              isExternal
            />
          </AdminAuthorization>
        </div>

        <div className="flex flex-col pb-6 pt-2 mt-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <div className={cn(
                "flex items-center space-x-3 cursor-pointer rounded-xl hover:bg-white/5 transition-all group duration-300 mx-2",
                isCollapsed ? "justify-center px-0 py-2" : "px-3 py-2.5"
              )}>
                <UserAvatar 
                  width={isCollapsed ? 32 : 28} 
                  rounded="rounded-full"
                  shadow="shadow-[0_10px_40px_rgba(0,0,0,1)]"
                />
                {!isCollapsed && (
                  <div className="flex flex-col flex-1 min-w-0 animate-in fade-in duration-500">
                    <span className="text-sm font-bold truncate text-white/90 group-hover:text-white transition-colors">
                      {session?.data?.user?.username?.toUpperCase()}
                    </span>
                    <span className="text-[10px] text-white/20 truncate group-hover:text-white/40 transition-colors font-black tracking-tighter">
                      {session?.data?.user?.email?.toUpperCase()}
                    </span>
                  </div>
                )}
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="end" className="w-56 ml-2">
                <DropdownMenuLabel>
                  <div className="flex flex-col">
                    <p className="text-sm font-medium">{session?.data?.user?.username}</p>
                    <p className="text-xs text-gray-500">{session?.data?.user?.email}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="flex items-center space-x-2">
                    <Languages size={14} />
                    <span>{t('common.language')}</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent>
                      {AVAILABLE_LANGUAGES.map((language) => (
                        <DropdownMenuItem 
                          key={language.code}
                          onClick={() => changeLanguage(language.code)} 
                          className="flex items-center justify-between"
                        >
                          <span>{t(language.translationKey)} ({language.nativeName})</span>
                          {i18n.language === language.code && <Check size={14} />}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/dash/user-account/settings/general" className="flex items-center space-x-2 w-full">
                    <Settings size={16} />
                    <span>{t('common.settings')}</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/dash/user-account/owned" className="flex items-center space-x-2 w-full">
                    <Package2 size={16} />
                    <span>{t('courses.my_courses')}</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem 
                  onClick={() => logOutUI()}
                  className="flex items-center space-x-2 text-red-600 focus:text-red-600"
                >
                  <LogOut size={16} />
                  <span>{t('user.sign_out')}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

          {!isCollapsed && (
            <div className="flex flex-col mt-2">
              <div className="h-px bg-white/5 -mx-4 my-2" />
              
              <div className="px-4 mt-1.5 animate-in fade-in duration-1000">
                <div className="flex items-center space-x-2 text-white/10 font-black tracking-widest text-[8px]">
                  <div className="flex items-center space-x-1.5">
                    <span>LEARNHOUSE</span>
                    {isEE ? (
                      <ToolTip content="ENTERPRISE EDITION" side="top" slateBlack sideOffset={10}>
                        <span className="bg-purple-500/10 text-purple-400/40 px-1 py-0.5 rounded-[3px] border border-purple-500/10 cursor-help transition-colors hover:text-purple-300">EE</span>
                      </ToolTip>
                    ) : (
                      <span className="border border-white/5 px-1 py-0.5 rounded-[3px]">CE</span>
                    )}
                  </div>
                  <span>V0.1.0</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const MenuLink = ({ href, icon, label, isCollapsed, isExternal }: { href: string, icon: React.ReactNode, label: string, isCollapsed: boolean, isExternal?: boolean }) => {
  const content = (
    <div
      className={cn(
        "flex items-center px-3 py-2.5 rounded-xl transition-all duration-300 text-white/50 hover:text-white group relative hover:bg-white/5",
        isCollapsed ? "justify-center space-x-0" : "space-x-3"
      )}
    >
      <div className="group-hover:scale-110 transition-transform duration-300">
        {icon}
      </div>
      {!isCollapsed && (
        <span className="text-sm font-semibold tracking-tight animate-in slide-in-from-left-2 duration-500">
          {label}
        </span>
      )}
    {isCollapsed && (
      <div className="absolute left-full ml-4 px-3 py-1.5 bg-white text-black text-[11px] font-bold rounded-lg opacity-0 group-hover:opacity-100 transition-all duration-300 whitespace-nowrap z-50 pointer-events-none shadow-[0_10px_30px_-5px_rgba(0,0,0,0.3),0_0_0_1px_rgba(255,255,255,0.05)] translate-x-[-10px] group-hover:translate-x-0 uppercase tracking-wider">
        {label}
      </div>
    )}
    </div>
  )

  if (isExternal) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label}>
        {content}
      </a>
    )
  }

  return (
    <Link aria-label={label} href={href}>
      {content}
    </Link>
  )
}

export default DashLeftMenu
