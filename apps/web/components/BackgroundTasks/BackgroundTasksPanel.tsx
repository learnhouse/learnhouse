'use client'
import React, { useState } from 'react'
import {
  CaretDown,
  CheckCircle,
  CircleNotch,
  Warning,
  X,
  UploadSimple,
} from '@phosphor-icons/react'
import { useBackgroundTasks, type BgTask } from '@components/Contexts/BackgroundTasksContext'

function StatusIcon({ status }: { status: BgTask['status'] }) {
  if (status === 'done') return <CheckCircle size={16} weight="fill" className="text-green-500" />
  if (status === 'error' || status === 'interrupted')
    return <Warning size={16} weight="fill" className="text-red-500" />
  if (status === 'processing')
    return <CircleNotch size={16} className="text-violet-500 animate-spin" />
  return <UploadSimple size={16} className="text-violet-500" />
}

function TaskRow({ task, onDismiss }: { task: BgTask; onDismiss: (_id: string) => void }) {
  const active = task.status === 'uploading' || task.status === 'processing'
  const body = (
    <div className="flex items-start gap-2.5 py-2 px-3">
      <div className="mt-0.5 shrink-0">
        <StatusIcon status={task.status} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-gray-800">{task.title}</span>
          {task.status === 'uploading' && !task.indeterminate && (
            <span className="shrink-0 text-[11px] tabular-nums text-gray-400">
              {Math.round(task.progress)}%
            </span>
          )}
        </div>
        {(task.subtitle || task.error) && (
          <p
            className={`truncate text-xs ${task.error ? 'text-red-500' : 'text-gray-400'}`}
          >
            {task.error || task.subtitle}
          </p>
        )}
        {active && (
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className={`h-full rounded-full bg-violet-500 transition-[width] duration-200 ${
                task.indeterminate || task.status === 'processing' ? 'animate-pulse w-1/3' : ''
              }`}
              style={
                task.indeterminate || task.status === 'processing'
                  ? undefined
                  : { width: `${Math.min(100, Math.max(0, task.progress))}%` }
              }
            />
          </div>
        )}
      </div>
      {!active && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onDismiss(task.id)
          }}
          className="shrink-0 text-gray-300 hover:text-gray-500"
          aria-label="Dismiss"
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
  return task.href ? (
    <a href={task.href} className="block hover:bg-gray-50 transition-colors">
      {body}
    </a>
  ) : (
    <div>{body}</div>
  )
}

/**
 * Global, persistent, expandable notification panel (top-right — sits above
 * page content, survives navigation and reloads). Generic: renders whatever
 * background tasks are registered via useBackgroundTasks().
 */
export default function BackgroundTasksPanel() {
  const { tasks, removeTask, clearFinished } = useBackgroundTasks()
  const [collapsed, setCollapsed] = useState(false)

  if (tasks.length === 0) return null

  const activeCount = tasks.filter(
    (t) => t.status === 'uploading' || t.status === 'processing'
  ).length

  return (
    <div className="fixed top-4 end-4 z-[9999] w-[320px] max-w-[calc(100vw-2rem)]">
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
        {/* Header */}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex w-full items-center justify-between gap-2 bg-gray-50 px-3 py-2 text-start"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-gray-700">
            {activeCount > 0 ? (
              <CircleNotch size={16} className="text-violet-500 animate-spin" />
            ) : (
              <CheckCircle size={16} weight="fill" className="text-green-500" />
            )}
            {activeCount > 0 ? `${activeCount} in progress` : 'Tasks'}
          </span>
          <span className="flex items-center gap-1">
            {activeCount === 0 && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation()
                  clearFinished()
                }}
                className="me-1 cursor-pointer text-[11px] font-medium text-gray-400 hover:text-gray-600"
              >
                Clear
              </span>
            )}
            <CaretDown
              size={16}
              className={`text-gray-400 transition-transform ${collapsed ? '-rotate-90' : ''}`}
            />
          </span>
        </button>

        {/* List */}
        {!collapsed && (
          <div className="max-h-[50vh] divide-y divide-gray-100 overflow-y-auto">
            {tasks.map((t) => (
              <TaskRow key={t.id} task={t} onDismiss={removeTask} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
