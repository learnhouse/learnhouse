'use client'
import React, { useEffect, useMemo } from 'react'
import styled from 'styled-components'
import Link from 'next/link'
import { Package2, Crown, Shield, User, Users, LogOut, User as UserIcon, ChevronDown } from 'lucide-react'
import UserAvatar from '@components/Objects/UserAvatar'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { getUriWithoutOrg } from '@services/config/config'
import Tooltip from '@components/Objects/StyledElements/Tooltip/Tooltip'
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
import { signOut } from 'next-auth/react'
import { useTranslation } from 'react-i18next'
import { Languages, Check } from 'lucide-react'
import { AVAILABLE_LANGUAGES } from '@/lib/languages'

interface RoleInfo {
  name: string;
  icon: React.ReactNode;
  bgColor: string;
  textColor: string;
  description: string;
}

interface CustomRoleInfo {
  name: string;
  description?: string;
}

export const HeaderProfileBox = () => {
  const session = useLHSession() as any
  const { isAdmin, loading, userRoles, rights } = useAdminStatus()
  const org = useOrg() as any
  const { t, i18n } = useTranslation()

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng)
  }

  useEffect(() => { }
    , [session])

  const userRoleInfo = useMemo((): RoleInfo | null => {
    if (!userRoles || userRoles.length === 0) return null;

    // Find the highest priority role for the current organization
    const orgRoles = userRoles.filter((role: any) => role.org.id === org?.id);
    
    if (orgRoles.length === 0) return null;

    // Sort by role priority (admin > maintainer > instructor > user)
    const sortedRoles = orgRoles.sort((a: any, b: any) => {
      const getRolePriority = (role: any) => {
        if (role.role.role_uuid === 'role_global_admin' || role.role.id === 1) return 4;
        if (role.role.role_uuid === 'role_global_maintainer' || role.role.id === 2) return 3;
        if (role.role.role_uuid === 'role_global_instructor' || role.role.id === 3) return 2;
        return 1;
      };
      return getRolePriority(b) - getRolePriority(a);
    });

    const highestRole = sortedRoles[0];

    // Define role configurations based on actual database roles
    const roleConfigs: { [key: string]: RoleInfo } = {
      'role_global_admin': {
        name: t('roles.role_admin'),
        icon: <Crown size={12} />,
        bgColor: 'bg-purple-600',
        textColor: 'text-white',
        description: t('roles.role_admin_desc')
      },
      'role_global_maintainer': {
        name: t('roles.role_maintainer'),
        icon: <Shield size={12} />,
        bgColor: 'bg-blue-600',
        textColor: 'text-white',
        description: t('roles.role_maintainer_desc')
      },
      'role_global_instructor': {
        name: t('roles.role_instructor'),
        icon: <Users size={12} />,
        bgColor: 'bg-green-600',
        textColor: 'text-white',
        description: t('roles.role_instructor_desc')
      },
      'role_global_user': {
        name: t('roles.role_user'),
        icon: <User size={12} />,
        bgColor: 'bg-gray-500',
        textColor: 'text-white',
        description: t('roles.role_user_desc')
      }
    };

    // Determine role based on role_uuid or id
    let roleKey = 'role_global_user'; // default
    if (highestRole.role.role_uuid) {
      roleKey = highestRole.role.role_uuid;
    } else if (highestRole.role.id === 1) {
      roleKey = 'role_global_admin';
    } else if (highestRole.role.id === 2) {
      roleKey = 'role_global_maintainer';
    } else if (highestRole.role.id === 3) {
      roleKey = 'role_global_instructor';
    }

    return roleConfigs[roleKey] || roleConfigs['role_global_user'];
  }, [userRoles, org?.id]);

  const customRoles = useMemo((): CustomRoleInfo[] => {
    if (!userRoles || userRoles.length === 0) return [];

    // Find roles for the current organization
    const orgRoles = userRoles.filter((role: any) => role.org.id === org?.id);
    
    if (orgRoles.length === 0) return [];

    // Filter for custom roles (not system roles)
    const customRoles = orgRoles.filter((role: any) => {
      // Check if it's a system role
      const isSystemRole = 
        role.role.role_uuid?.startsWith('role_global_') ||
        [1, 2, 3, 4].includes(role.role.id) ||
        ['Admin', 'Maintainer', 'Instructor', 'User'].includes(role.role.name);
      
      return !isSystemRole;
    });

    return customRoles.map((role: any) => ({
      name: role.role.name || t('roles.custom_role'),
      description: role.role.description
    }));
  }, [userRoles, org?.id]);

  return (
    <ProfileArea>
      {session.status == 'unauthenticated' && (
        <UnidentifiedArea className="flex text-sm text-gray-700 font-bold p-1.5 px-2 rounded-lg">
          <ul className="flex space-x-3 items-center">
            <li>
              <Link
                href={{ pathname: getUriWithoutOrg('/login'), query: org ? { orgslug: org.slug } : null }} >{t('auth.login')}</Link>
            </li>
            <li className="bg-black rounded-lg shadow-md p-2 px-3 text-white">
              <Link href={{ pathname: getUriWithoutOrg('/signup'), query: org ? { orgslug: org.slug } : null }}>{t('auth.sign_up')}</Link>
            </li>
          </ul>
        </UnidentifiedArea>
      )}
      {session.status == 'authenticated' && (
        <AccountArea className="space-x-0">
          <div className="flex items-center space-x-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="cursor-pointer flex items-center space-x-3 hover:bg-gray-50 rounded-lg p-2 transition-colors">
                  <UserAvatar border="border-2" rounded="rounded-lg" width={30} />
                  <div className="flex flex-col space-y-0">
                    <div className="flex items-center space-x-2">
                      <p className='text-sm font-semibold text-gray-900 capitalize'>{session.data.user.username}</p>
                      {userRoleInfo && userRoleInfo.name !== 'USER' && (
                        <Tooltip 
                          content={userRoleInfo.description}
                          sideOffset={15}
                          side="bottom"
                        >
                          <div className={`text-[6px] ${userRoleInfo.bgColor} ${userRoleInfo.textColor} px-1 py-0.5 font-medium rounded-full flex items-center gap-0.5 w-fit`}>
                            {userRoleInfo.icon}
                            {userRoleInfo.name}
                          </div>
                        </Tooltip>
                      )}
                      {/* Custom roles */}
                      {customRoles.map((customRole, index) => (
                        <Tooltip 
                          key={index}
                          content={customRole.description || `${t('roles.custom_role')}: ${customRole.name}`}
                          sideOffset={15}
                          side="bottom"
                        >
                          <div className="text-[6px] bg-gray-500 text-white px-1 py-0.5 font-medium rounded-full flex items-center gap-0.5 w-fit">
                            <Shield size={12} />
                            {customRole.name}
                          </div>
                        </Tooltip>
                      ))}
                    </div>
                    <p className='text-xs text-gray-500'>{session.data.user.email}</p>
                  </div>
                  <ChevronDown size={16} className="text-gray-500" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end">
                <DropdownMenuLabel>
                  <div className="flex items-center space-x-2">
                    <UserAvatar border="border-2" rounded="rounded-full" width={24} />
                    <div>
                      <p className="text-sm font-medium">{session.data.user.username}</p>
                      <p className="text-xs text-gray-500 capitalize">{session.data.user.email}</p>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {rights?.dashboard?.action_access && (
                  <DropdownMenuItem asChild>
                    <Link href="/dash" className="flex items-center space-x-2">
                      <Shield size={16} />
                      <span>{t('common.dashboard')}</span>
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem asChild>
                  <Link href="/dash/user-account/settings/general" className="flex items-center space-x-2">
                    <UserIcon size={16} />
                    <span>{t('user.user_settings')}</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/dash/user-account/owned" className="flex items-center space-x-2">
                    <Package2 size={16} />
                    <span>{t('courses.my_courses')}</span>
                  </Link>
                </DropdownMenuItem>
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
                <DropdownMenuItem 
                  onClick={() => signOut({ callbackUrl: '/' })}
                  className="flex items-center space-x-2 text-red-600 focus:text-red-600"
                >
                  <LogOut size={16} />
                  <span>Sign Out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </AccountArea>
      )}
    </ProfileArea>
  )
}

const AccountArea = styled.div`
  display: flex;
  place-items: center;

  img {
    width: 29px;
  }
`

const ProfileArea = styled.div`
  display: flex;
  place-items: stretch;
  place-items: center;
`

const UnidentifiedArea = styled.div`
  display: flex;
  place-items: stretch;
  grow: 1;
`
