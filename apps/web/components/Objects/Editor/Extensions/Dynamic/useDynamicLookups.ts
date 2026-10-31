'use client'
import { useContext, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@components/Contexts/AuthContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { CourseContext } from '@components/Contexts/CourseContext'
import { getUserGroups } from '@services/usergroups/usergroups'
import { queryKeys } from '@/lib/query/keys'
import { asArray } from '@services/utils/ts/requests'

export interface LookupOption {
  value: string
  label: string
}

// Names for the uuids stored in rules: the org's user groups and the
// course's activities. Only fetched where an editor actually shows rules.
export function useDynamicLookups(enabled: boolean = true) {
  const org = useOrg() as any
  const { accessToken } = useAuth()
  const course = useContext(CourseContext) as any

  const { data: usergroupsRaw } = useQuery({
    queryKey: queryKeys.usergroups.list(org?.id),
    queryFn: () => getUserGroups(org.id, accessToken as string),
    select: (res: any) => res?.data ?? res,
    enabled: enabled && !!(org?.id && accessToken),
    staleTime: 60_000,
  })

  return useMemo(() => {
    const usergroups: LookupOption[] = asArray(usergroupsRaw).map((g: any) => ({
      value: g.usergroup_uuid,
      label: g.name,
    }))
    const activities: LookupOption[] = asArray(course?.courseStructure?.chapters).flatMap(
      (chapter: any) =>
        asArray(chapter.activities).map((a: any) => ({ value: a.activity_uuid, label: a.name }))
    )
    const toRecord = (options: LookupOption[]) =>
      Object.fromEntries(options.map((o) => [o.value, o.label]))
    return {
      usergroups,
      activities,
      names: { usergroups: toRecord(usergroups), activities: toRecord(activities) },
    }
  }, [usergroupsRaw, course?.courseStructure])
}
