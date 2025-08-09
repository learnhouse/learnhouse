'use client'
import { getAPIUrl } from '@services/config/config'
import { swrFetcher } from '@services/utils/ts/requests'
import useSWR from 'swr'
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

  const { data: rights, error, isLoading } = useSWR<CourseRights>(
    courseuuid ? `${getAPIUrl()}courses/${courseuuid}/rights` : null,
    (url) => swrFetcher(url, access_token)
  )

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