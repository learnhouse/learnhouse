'use client'
import { getAPIUrl } from '@services/config/config'
import { swrFetcher } from '@services/utils/ts/requests'
import React, { createContext, useContext, useEffect, useReducer, useMemo, useCallback, useRef } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import { useLHSession } from '@components/Contexts/LHSessionContext'

// Unified cache key generator - use this everywhere
export const getCourseMetaCacheKey = (courseUuid: string, withUnpublishedActivities: boolean = false) =>
  withUnpublishedActivities
    ? `${getAPIUrl()}courses/${courseUuid}/meta?with_unpublished_activities=true`
    : `${getAPIUrl()}courses/${courseUuid}/meta?with_unpublished_activities=false&slim=true`

// Debounce manager for coordinating saves across components
class DebounceManager {
  private debounces: Map<string, NodeJS.Timeout> = new Map()
  private listeners: Set<() => void> = new Set()

  register(key: string, fn: () => void, delay: number) {
    this.cancel(key)
    const timer = setTimeout(() => {
      this.debounces.delete(key)
      fn()
    }, delay)
    this.debounces.set(key, timer)
  }

  cancel(key: string) {
    const timer = this.debounces.get(key)
    if (timer) {
      clearTimeout(timer)
      this.debounces.delete(key)
    }
  }

  cancelAll() {
    this.debounces.forEach(timer => clearTimeout(timer))
    this.debounces.clear()
  }

  hasPending(): boolean {
    return this.debounces.size > 0
  }

  // Subscribe to debounce state changes
  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

// Global debounce manager instance
const debounceManager = new DebounceManager()

export const useDebounceManager = () => debounceManager

// Types for better type safety
export interface CourseState {
  courseStructure: any
  courseOrder: any
  pendingChanges: Partial<any> // Track pending changes separately
  isSaved: boolean
  isLoading: boolean
  isSaving: boolean // New: track saving state
  saveError: string | null // New: track save errors
  withUnpublishedActivities: boolean
  lastSyncedAt: number | null // Timestamp of last server sync
}

export type CourseAction =
  | { type: 'setCourseStructure'; payload: any }
  | { type: 'setCourseOrder'; payload: any }
  | { type: 'updateField'; payload: { field: string; value: any } } // New: granular field update
  | { type: 'mergePendingChanges'; payload: Partial<any> } // New: merge pending changes
  | { type: 'setIsSaved' }
  | { type: 'setIsNotSaved' }
  | { type: 'setIsLoaded' }
  | { type: 'setSaving'; payload: boolean }
  | { type: 'setSaveError'; payload: string | null }
  | { type: 'commitChanges' } // New: commit pending changes to courseStructure
  | { type: 'rollbackChanges' } // New: discard pending changes
  | { type: 'syncFromServer'; payload: { data: any; timestamp: number } } // New: sync from server

export const CourseContext = createContext<CourseState | null>(null)
export const CourseDispatchContext = createContext<React.Dispatch<CourseAction> | null>(null)

export function CourseProvider({ children, courseuuid, withUnpublishedActivities = false }: any) {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const { cache, mutate } = useSWRConfig()
  const lastServerDataRef = useRef<any>(null)

  const swrKey = getCourseMetaCacheKey(courseuuid, withUnpublishedActivities)

  // Get cached data synchronously to prevent flickering on navigation
  const cachedData = useMemo(() => {
    const cached = cache.get(swrKey)
    return cached?.data
  }, [cache, swrKey])

  const { data: courseStructureData, error, isValidating } = useSWR(
    swrKey,
    url => swrFetcher(url, access_token),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 10000, // Increased to reduce refetches during editing
      keepPreviousData: true,
      revalidateIfStale: false, // Don't auto-revalidate stale data while editing
    }
  )

  // Use cached data or fetched data
  const effectiveData = courseStructureData || cachedData

  const initialState: CourseState = useMemo(() => ({
    courseStructure: effectiveData || { course_uuid: courseuuid },
    courseOrder: {},
    pendingChanges: {},
    isSaved: true,
    isLoading: !effectiveData,
    isSaving: false,
    saveError: null,
    withUnpublishedActivities: withUnpublishedActivities,
    lastSyncedAt: effectiveData ? Date.now() : null,
  }), [courseuuid, effectiveData, withUnpublishedActivities])

  const [state, dispatch] = useReducer(courseReducer, initialState)

