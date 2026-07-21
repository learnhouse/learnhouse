'use client'
import React from 'react'

// Cross-subtree registry that lets the single "Submit for grading" button
// flush every task editor's unsaved answers before the server finalizes.
//
// The task editors (TaskQuizObject, TaskFormObject, …) and the submit button
// (AssignmentTools) render in DISJOINT provider subtrees, so the button has no
// context path to the editors' in-memory answers. Without this bridge, a
// learner who selects answers and clicks Submit without first clicking Save
// submits an empty answer sheet and is silently auto-graded 0%.
//
// Each student task editor registers a { getIsDirty, flush } entry keyed by its
// task UUID. On submit, flushAll() persists every dirty task and reports whether
// they all succeeded, so the caller can abort finalization if any save failed.

type TaskEntry = {
  getIsDirty: () => boolean
  flush: () => Promise<boolean>
}

type DirtyTasksAPI = {
  register: (_taskUUID: string, _entry: TaskEntry) => void
  unregister: (_taskUUID: string) => void
  flushAll: () => Promise<boolean>
}

// Default no-op so editors rendered outside a provider (teacher/grading
// dashboards) keep working without a registry.
const noop: DirtyTasksAPI = {
  register: () => {},
  unregister: () => {},
  flushAll: async () => true,
}

const AssignmentDirtyTasksContext = React.createContext<DirtyTasksAPI>(noop)

export function AssignmentDirtyTasksProvider({ children }: { children: React.ReactNode }) {
  const registry = React.useRef<Map<string, TaskEntry>>(new Map())

  const api = React.useMemo<DirtyTasksAPI>(
    () => ({
      register: (taskUUID, entry) => {
        registry.current.set(taskUUID, entry)
      },
      unregister: (taskUUID) => {
        registry.current.delete(taskUUID)
      },
      flushAll: async () => {
        const dirty = Array.from(registry.current.values()).filter((e) => {
          try {
            return e.getIsDirty()
          } catch {
            return false
          }
        })
        if (dirty.length === 0) return true
        const results = await Promise.all(
          dirty.map(async (e) => {
            try {
              return await e.flush()
            } catch {
              return false
            }
          })
        )
        return results.every(Boolean)
      },
    }),
    []
  )

  return (
    <AssignmentDirtyTasksContext.Provider value={api}>
      {children}
    </AssignmentDirtyTasksContext.Provider>
  )
}

export function useAssignmentDirtyTasks() {
  return React.useContext(AssignmentDirtyTasksContext)
}
