'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { CalendarBlank, X } from '@phosphor-icons/react'
import { formatDate, ugKeys, useUG } from './groupsApi'
import { GroupTile, SourceChips } from './ugUi'

/** The member side panel's group list: how they joined each group and when
 *  they leave it. Only direct memberships can be removed from here. */
export default function MemberGroupsList({
  userId,
  groups,
  canManage,
  onRemove,
  removeLabel,
}: {
  userId: number
  groups: any[]
  canManage: boolean
  onRemove: (_g: any) => void
  removeLabel: (_g: any) => string
}) {
  const { t, i18n } = useTranslation()
  const { call, orgId, ready } = useUG()
  const { data } = useQuery({
    queryKey: ugKeys.memberGroups(orgId, userId),
    queryFn: () => call<any[]>('GET', `org/${orgId}/members/${userId}/groups`),
    enabled: ready && canManage,
    staleTime: 30_000,
  })
  const detail = new Map((Array.isArray(data) ? data : []).map((g: any) => [g.id, g]))
  return (
    <ul className="divide-y divide-neutral-100">
      {groups.map((g) => {
        const d = detail.get(g.id)
        const sources: string[] = d?.sources ?? []
        const direct = !d || sources.some((s) => ['manual', 'code', 'import', 'domain'].includes(s))
        return (
          <li key={g.id} className="flex items-center gap-3 px-4 py-2.5">
            <GroupTile color={g.color ?? d?.color} kind={g.kind ?? d?.kind} size={28} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-neutral-800 truncate" dir="auto">
                {g.name}
              </span>
              {(sources.length > 0 || d?.expires_at) && (
                <span className="flex flex-wrap items-center gap-1.5 mt-0.5">
                  {sources.length > 0 && <SourceChips sources={sources} />}
                  {d?.expires_at && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-amber-700">
                      <CalendarBlank size={11} /> {t('groups.members.leaves_on', { date: formatDate(d.expires_at, i18n.language) })}
                    </span>
                  )}
                </span>
              )}
            </span>
            {canManage && direct && (
              <button
                type="button"
                onClick={() => onRemove(g)}
                className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-neutral-400 hover:text-rose-600 hover:bg-rose-50"
                aria-label={removeLabel(g)}
                title={removeLabel(g)}
              >
                <X size={13} weight="bold" />
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