  // Track server data changes
  useEffect(() => {
    if (courseStructureData && !state.isSaving) {
      // Only sync from server if we're not currently saving
      // and the data is actually different from what we have
      const serverDataStr = JSON.stringify(courseStructureData)
      const lastServerDataStr = JSON.stringify(lastServerDataRef.current)

      if (serverDataStr !== lastServerDataStr) {
        lastServerDataRef.current = courseStructureData

        // If we have unsaved changes, don't overwrite them
        if (state.isSaved) {
          dispatch({
            type: 'syncFromServer',
            payload: { data: courseStructureData, timestamp: Date.now() }
          })
        }
      }
    }
  }, [courseStructureData, state.isSaving, state.isSaved])

  // Initial load
  useEffect(() => {
    if (effectiveData && state.isLoading) {
      dispatch({ type: 'setCourseStructure', payload: effectiveData })
      dispatch({ type: 'setIsLoaded' })
      lastServerDataRef.current = effectiveData
    }
  }, [effectiveData, state.isLoading])

  if (error) return <div>Failed to load course structure</div>
  if (!effectiveData) return ''

  return (
    <CourseContext.Provider value={state}>
      <CourseDispatchContext.Provider value={dispatch}>
        {children}
      </CourseDispatchContext.Provider>
    </CourseContext.Provider>
  )
}

export function useCourse() {
  const context = useContext(CourseContext)
  if (!context) {
    throw new Error('useCourse must be used within a CourseProvider')
  }
  return context
}

export function useCourseDispatch() {
  const context = useContext(CourseDispatchContext)
  if (!context) {
    throw new Error('useCourseDispatch must be used within a CourseProvider')
  }
  return context
}

// Custom hook for form components to sync changes safely
export function useCourseFieldSync(componentId: string) {
  const dispatch = useCourseDispatch()
  const course = useCourse()
  const debounce = useDebounceManager()

  const syncChanges = useCallback((changes: Partial<any>, immediate: boolean = false) => {
    const doSync = () => {
      dispatch({ type: 'setIsNotSaved' })
      dispatch({ type: 'mergePendingChanges', payload: changes })
    }

    if (immediate) {
      debounce.cancel(componentId)
      doSync()
    } else {
      debounce.register(componentId, doSync, 500)
    }
  }, [dispatch, componentId, debounce])

  const cancelPendingSync = useCallback(() => {
    debounce.cancel(componentId)
  }, [componentId, debounce])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      debounce.cancel(componentId)
    }
  }, [componentId, debounce])

  return {
    syncChanges,
    cancelPendingSync,
    courseStructure: course.courseStructure,
    pendingChanges: course.pendingChanges,
    isLoading: course.isLoading,
    isSaved: course.isSaved,
    isSaving: course.isSaving,
  }
}

function courseReducer(state: CourseState, action: CourseAction): CourseState {
  switch (action.type) {
    case 'setCourseStructure':
      return {
        ...state,
        courseStructure: action.payload,
        pendingChanges: {}, // Clear pending changes when structure is set
      }

    case 'setCourseOrder':
      return { ...state, courseOrder: action.payload }

    case 'updateField':
      return {
        ...state,
        courseStructure: {
          ...state.courseStructure,
          [action.payload.field]: action.payload.value,
        },
        isSaved: false,
      }

    case 'mergePendingChanges':
      // Merge new changes with existing pending changes and courseStructure
      const mergedStructure = {
        ...state.courseStructure,
        ...state.pendingChanges,
        ...action.payload,
      }
      return {
        ...state,
        courseStructure: mergedStructure,
        pendingChanges: {
          ...state.pendingChanges,
          ...action.payload,
        },
      }

    case 'commitChanges':
      // Commit pending changes to courseStructure
      return {
        ...state,
        courseStructure: {
          ...state.courseStructure,
          ...state.pendingChanges,
        },
        pendingChanges: {},
        isSaved: true,
      }

    case 'rollbackChanges':
      // Discard pending changes, revert to last synced state
      return {
        ...state,
        pendingChanges: {},
        isSaved: true,
      }

    case 'syncFromServer':
      // Sync from server, preserving pending changes if any
      if (Object.keys(state.pendingChanges).length > 0) {
        // Keep pending changes on top of server data
        return {
          ...state,
          courseStructure: {
            ...action.payload.data,
            ...state.pendingChanges,
          },
          lastSyncedAt: action.payload.timestamp,
        }
      }
      return {
        ...state,
        courseStructure: action.payload.data,
        lastSyncedAt: action.payload.timestamp,
      }

    case 'setIsSaved':
      return { ...state, isSaved: true, pendingChanges: {} }

    case 'setIsNotSaved':
      return { ...state, isSaved: false }

    case 'setIsLoaded':
      return { ...state, isLoading: false }

    case 'setSaving':
      return { ...state, isSaving: action.payload }

    case 'setSaveError':
      return { ...state, saveError: action.payload }

    default:
      throw new Error(`Unhandled action type: ${(action as any).type}`)
  }
}
