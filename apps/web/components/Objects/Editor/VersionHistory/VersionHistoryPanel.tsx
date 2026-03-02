'use client'
import React from 'react'
import { X, Clock, User, RotateCcw, Eye, Loader2 } from 'lucide-react'
import { useActivityVersions, ActivityVersion } from '@components/Hooks/useActivityVersioning'
import { restoreActivityVersion } from '@services/courses/activities'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { toast } from 'react-hot-toast'
import { motion, AnimatePresence } from 'motion/react'
import EditorPreview from '../EditorPreview'
import { CourseProvider } from '@components/Contexts/CourseContext'
import { useTranslation } from 'react-i18next'

interface VersionHistoryPanelProps {
  isOpen: boolean
  onClose: () => void
  activityUuid: string
  currentVersion: number
  activity?: any
  courseUuid?: string
}

function VersionHistoryPanel({
  isOpen,
  onClose,
  activityUuid,
  currentVersion,
  activity,
  courseUuid,
}: VersionHistoryPanelProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const { versions, isLoading, error, mutate } = useActivityVersions(activityUuid)
  const [restoringVersion, setRestoringVersion] = React.useState<number | null>(null)
  const [previewVersion, setPreviewVersion] = React.useState<ActivityVersion | null>(null)

  const formatDate = (dateString: string): string => {
    try {
      const date = new Date(dateString)
      const now = new Date()
      const diffMs = now.getTime() - date.getTime()
      const diffMins = Math.floor(diffMs / 60000)
      const diffHours = Math.floor(diffMs / 3600000)
      const diffDays = Math.floor(diffMs / 86400000)

      if (diffMins < 1) return t('editor.versioning.just_now')
      if (diffMins < 60) return t('editor.versioning.minutes_ago', { count: diffMins })
      if (diffHours < 24) return t('editor.versioning.hours_ago', { count: diffHours })
      if (diffDays < 7) return t('editor.versioning.days_ago', { count: diffDays })

      return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
      })
    } catch {
      return dateString
    }
  }

  const handleRestore = async (version: ActivityVersion) => {
    if (!access_token) return

    setRestoringVersion(version.version_number)
    try {
      const result = await restoreActivityVersion(
        activityUuid,
        version.version_number,
        access_token
      )

      if (result.success) {
        toast.success(t('editor.versioning.restored_success', { number: version.version_number }))
        // Refresh the page to load the restored version
        window.location.reload()
      } else {
        toast.error(t('editor.versioning.restore_failed'))
      }
    } catch (error) {
      toast.error(t('editor.versioning.restore_failed'))
      console.error('Error restoring version:', error)
    } finally {
      setRestoringVersion(null)
    }
  }

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[200]"
        onClick={onClose}
      >
        <motion.div
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="absolute right-0 top-0 h-full w-96 bg-white shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <Clock size={20} className="text-gray-600" />
              <h2 className="font-semibold text-gray-900">
                {t('editor.versioning.version_history')}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="p-1 hover:bg-gray-100 rounded-md transition-colors"
            >
              <X size={20} className="text-gray-500" />
            </button>
          </div>

          {/* Current Version Info */}
          <div className="px-4 py-3 bg-sky-50 border-b border-sky-100">
            <p className="text-sm text-sky-700">
              <span className="font-medium">{t('editor.versioning.current_version')}</span> v{currentVersion}
            </p>
            <p className="text-xs text-sky-600 mt-1">
              {t('editor.versioning.versions_info')}
            </p>
          </div>

          {/* Version List */}
          <div className="overflow-y-auto h-[calc(100%-140px)]">
            {isLoading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={24} className="animate-spin text-gray-400" />
              </div>
            )}

            {error && (
              <div className="p-4 text-center text-red-600">
                {t('editor.versioning.failed_load_history')}
              </div>
            )}

            {!isLoading && versions.length === 0 && (
              <div className="p-4 text-center text-gray-500">
                <Clock size={32} className="mx-auto mb-2 text-gray-300" />
                <p className="text-sm">{t('editor.versioning.no_history')}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {t('editor.versioning.versions_created_on_save')}
                </p>
              </div>
            )}

            {versions.map((version, index) => (
              <div
                key={version.id}
                className={`p-4 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                  version.version_number === currentVersion - 1 ? 'bg-amber-50' : ''
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">
                        {t('editor.versioning.version', { number: version.version_number })}
                      </span>
                      {index === 0 && (
                        <span className="px-1.5 py-0.5 text-xs bg-sky-100 text-sky-700 rounded">
                          {t('editor.versioning.previous')}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                      <Clock size={12} />
                      <span>{formatDate(version.created_at)}</span>
                    </div>
                    {version.created_by_username && (
                      <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                        <User size={12} />
                        <span>{version.created_by_username}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPreviewVersion(version)}
                      className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
                      title={t('editor.versioning.preview')}
                    >
                      <Eye size={16} />
                    </button>
                    <button
                      onClick={() => handleRestore(version)}
                      disabled={restoringVersion !== null}
                      className="p-1.5 text-gray-400 hover:text-sky-600 hover:bg-sky-50 rounded-md transition-colors disabled:opacity-50"
                      title={t('editor.versioning.restore_version')}
                    >
                      {restoringVersion === version.version_number ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <RotateCcw size={16} />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Preview Modal */}
          {previewVersion && (
            <VersionPreviewModal
              version={previewVersion}
              onClose={() => setPreviewVersion(null)}
              onRestore={() => {
                handleRestore(previewVersion)
                setPreviewVersion(null)
              }}
              activity={activity}
              courseUuid={courseUuid}
            />
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

interface VersionPreviewModalProps {
  version: ActivityVersion
  onClose: () => void
  onRestore: () => void
  activity?: any
  courseUuid?: string
}

function VersionPreviewModal({ version, onClose, onRestore, activity, courseUuid }: VersionPreviewModalProps) {
  const { t } = useTranslation()

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4" style={{ zIndex: 210 }}>
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[85vh] overflow-hidden"
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gradient-to-r from-sky-50 to-indigo-50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-sky-100 rounded-lg">
              <Clock size={20} className="text-sky-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">
                {t('editor.versioning.version', { number: version.version_number })}
              </h3>
              {version.created_by_username && (
                <p className="text-sm text-gray-500">
                  {t('editor.versioning.by_author', { author: version.created_by_username })}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X size={20} className="text-gray-500" />
          </button>
        </div>
        <div className="p-4 overflow-y-auto max-h-[60vh] bg-gray-50">
          <div className="bg-white rounded-lg border border-gray-200 p-4 min-h-[200px]">
            {courseUuid ? (
              <CourseProvider courseuuid={courseUuid}>
                <EditorPreview content={version.content} activity={activity} />
              </CourseProvider>
            ) : (
              <EditorPreview content={version.content} activity={activity} />
            )}
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 p-4 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
          >
            {t('editor.versioning.close')}
          </button>
          <button
            onClick={onRestore}
            className="px-5 py-2 text-sm font-medium text-white bg-sky-600 hover:bg-sky-700 rounded-lg transition-colors flex items-center gap-2"
          >
            <RotateCcw size={16} />
            {t('editor.versioning.restore_version')}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

export default VersionHistoryPanel
