'use client'
import { getCourseRights } from '@services/courses/courses'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { useLHSession } from '@components/Contexts/LHSessionContext'

export interface CourseRights {
  course_uuid: string
  user_id: number
  is_anonymous: boolean
  permissions: {
    read: boolean
    create: boolean
    update: boolean
    delete: boolean
    create_content: boolean
    update_content: boolean
    delete_content: boolean
    manage_contributors: boolean
    manage_access: boolean
    grade_assignments: boolean
    mark_activities_done: boolean
    create_certifications: boolean
  }
  ownership: {
    is_owner: boolean
    is_creator: boolean
    is_maintainer: boolean
    is_contributor: boolean
    authorship_status: string
  }
  roles: {
    is_admin: boolean
    is_maintainer_role: boolean
    is_instructor: boolean
    is_user: boolean
  }
}

export function useCourseRights(courseuuid: string) {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const { data: rights, error, isLoading } = useQuery<CourseRights>({
    queryKey: queryKeys.courses.rights(courseuuid),
    queryFn: () => getCourseRights(courseuuid, access_token),
    enabled: !!courseuuid && !!access_token,
    staleTime: 60_000,
  })

  return {
    rights,
    error,
    isLoading,
    hasPermission: (permission: keyof CourseRights['permissions']) => {
      return rights?.permissions?.[permission] ?? false
    },
    hasRole: (role: keyof CourseRights['roles']) => {
      return rights?.roles?.[role] ?? false
    },
    isOwner: rights?.ownership?.is_owner ?? false,
    isCreator: rights?.ownership?.is_creator ?? false,
    isMaintainer: rights?.ownership?.is_maintainer ?? false,
    isContributor: rights?.ownership?.is_contributor ?? false
  }
} 