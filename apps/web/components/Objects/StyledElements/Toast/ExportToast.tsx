'use client'
import React from 'react'
import toast from 'react-hot-toast'
import { Download, CheckCircle2, AlertCircle, Loader2, Package, FileArchive, FolderOpen, Layers, FileCheck } from 'lucide-react'

export type ExportStatus =
  | 'preparing'
  | 'collecting_metadata'
  | 'packaging_chapters'
  | 'packaging_activities'
  | 'packaging_files'
  | 'compressing'
  | 'downloading'
  | 'finalizing'
  | 'complete'
  | 'error'

export interface ExportToastProps {
  status: ExportStatus
  progress: number
  courseName?: string
  courseCount?: number
  type: 'single' | 'batch'
  error?: string
}

const statusConfig: Record<ExportStatus, { icon: React.ReactNode; label: string; color: string }> = {
  preparing: {
    icon: <Loader2 className="w-5 h-5 animate-spin" />,
    label: 'Preparing export...',
    color: 'text-blue-500',
  },
  collecting_metadata: {
    icon: <FolderOpen className="w-5 h-5 animate-pulse" />,
    label: 'Collecting course metadata...',
    color: 'text-blue-500',
  },
  packaging_chapters: {
    icon: <Layers className="w-5 h-5 animate-pulse" />,
    label: 'Packaging chapters...',
    color: 'text-blue-500',
  },
  packaging_activities: {
    icon: <FileCheck className="w-5 h-5 animate-pulse" />,
    label: 'Packaging activities...',
    color: 'text-blue-500',
  },
  packaging_files: {
    icon: <Package className="w-5 h-5 animate-pulse" />,
    label: 'Packaging media files...',
    color: 'text-blue-500',
  },
  compressing: {
    icon: <FileArchive className="w-5 h-5 animate-pulse" />,
    label: 'Compressing archive...',
    color: 'text-indigo-500',
  },
  downloading: {
    icon: <Download className="w-5 h-5 animate-bounce" />,
    label: 'Downloading...',
    color: 'text-blue-500',
  },
  finalizing: {
    icon: <Loader2 className="w-5 h-5 animate-spin" />,
    label: 'Finalizing...',
    color: 'text-blue-500',
  },
  complete: {
    icon: <CheckCircle2 className="w-5 h-5" />,
    label: 'Export complete!',
    color: 'text-green-500',
  },
  error: {
    icon: <AlertCircle className="w-5 h-5" />,
    label: 'Export failed',
    color: 'text-red-500',
  },
}

function ExportToastContent({ status, progress, courseName, courseCount, type, error }: ExportToastProps) {
  const config = statusConfig[status]
  const isComplete = status === 'complete'
  const isError = status === 'error'
  const showProgress = !isComplete && !isError && progress > 0

  const getTitle = () => {
    if (type === 'batch') {
      if (isComplete) return `${courseCount} courses exported`
      if (isError) return 'Batch export failed'
      return `Exporting ${courseCount} courses`
    }
    if (isComplete) return `"${courseName}" exported`
    if (isError) return `Export failed`
    return `Exporting "${courseName}"`
  }

  const getProgressColor = () => {
    if (isError) return 'bg-red-500'
    if (isComplete) return 'bg-green-500'
    return 'bg-blue-500'
  }

  return (
    <div className="bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden min-w-[320px] max-w-[400px]">
      {/* Progress bar at top */}
      <div className="h-1 bg-gray-100 relative overflow-hidden">
        <div
          className={`h-full transition-all duration-300 ease-out ${getProgressColor()}`}
          style={{ width: `${isComplete ? 100 : progress}%` }}
        />
        {!isComplete && !isError && (
          <div
            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-shimmer"
            style={{
              animation: 'shimmer 1.5s infinite',
            }}
          />
        )}
      </div>

      <div className="p-4">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className={`flex-shrink-0 ${config.color}`}>
            {config.icon}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">
              {getTitle()}
            </p>
            <p className={`text-xs mt-0.5 ${isError ? 'text-red-600' : 'text-gray-500'}`}>
              {isError ? (error || 'An error occurred during export') : config.label}
            </p>
          </div>
          {showProgress && (
            <span className="flex-shrink-0 text-xs font-medium text-gray-400 tabular-nums">
              {Math.round(progress)}%
            </span>
          )}
        </div>

        {/* Stage indicators for non-error states */}
        {!isError && !isComplete && (
          <div className="mt-3 flex items-center gap-1">
            {['preparing', 'collecting_metadata', 'packaging_chapters', 'packaging_activities', 'packaging_files', 'compressing', 'downloading', 'finalizing'].map((stage, index) => {
              const stages = ['preparing', 'collecting_metadata', 'packaging_chapters', 'packaging_activities', 'packaging_files', 'compressing', 'downloading', 'finalizing']
              const currentIndex = stages.indexOf(status)
              const isActive = index === currentIndex
              const isPast = index < currentIndex

              return (
                <div
                  key={stage}
                  className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                    isPast ? 'bg-blue-500' : isActive ? 'bg-blue-400 animate-pulse' : 'bg-gray-200'
                  }`}
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// Toast manager for exports
class ExportToastManager {
  private toastId: string | null = null

  start(type: 'single' | 'batch', courseName?: string, courseCount?: number): string {
    this.toastId = toast.custom(
      (t) => (
        <div className={`${t.visible ? 'animate-enter' : 'animate-leave'}`}>
          <ExportToastContent
            status="preparing"
            progress={0}
            type={type}
            courseName={courseName}
            courseCount={courseCount}
          />
        </div>
      ),
      {
        duration: Infinity,
        position: 'bottom-center',
      }
    )
    return this.toastId
  }

  update(toastId: string, status: ExportStatus, progress: number, courseName?: string, courseCount?: number, type: 'single' | 'batch' = 'single') {
    toast.custom(
      (t) => (
        <div className={`${t.visible ? 'animate-enter' : 'animate-leave'}`}>
          <ExportToastContent
            status={status}
            progress={progress}
            type={type}
            courseName={courseName}
            courseCount={courseCount}
          />
        </div>
      ),
      {
        id: toastId,
        duration: Infinity,
        position: 'bottom-center',
      }
    )
  }

  complete(toastId: string, courseName?: string, courseCount?: number, type: 'single' | 'batch' = 'single') {
    toast.custom(
      (t) => (
        <div className={`${t.visible ? 'animate-enter' : 'animate-leave'}`}>
          <ExportToastContent
            status="complete"
            progress={100}
            type={type}
            courseName={courseName}
            courseCount={courseCount}
          />
        </div>
      ),
      {
        id: toastId,
        duration: 3000,
        position: 'bottom-center',
      }
    )
  }

  error(toastId: string, errorMessage: string, courseName?: string, courseCount?: number, type: 'single' | 'batch' = 'single') {
    toast.custom(
      (t) => (
        <div className={`${t.visible ? 'animate-enter' : 'animate-leave'}`}>
          <ExportToastContent
            status="error"
            progress={0}
            type={type}
            courseName={courseName}
            courseCount={courseCount}
            error={errorMessage}
          />
        </div>
      ),
      {
        id: toastId,
        duration: 5000,
        position: 'bottom-center',
      }
    )
  }
}

export const exportToast = new ExportToastManager()

export default ExportToastContent
