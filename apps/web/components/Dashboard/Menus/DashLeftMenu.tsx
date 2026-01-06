'use client'
import { useOrg } from '@components/Contexts/OrgContext'
import { signOut } from 'next-auth/react'
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'
import LearnHouseDashboardLogo from '@public/dashLogo.png'
import { Backpack, BadgeDollarSign, BookCopy, Home, LogOut, Package2, School, Settings, Users } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import React, { useEffect } from 'react'
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

function DashLeftMenu() {
  const org = useOrg() as any
  const session = useLHSession() as any
  const { t, i18n } = useTranslation()
  const [loading, setLoading] = React.useState(true)

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng)
  }
  const isPaymentsEnabled = useFeatureFlag({ path: ['features', 'payments', 'enabled'], defaultValue: false })

  function waitForEverythingToLoad() {
    if (org && session) {
      return true
    }
    return false
  }

  async function logOutUI() {
    const res = await signOut({ redirect: true, callbackUrl: getUriWithoutOrg('/login?orgslug=' + org.slug) })
    if (res) {
      getUriWithOrg(org.slug, '/')
    }
  }

  useEffect(() => {
    if (waitForEverythingToLoad()) {
      setLoading(false)
    }
  }, [loading])

  return (
    <div
      style={{
        background:
          'linear-gradient(0deg, rgba(0, 0, 0, 0.2) 0%, rgba(0, 0, 0, 0.2) 100%), radial-gradient(271.56% 105.16% at 50% -5.16%, rgba(255, 255, 255, 0.18) 0%, rgba(0, 0, 0, 0) 100%), rgb(20 19 19)',
      }}
      className="flex flex-col w-[90px] bg-black text-white shadow-xl h-screen sticky top-0"
    >
      <div className="flex flex-col h-full">
        <div className="flex h-20 mt-6">
          <Link
            className="flex flex-col items-center mx-auto space-y-3"
            href={'/'}
          >
            <ToolTip
              content={t('common.back_to_home')}
              slateBlack
              sideOffset={8}
              side="right"
            >
              <Image
                alt="Learnhouse logo"
                width={40}
                src={LearnHouseDashboardLogo}
              />
            </ToolTip>
            <ToolTip
              content={t('common.your_organization')}
              slateBlack
              sideOffset={8}
              side="right"
            >
              <div className="py-1 px-3 bg-black/40 opacity-40 rounded-md text-[10px] justify-center text-center">
                {org?.name}
              </div>
            </ToolTip>
          </Link>
        </div>
        <div className="flex grow flex-col justify-center space-y-5 items-center mx-auto">
          {/* <ToolTip content={"Back to " + org?.name + "'s Home"} slateBlack sideOffset={8} side='right'  >
                        <Link className='bg-white text-black hover:text-white rounded-lg p-2 hover:bg-white/10 transition-all ease-linear' href={`/`} ><ArrowLeft className='hover:text-white' size={18} /></Link>
                    </ToolTip> */}
          <AdminAuthorization authorizationMode="component">
            <ToolTip content={t('common.home')} slateBlack sideOffset={8} side="right">
              <Link
                aria-label="Home"
                className="bg-white/5 rounded-lg p-2 hover:bg-white/10 transition-all ease-linear"
                href={`/dash`}
              >
                <Home size={18} />
              </Link>
            </ToolTip>
            <ToolTip content={t('courses.courses')} slateBlack sideOffset={8} side="right">
              <Link
                aria-label="Courses"
                className="bg-white/5 rounded-lg p-2 hover:bg-white/10 transition-all ease-linear"
                href={`/dash/courses`}
              >
                <BookCopy size={18} />
              </Link>
            </ToolTip>
            <ToolTip content={t('common.assignments')} slateBlack sideOffset={8} side="right">
              <Link
                aria-label="Assignments"
                className="bg-white/5 rounded-lg p-2 hover:bg-white/10 transition-all ease-linear"
                href={`/dash/assignments`}
              >
                <Backpack size={18} />
              </Link>
            </ToolTip>
            <ToolTip content={t('common.users')} slateBlack sideOffset={8} side="right">
              <Link
                aria-label="Users"
                className="bg-white/5 rounded-lg p-2 hover:bg-white/10 transition-all ease-linear"
                href={`/dash/users/settings/users`}
              >
                <Users size={18} />
              </Link>
            </ToolTip>
            {isPaymentsEnabled && (
              <ToolTip content={t('common.payments')} slateBlack sideOffset={8} side="right">
                <Link
                  aria-label="Payments"
                  className="bg-white/5 rounded-lg p-2 hover:bg-white/10 transition-all ease-linear"
                  href={`/dash/payments/customers`}
                >
                  <BadgeDollarSign size={18} />
                </Link>
              </ToolTip>
            )}
            <ToolTip
              content={t('common.organization')}
              slateBlack
              sideOffset={8}
              side="right"
            >
              <Link
                aria-label="Organization"
                className="bg-white/5 rounded-lg p-2 hover:bg-white/10 transition-all ease-linear"
                href={`/dash/org/settings/general`}
              >
                <School size={18} />
              </Link>
            </ToolTip>
          </AdminAuthorization>
        </div>
        <div className="flex flex-col mx-auto pb-7 space-y-2">
          <div className="flex items-center flex-col space-y-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <div className="mx-auto cursor-pointer transition-transform hover:scale-110">
                  <UserAvatar border="border-4" width={35} />
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="end" className="w-56 ml-2">
                <DropdownMenuLabel>
                  <div className="flex flex-col">
                    <p className="text-sm font-medium">{session.data.user.username}</p>
                    <p className="text-xs text-gray-500">{session.data.user.email}</p>
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
                      <DropdownMenuItem onClick={() => changeLanguage('en')} className="flex items-center justify-between">
                        <span>{t('common.english')}</span>
                        {i18n.language === 'en' && <Check size={14} />}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => changeLanguage('fr')} className="flex items-center justify-between">
                        <span>{t('common.french')}</span>
                        {i18n.language === 'fr' && <Check size={14} />}
                      </DropdownMenuItem>
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
          </div>
        </div>
      </div>
    </div>
  )
}

export default DashLeftMenu
