'use client'

import { useQuery } from '@tanstack/react-query'
import { getOrgCourses } from '@services/courses/courses'
import {
  getBroadcastTargets,
  getDirectory,
  listAgents,
  listConversations,
} from '@services/messaging/messaging'
import { messagingKeys, useMessaging } from '@components/Messaging/MessagingProvider'

export function useConversations() {
  const { orgId, token, enabled } = useMessaging()
  return useQuery({
    queryKey: messagingKeys.conversations(orgId ?? 0),
    queryFn: () => listConversations(orgId!, token!),
    enabled: enabled && Boolean(orgId && token),
    staleTime: 30_000,
  })
}

export function useAgents() {
  const { orgId, token, enabled } = useMessaging()
  return useQuery({
    queryKey: messagingKeys.agents(orgId ?? 0),
    queryFn: () => listAgents(orgId!, token!),
    enabled: enabled && Boolean(orgId && token),
    staleTime: 60_000,
  })
}

export function useDirectory(q: string, enabledFlag = true) {
  const { orgId, token, enabled } = useMessaging()
  return useQuery({
    queryKey: messagingKeys.directory(orgId ?? 0, q),
    queryFn: () => getDirectory(orgId!, q, token!),
    enabled: enabledFlag && enabled && Boolean(orgId && token),
    staleTime: 15_000,
  })
}

export function useBroadcastTargets() {
  const { orgId, token, enabled } = useMessaging()
  return useQuery({
    queryKey: ['messaging', orgId ?? 0, 'broadcast-targets'],
    queryFn: () => getBroadcastTargets(orgId!, token!),
    enabled: enabled && Boolean(orgId && token),
    staleTime: 5 * 60_000,
  })
}

export type OrgCourse = {
  course_uuid: string
  name: string
  description?: string
  thumbnail_image?: string
  published?: boolean
}

export function useOrgCourses(orgslug: string, enabledFlag = true) {
  const { token } = useMessaging()
  return useQuery({
    queryKey: ['messaging', 'org-courses', orgslug],
    queryFn: async () => {
      const res = await getOrgCourses(orgslug, null, token)
      const list = Array.isArray(res) ? res : res?.courses || res?.data || []
      return list as OrgCourse[]
    },
    enabled: enabledFlag && Boolean(orgslug && token),
    staleTime: 5 * 60_000,
  })
}
