'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { ArrowSquareOut, ShieldCheck, UsersThree } from '@phosphor-icons/react'
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@components/ui/dropdown-menu'
import { useOrg } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import { GROUP_COLORS } from '@components/Dashboard/Pages/Users/OrgUserGroups/groupsApi'
import { useMyGroups } from './myGroupsQuery'

const MAX = 8

/** The groups a person belongs to and manages, for the account menus.
 *  Hidden when they have none (or groups aren't on the org's plan). */
export function useMenuGroups() {
  const org = useOrg() as any
  const enabled = org?.config?.config?.resolved_features?.usergroups?.enabled !== false
  const { data } = useMyGroups(enabled)
  const manages: any[] = data?.manages ?? []
  const memberOf: any[] = (data?.member_of ?? []).filter((g: any) => !manages.some((m) => m.id === g.id))
  return { manages, memberOf, any: manages.length + memberOf.length > 0, orgslug: (org?.slug ?? '') as string }
}

const spaceHref = (orgslug: string, g: any) =>
  getUriWithOrg(orgslug, g.space_enabled ? `/groups/${String(g.usergroup_uuid).replace('usergroup_', '')}` : '/groups')

function Dot({ color }: { color?: string | null }) {
  return <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${GROUP_COLORS[color || '']?.dot ?? 'bg-sky-500'}`} />
}

/** Desktop user dropdown: a "My groups" submenu. */
export default function GroupMenuItems() {
  const { t } = useTranslation()
  const { manages, memberOf, any, orgslug } = useMenuGroups()
  if (!any) return null
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="flex items-center gap-2 space-x-2" data-testid="menu-my-groups">
        <UsersThree size={16} weight="fill" />
        <span>{t('groups.menu.title')}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent className="w-60 max-h-80 overflow-auto">
          {memberOf.length > 0 && (
            <>
              <DropdownMenuLabel className="text-xs font-medium text-gray-500">{t('groups.menu.member_of')}</DropdownMenuLabel>
              {memberOf.slice(0, MAX).map((g) => (
                <DropdownMenuItem key={g.id} asChild>
                  <Link href={spaceHref(orgslug, g)} className="flex items-center gap-2">
                    <Dot color={g.color} />
                    <span className="truncate flex-1" dir="auto">{g.name}</span>
                    {g.space_enabled && <ArrowSquareOut size={13} className="text-gray-400 shrink-0 rtl:-scale-x-100" />}
                  </Link>
                </DropdownMenuItem>
              ))}
            </>
          )}
          {manages.length > 0 && (
            <>
              {memberOf.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel className="text-xs font-medium text-gray-500">{t('groups.menu.manages')}</DropdownMenuLabel>
              {manages.slice(0, MAX).map((g) => (
                <DropdownMenuItem key={g.id} asChild>
                  <Link href={getUriWithOrg(orgslug, `/groups?group=${g.id}`)} className="flex items-center gap-2">
                    <Dot color={g.color} />
                    <span className="truncate flex-1" dir="auto">{g.name}</span>
                    <ShieldCheck size={13} className="text-emerald-600 shrink-0" />
                  </Link>
                </DropdownMenuItem>
              ))}
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href={getUriWithOrg(orgslug, '/groups')} className="flex items-center gap-2 font-medium">
              <UsersThree size={15} />
              <span>{t('groups.menu.all')}</span>
            </Link>
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  )
}
