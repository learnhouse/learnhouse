'use client'
import React from 'react'
import { Draggable, Droppable } from '@hello-pangea/dnd'
import { FileVideo, FileText, Image, Music, GripVertical } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { UploadedFileInfo } from '@services/courses/migration'

function getFileIcon(ext: string) {
  if (['mp4', 'webm', 'mov'].includes(ext))
    return <FileVideo size={14} className="text-blue-500" />
  if (['pdf'].includes(ext))
    return <FileText size={14} className="text-red-500" />
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext))
    return <Image size={14} className="text-green-500" />
  if (['mp3', 'wav'].includes(ext))
    return <Music size={14} className="text-purple-500" />
  return <FileText size={14} className="text-gray-500" />
}

interface MigrationFileListProps {
  files: UploadedFileInfo[]
  assignedFileIds: Set<string>
}

export default function MigrationFileList({
  files,
  assignedFileIds,
}: MigrationFileListProps) {
  const { t } = useTranslation()
  const unassigned = files.filter((f) => !assignedFileIds.has(f.file_id))

  return (
    <div className="bg-white rounded-xl nice-shadow p-4 h-full">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">
        {t('migration.unassigned_files')} ({unassigned.length})
      </h3>
      <Droppable droppableId="unassigned-files" type="FILE">
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`space-y-1 min-h-[100px] rounded-lg p-2 transition-colors ${
              snapshot.isDraggingOver ? 'bg-gray-50' : ''
            }`}
          >
            {unassigned.map((file, index) => (
              <Draggable
                key={file.file_id}
                draggableId={`file-${file.file_id}`}
                index={index}
              >
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    {...provided.dragHandleProps}
                    className={`flex items-center space-x-2 px-2 py-1.5 rounded-md text-sm ${
                      snapshot.isDragging
                        ? 'bg-blue-50 shadow-md'
                        : 'hover:bg-gray-50'
                    }`}
                  >
                    <GripVertical size={12} className="text-gray-300" />
                    {getFileIcon(file.extension)}
                    <span className="truncate text-gray-700">
                      {file.filename}
                    </span>
                  </div>
                )}
              </Draggable>
            ))}
            {provided.placeholder}
            {unassigned.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-4">
                {t('migration.all_files_assigned')}
              </p>
            )}
          </div>
        )}
      </Droppable>
    </div>
  )
}
