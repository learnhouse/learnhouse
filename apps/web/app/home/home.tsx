'use client'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import UserAvatar from '@components/Objects/UserAvatar';
import { getAPIUrl, getUriWithOrg, getUriWithoutOrg } from '@services/config/config';
import { swrFetcher } from '@services/utils/ts/requests';
import { ArrowRightCircle, Info } from 'lucide-react';
import { signOut } from 'next-auth/react';
import Image from 'next/image';
import Link from 'next/link';
import learnhouseIcon from 'public/learnhouse_bigicon_1.png'
import React, { useEffect } from 'react'
import useSWR from 'swr';
import { useTranslation } from 'react-i18next';
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
import { Languages, Check, LogOut, Settings, User } from 'lucide-react';
import { AVAILABLE_LANGUAGES } from '@/lib/languages';

function HomeClient() {
  const { t, i18n } = useTranslation();
  const session = useLHSession() as any;
  const access_token = session?.data?.tokens?.access_token;
  const { data: orgs } = useSWR(`${getAPIUrl()}orgs/user/page/1/limit/10`, (url) => swrFetcher(url, access_token))

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng)
  }

  useEffect(() => {
  }, [session, orgs])
  return (
    <div className='flex flex-col'>
      <div className='flex space-x-4 mx-auto font-semibold text-3xl pt-16 items-center bg-black rounded-b-2xl'>
        <Image
          quality={100}
          width={60}
          height={60}
          src={learnhouseIcon}
          alt=""
        />
      </div>

      <div className='flex space-x-4 mx-auto font-semibold text-2xl pt-16 items-center'>
        <span>{t('common.hello')},</span> 
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <div className="cursor-pointer transition-transform hover:scale-105">
              <UserAvatar border="border-2" rounded="rounded-full" width={40} />
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="center">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <p className="text-sm font-medium">{session?.data?.user.first_name} {session?.data?.user.last_name}</p>
                <p className="text-xs text-gray-500">{session?.data?.user.email}</p>
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
            <DropdownMenuSeparator />
            <DropdownMenuItem 
              onClick={() => signOut({ redirect: true, callbackUrl: getUriWithoutOrg('/') })}
              className="flex items-center space-x-2 text-red-600 focus:text-red-600"
            >
              <LogOut size={16} />
              <span>{t('user.sign_out')}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <span className='capitalize'>{session?.data?.user.first_name} {session?.data?.user.last_name}</span>
      </div>
      
      <div className='flex space-x-4 mx-auto font-semibold text-sm mt-12 items-center uppercase bg-slate-200 text-gray-600 px-3 py-2 rounded-md'>{t('common.your_organizations')}</div>
      {orgs && orgs.length == 0 && <div className='flex mx-auto my-5 space-x-3 bg-rose-200 rounded-lg px-3 py-2'>
        <Info />
        <span>{t('common.no_orgs_message')} </span>
      </div>}
      <div className='flex mx-auto pt-10 rounded-lg'>
        {orgs && orgs.map((org: any) => (
          <Link href={getUriWithOrg(org.slug, '/')} key={org.id} className='flex space-x-2 mx-auto w-fit justify-between items-center outline outline-1 outline-slate-200 px-3 py-2 rounded-lg'>
            <div>{org.name}</div>
            <ArrowRightCircle />
          </Link>
        ))}
      </div>
    </div>
  )
}

export default HomeClient