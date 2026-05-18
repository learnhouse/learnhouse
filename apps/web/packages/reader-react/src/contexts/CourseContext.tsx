'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { CourseStructure } from '../types/activity'

/**
 * The minimal shape every consumer of `CourseContext` relies on.
 * The web app extends this with edit-tracking fields (pendingChanges,
 * isSaving, etc.) but anything inside the reader package treats those as
 * optional and never writes to them.
 */
export interface CourseState {
  courseStructure: CourseStructure | any
  courseOrder?: any
  pendingChanges?: Partial<any>
  unsyncedChanges?: Partial<any>
  isSaved?: boolean
  isLoading?: boolean
  isSaving?: boolean
  saveError?: string | null
  withUnpublishedActivities?: boolean
  lastSyncedAt?: number | null
}

// The dispatch type is intentionally `any` here — different consumers
// (the app's editor reducer vs. the reader's read-only stub) use richer
// discriminated unions for their actions. We expose the context object as
// the shared identity; each consumer narrows the type at its own boundary.
type AnyDispatch = (action: any) => void

export const CourseContext = createContext<CourseState | null>(null)
export const CourseDispatchContext = createContext<AnyDispatch | null>(null)

export function useCourse(): CourseState {
  const ctx = useContext(CourseContext)
  if (!ctx) {
    throw new Error('useCourse must be used within a CourseContext.Provider')
  }
  return ctx
}

export function useCourseDispatch(): AnyDispatch {
  const ctx = useContext(CourseDispatchContext)
  if (!ctx) {
    throw new Error(
      'useCourseDispatch must be used within a CourseDispatchContext.Provider',
    )
  }
  return ctx
}

/**
 * Read-only Course provider used by the reader. Wraps children with a
 * frozen minimal state so block extensions can resolve `courseStructure`
 * without dragging in the full app-side edit machinery.
 */
export function ReadOnlyCourseProvider({
  children,
  course,
}: {
  children: ReactNode
  course: CourseStructure | any
}) {
  const state: CourseState = {
    courseStructure: course,
    courseOrder: null,
    pendingChanges: {},
    unsyncedChanges: {},
    isSaved: true,
    isLoading: false,
    isSaving: false,
    saveError: null,
    withUnpublishedActivities: false,
    lastSyncedAt: null,
  }

  return (
    <CourseContext.Provider value={state}>
      <CourseDispatchContext.Provider value={noopDispatch}>
        {children}
      </CourseDispatchContext.Provider>
    </CourseContext.Provider>
  )
}

const noopDispatch: AnyDispatch = () => {}
