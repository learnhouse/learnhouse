'use client'
import { getAPIUrl } from '@services/config/config'
import { swrFetcher } from '@services/utils/ts/requests'
import useSWR from 'swr'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useCallback, useRef, useState } from 'react'

export interface ActivityVersion {
  id: number
  activity_id: number
  org_id: number
  version_number: number
  content: any
  created_by_id: number | null
  created_at: string
  created_by_username: string | null
  created_by_avatar: string | null
}

export interface ActivityState {
  activity_uuid: string
  update_date: string
  current_version: number
  last_modified_by_id: number | null
  last_modified_by_username: string | null
}

/**
 * Hook to fetch activity version history
 */
export function useActivityVersions(activityUuid: string, limit: number = 20) {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const { data: versions, error, isLoading, mutate } = useSWR<ActivityVersion[]>(
    activityUuid && access_token
      ? `${getAPIUrl()}activities/${activityUuid}/versions?limit=${limit}`
      : null,
    (url: string) => swrFetcher(url, access_token),
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    }
  )

  return {
    versions: versions || [],
    error,
    isLoading,
    mutate,
  }
}

/**
 * Hook to fetch remote activity state for conflict detection
 */
export function useActivityState(activityUuid: string, enabled: boolean = true) {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const { data: state, error, isLoading, mutate } = useSWR<ActivityState>(
    enabled && activityUuid && access_token
      ? `${getAPIUrl()}activities/${activityUuid}/state`
      : null,
    (url: string) => swrFetcher(url, access_token),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 2000,
      refreshInterval: 0, // Manual refresh only
    }
  )

  const refresh = useCallback(() => {
    return mutate()
  }, [mutate])

  return {
    state,
    error,
    isLoading,
    refresh,
  }
}

export interface ConflictInfo {
  hasConflict: boolean
  remoteVersion: number
  localVersion: number
  lastModifiedBy: string | null
  lastModifiedAt: string | null
}

/**
 * Hook for conflict detection between local and remote activity state
 */
export function useActivityConflictDetection(
  activityUuid: string,
  localVersion: number,
  localUpdateDate: string
) {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const [isChecking, setIsChecking] = useState(false)
  const [conflictInfo, setConflictInfo] = useState<ConflictInfo | null>(null)
  const lastCheckRef = useRef<number>(0)

  const checkForConflicts = useCallback(async (): Promise<ConflictInfo | null> => {
    // Debounce checks - don't check more than once per second
    const now = Date.now()
    if (now - lastCheckRef.current < 1000) {
      return conflictInfo
    }
    lastCheckRef.current = now

    if (!activityUuid || !access_token) {
      return null
    }

    setIsChecking(true)
    try {
      const response = await fetch(
        `${getAPIUrl()}activities/${activityUuid}/state`,
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${access_token}`,
          },
        }
      )

      if (!response.ok) {
        throw new Error('Failed to fetch activity state')
      }

      const remoteState: ActivityState = await response.json()

      // Check if remote version is newer than local version
      const hasConflict = remoteState.current_version > localVersion

      const info: ConflictInfo = {
        hasConflict,
        remoteVersion: remoteState.current_version,
        localVersion,
        lastModifiedBy: remoteState.last_modified_by_username,
        lastModifiedAt: remoteState.update_date,
      }

      setConflictInfo(info)
      return info
    } catch (error) {
      console.error('Error checking for conflicts:', error)
      return null
    } finally {
      setIsChecking(false)
    }
  }, [activityUuid, access_token, localVersion, conflictInfo])

  const clearConflict = useCallback(() => {
    setConflictInfo(null)
  }, [])

  return {
    conflictInfo,
    isChecking,
    checkForConflicts,
    clearConflict,
  }
}
