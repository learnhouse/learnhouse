'use client'
import React, { useCallback, useState } from 'react'
import { Upload, FileVideo, FileText, Image, Music, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

const ACCEPTED_EXTENSIONS = [
  'mp4', 'webm', 'mov', 'pdf', 'png', 'jpg', 'jpeg', 'webp', 'mp3', 'wav',
]

const ACCEPT_STRING = '.mp4,.webm,.mov,.pdf,.png,.jpg,.jpeg,.webp,.mp3,.wav'

interface MigrationDropZoneProps {
  files: File[]
  onFilesChange: (files: File[]) => void
  uploading: boolean
}

function getFileIcon(ext: string) {
  if (['mp4', 'webm', 'mov'].includes(ext))
    return <FileVideo size={16} className="text-blue-500" />
  if (['pdf'].includes(ext))
    return <FileText size={16} className="text-red-500" />
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext))
    return <Image size={16} className="text-green-500" />
  if (['mp3', 'wav'].includes(ext))
    return <Music size={16} className="text-purple-500" />
  return <FileText size={16} className="text-gray-500" />
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function MigrationDropZone({
  files,
  onFilesChange,
  uploading,
}: MigrationDropZoneProps) {
  const { t } = useTranslation()
  const [isDragging, setIsDragging] = useState(false)

  const handleFiles = useCallback(
    (newFiles: FileList | File[]) => {
      const valid = Array.from(newFiles).filter((f) => {
        const ext = f.name.split('.').pop()?.toLowerCase() || ''
        return ACCEPTED_EXTENSIONS.includes(ext)
      })
      onFilesChange([...files, ...valid])
    },
    [files, onFilesChange]
  )

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files)
    }
  }

  const removeFile = (index: number) => {
    const updated = files.filter((_, i) => i !== index)
    onFilesChange(updated)
  }

  return (
    <div className="space-y-4">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() =>
          document.getElementById('migration-file-input')?.click()
        }
        className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-200 ${
          isDragging
            ? 'border-black bg-gray-50 scale-[1.02]'
            : files.length > 0
              ? 'border-green-300 bg-green-50'
              : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
        } ${uploading ? 'pointer-events-none opacity-50' : ''}`}
      >
        <input
          id="migration-file-input"
          type="file"
          multiple
          accept={ACCEPT_STRING}
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
          className="hidden"
        />
        <div className="flex flex-col items-center space-y-3">
          {files.length > 0 ? (
            <>
              <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
                <Upload size={28} className="text-green-600" />
              </div>
              <div className="space-y-1">
                <p className="font-semibold text-gray-900">
                  {files.length} {files.length === 1 ? 'file' : 'files'} selected
                </p>
                <p className="text-sm text-gray-500">
                  {formatFileSize(files.reduce((sum, f) => sum + f.size, 0))} total
                </p>
                <p className="text-xs text-green-600 font-medium">
                  {t('migration.click_to_add_more')}
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center">
                <Upload size={28} className="text-gray-400" />
              </div>
              <div className="space-y-1">
                <p className="font-medium text-gray-700">
                  {t('migration.drop_files')}
                </p>
                <p className="text-sm text-gray-400">
                  {t('migration.accepted_formats')}
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {files.length > 0 && (
        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          {files.map((file, index) => {
            const ext = file.name.split('.').pop()?.toLowerCase() || ''
            return (
              <div
                key={`${file.name}-${index}`}
                className="flex items-center justify-between rounded-lg px-3 py-2 bg-gray-50 hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center space-x-2.5 min-w-0">
                  {getFileIcon(ext)}
                  <span className="text-sm text-gray-700 truncate">
                    {file.name}
                  </span>
                  <span className="text-xs text-gray-400 flex-shrink-0">
                    {formatFileSize(file.size)}
                  </span>
                </div>
                {!uploading && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      removeFile(index)
                    }}
                    className="text-gray-300 hover:text-red-500 flex-shrink-0 ml-2 transition-colors"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
