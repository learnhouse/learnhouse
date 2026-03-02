'use client'
import React from 'react'
import { X, Clock, User, GitMerge, Check } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import EditorPreview from '../EditorPreview'
import { CourseProvider } from '@components/Contexts/CourseContext'
import { useTranslation } from 'react-i18next'

interface MergeConflictModalProps {
  isOpen: boolean
  onClose: () => void
  localContent: any
  remoteContent: any
  localVersion: number
  remoteVersion: number
  remoteAuthor: string | null
  onMergeComplete: (mergedContent: any) => void
  activity?: any
  courseUuid?: string
}

function MergeConflictModal({
  isOpen,
  onClose,
  localContent,
  remoteContent,
  localVersion,
  remoteVersion,
  remoteAuthor,
  onMergeComplete,
  activity,
  courseUuid,
}: MergeConflictModalProps) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = React.useState<'mine' | 'theirs'>('theirs')

  if (!isOpen) return null

  const handleKeepMine = () => {
    onMergeComplete(localContent)
  }

  const handleKeepTheirs = () => {
    onMergeComplete(remoteContent)
  }

  const handleKeepBoth = () => {
    // Merge both contents - append remote content after local content
    const mergedContent = {
      type: 'doc',
      content: [
        ...(localContent?.content || []),
        // Add a divider between the two versions
        {
          type: 'horizontalRule',
        },
        ...(remoteContent?.content || []),
      ],
    }
    onMergeComplete(mergedContent)
  }

  const renderPreview = (content: any) => {
    if (courseUuid) {
      return (
        <CourseProvider courseuuid={courseUuid}>
          <EditorPreview content={content} activity={activity} />
        </CourseProvider>
      )
    }
    return <EditorPreview content={content} activity={activity} />
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
        style={{ zIndex: 200 }}
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="bg-white rounded-xl shadow-2xl max-w-5xl w-full max-h-[85vh] overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gradient-to-r from-amber-50 to-orange-50">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-100 rounded-lg">
                <GitMerge size={20} className="text-amber-600" />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900">
                  {t('editor.versioning.conflict.title')}
                </h2>
                <p className="text-sm text-gray-500">
                  {t('editor.versioning.conflict.choose_version')}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X size={20} className="text-gray-500" />
            </button>
          </div>

          {/* Tab Navigation */}
          <div className="flex border-b border-gray-200">
            <button
              onClick={() => setActiveTab('mine')}
              className={`flex-1 px-4 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                activeTab === 'mine'
                  ? 'text-sky-600 border-b-2 border-sky-600 bg-sky-50'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              <User size={16} />
              {t('editor.versioning.conflict.your_version')} (v{localVersion})
            </button>
            <button
              onClick={() => setActiveTab('theirs')}
              className={`flex-1 px-4 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                activeTab === 'theirs'
                  ? 'text-sky-600 border-b-2 border-sky-600 bg-sky-50'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              <Clock size={16} />
              {remoteAuthor
                ? t('editor.versioning.conflict.author_version', { author: remoteAuthor })
                : t('editor.versioning.conflict.their_version')
              } (v{remoteVersion})
            </button>
          </div>

          {/* Preview Content */}
          <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
            <div className="bg-white rounded-lg border border-gray-200 p-4 min-h-[200px]">
              {activeTab === 'mine'
                ? renderPreview(localContent)
                : renderPreview(remoteContent)
              }
            </div>
          </div>

          {/* Footer with Actions */}
          <div className="flex items-center justify-between p-4 border-t border-gray-200 bg-gray-50">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              {t('editor.versioning.close')}
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={handleKeepBoth}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg transition-colors flex items-center gap-2"
              >
                <GitMerge size={16} />
                {t('editor.versioning.conflict.keep_both')}
              </button>
              <button
                onClick={handleKeepTheirs}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg transition-colors flex items-center gap-2"
              >
                <Clock size={16} />
                {t('editor.versioning.conflict.keep_theirs')}
              </button>
              <button
                onClick={handleKeepMine}
                className="px-4 py-2 text-sm font-medium text-white bg-sky-600 hover:bg-sky-700 rounded-lg transition-colors flex items-center gap-2"
              >
                <Check size={16} />
                {t('editor.versioning.conflict.keep_mine')}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

export default MergeConflictModal
