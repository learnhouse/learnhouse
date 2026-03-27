'use client'
import React, { useMemo } from 'react'
import {
  DragDropContext,
  Droppable,
  Draggable,
  DropResult,
} from '@hello-pangea/dnd'
import {
  Plus,
  Trash2,
  GripVertical,
  ChevronDown,
  ChevronRight,
  FileVideo,
  FileText,
  Image,
  Music,
  FolderOpen,
  X,
} from 'lucide-react'
import { Input } from '@components/ui/input'
import { useTranslation } from 'react-i18next'
import {
  MigrationTreeStructure,
  MigrationActivityNode,
  UploadedFileInfo,
} from '@services/courses/migration'
import MigrationFileList from './MigrationFileList'

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

const EXT_TO_ACTIVITY_TYPE: Record<
  string,
  { type: string; subType: string }
> = {
  mp4: { type: 'TYPE_VIDEO', subType: 'SUBTYPE_VIDEO_HOSTED' },
  webm: { type: 'TYPE_VIDEO', subType: 'SUBTYPE_VIDEO_HOSTED' },
  mov: { type: 'TYPE_VIDEO', subType: 'SUBTYPE_VIDEO_HOSTED' },
  pdf: { type: 'TYPE_DOCUMENT', subType: 'SUBTYPE_DOCUMENT_PDF' },
  png: { type: 'TYPE_DYNAMIC', subType: 'SUBTYPE_DYNAMIC_PAGE' },
  jpg: { type: 'TYPE_DYNAMIC', subType: 'SUBTYPE_DYNAMIC_PAGE' },
  jpeg: { type: 'TYPE_DYNAMIC', subType: 'SUBTYPE_DYNAMIC_PAGE' },
  webp: { type: 'TYPE_DYNAMIC', subType: 'SUBTYPE_DYNAMIC_PAGE' },
  mp3: { type: 'TYPE_DYNAMIC', subType: 'SUBTYPE_DYNAMIC_PAGE' },
  wav: { type: 'TYPE_DYNAMIC', subType: 'SUBTYPE_DYNAMIC_PAGE' },
}

interface MigrationTreeEditorProps {
  structure: MigrationTreeStructure
  onStructureChange: (structure: MigrationTreeStructure) => void
  files: UploadedFileInfo[]
}

export default function MigrationTreeEditor({
  structure,
  onStructureChange,
  files,
}: MigrationTreeEditorProps) {
  const { t } = useTranslation()
  const [expandedChapters, setExpandedChapters] = React.useState<Set<number>>(
    new Set(structure.chapters.map((_, i) => i))
  )

  const fileLookup = useMemo(() => {
    const map: Record<string, UploadedFileInfo> = {}
    for (const f of files) map[f.file_id] = f
    return map
  }, [files])

  const assignedFileIds = useMemo(() => {
    const ids = new Set<string>()
    for (const ch of structure.chapters) {
      for (const act of ch.activities) {
        for (const fid of act.file_ids) ids.add(fid)
      }
    }
    return ids
  }, [structure])

  const toggleChapter = (index: number) => {
    const next = new Set(expandedChapters)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    setExpandedChapters(next)
  }

  const updateChapterName = (chapterIndex: number, name: string) => {
    const chapters = [...structure.chapters]
    chapters[chapterIndex] = { ...chapters[chapterIndex], name }
    onStructureChange({ ...structure, chapters })
  }

  const updateActivityName = (
    chapterIndex: number,
    actIndex: number,
    name: string
  ) => {
    const chapters = [...structure.chapters]
    const activities = [...chapters[chapterIndex].activities]
    activities[actIndex] = { ...activities[actIndex], name }
    chapters[chapterIndex] = { ...chapters[chapterIndex], activities }
    onStructureChange({ ...structure, chapters })
  }

  const addChapter = () => {
    const chapters = [
      ...structure.chapters,
      { name: t('migration.new_chapter'), activities: [] },
    ]
    setExpandedChapters(
      new Set([...expandedChapters, chapters.length - 1])
    )
    onStructureChange({ ...structure, chapters })
  }

  const removeChapter = (index: number) => {
    const chapters = structure.chapters.filter((_, i) => i !== index)
    onStructureChange({ ...structure, chapters })
  }

  const addActivity = (chapterIndex: number) => {
    const chapters = [...structure.chapters]
    const activities = [
      ...chapters[chapterIndex].activities,
      {
        name: t('migration.new_activity'),
        activity_type: 'TYPE_DYNAMIC',
        activity_sub_type: 'SUBTYPE_DYNAMIC_PAGE',
        file_ids: [],
      } as MigrationActivityNode,
    ]
    chapters[chapterIndex] = { ...chapters[chapterIndex], activities }
    onStructureChange({ ...structure, chapters })
  }

  const removeActivity = (chapterIndex: number, actIndex: number) => {
    const chapters = [...structure.chapters]
    const activities = chapters[chapterIndex].activities.filter(
      (_, i) => i !== actIndex
    )
    chapters[chapterIndex] = { ...chapters[chapterIndex], activities }
    onStructureChange({ ...structure, chapters })
  }

  const removeFileFromActivity = (
    chapterIndex: number,
    actIndex: number,
    fileId: string
  ) => {
    const chapters = [...structure.chapters]
    const activities = [...chapters[chapterIndex].activities]
    activities[actIndex] = {
      ...activities[actIndex],
      file_ids: activities[actIndex].file_ids.filter((id) => id !== fileId),
    }
    chapters[chapterIndex] = { ...chapters[chapterIndex], activities }
    onStructureChange({ ...structure, chapters })
  }

  const onDragEnd = (result: DropResult) => {
    const { source, destination, draggableId, type } = result
    if (!destination) return

    if (type === 'FILE') {
      const fileId = draggableId.replace('file-', '')
      const chapters = [...structure.chapters]

      // Remove from source activity if applicable
      if (source.droppableId.startsWith('activity-')) {
        const parts = source.droppableId.split('-')
        const chI = parseInt(parts[1])
        const aI = parseInt(parts[2])
        const acts = [...chapters[chI].activities]
        acts[aI] = {
          ...acts[aI],
          file_ids: acts[aI].file_ids.filter((id) => id !== fileId),
        }
        chapters[chI] = { ...chapters[chI], activities: acts }
      }

      // Add to destination activity
      if (destination.droppableId.startsWith('activity-')) {
        const parts = destination.droppableId.split('-')
        const chI = parseInt(parts[1])
        const aI = parseInt(parts[2])
        const acts = [...chapters[chI].activities]
        const file = fileLookup[fileId]
        if (file) {
          const mapping = EXT_TO_ACTIVITY_TYPE[file.extension] || {
            type: 'TYPE_DYNAMIC',
            subType: 'SUBTYPE_DYNAMIC_PAGE',
          }
          acts[aI] = {
            ...acts[aI],
            file_ids: [...acts[aI].file_ids, fileId],
            activity_type: mapping.type,
            activity_sub_type: mapping.subType,
          }
        }
        chapters[chI] = { ...chapters[chI], activities: acts }
      }

      onStructureChange({ ...structure, chapters })
      return
    }

    if (type === 'CHAPTER') {
      const chapters = [...structure.chapters]
      const [moved] = chapters.splice(source.index, 1)
      chapters.splice(destination.index, 0, moved)
      onStructureChange({ ...structure, chapters })
      return
    }

    if (type === 'ACTIVITY') {
      const srcChapterIndex = parseInt(
        source.droppableId.replace('chapter-activities-', '')
      )
      const dstChapterIndex = parseInt(
        destination.droppableId.replace('chapter-activities-', '')
      )
      const chapters = [...structure.chapters]

      const srcActivities = [...chapters[srcChapterIndex].activities]
      const [moved] = srcActivities.splice(source.index, 1)
      chapters[srcChapterIndex] = {
        ...chapters[srcChapterIndex],
        activities: srcActivities,
      }

      const dstActivities =
        srcChapterIndex === dstChapterIndex
          ? srcActivities
          : [...chapters[dstChapterIndex].activities]
      dstActivities.splice(destination.index, 0, moved)
      chapters[dstChapterIndex] = {
        ...chapters[dstChapterIndex],
        activities: dstActivities,
      }

      onStructureChange({ ...structure, chapters })
    }
  }

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="flex gap-4 h-full">
        {/* File sidebar */}
        <div className="w-64 flex-shrink-0">
          <MigrationFileList
            files={files}
            assignedFileIds={assignedFileIds}
          />
        </div>

        {/* Tree editor */}
        <div className="flex-1 bg-white rounded-xl nice-shadow p-4 overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-700">
              {t('migration.course_structure')}
            </h3>
            <button
              onClick={addChapter}
              className="flex items-center space-x-1 text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded-md hover:bg-gray-50"
            >
              <Plus size={14} />
              <span>{t('migration.add_chapter')}</span>
            </button>
          </div>

          <Droppable droppableId="chapters" type="CHAPTER">
            {(provided) => (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                className="space-y-3"
              >
                {structure.chapters.map((chapter, chapterIndex) => (
                  <Draggable
                    key={`chapter-${chapterIndex}`}
                    draggableId={`chapter-${chapterIndex}`}
                    index={chapterIndex}
                  >
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        className={`border rounded-lg ${
                          snapshot.isDragging ? 'shadow-lg' : ''
                        }`}
                      >
                        {/* Chapter header */}
                        <div className="flex items-center space-x-2 p-3 bg-gray-50 rounded-t-lg">
                          <div {...provided.dragHandleProps}>
                            <GripVertical
                              size={14}
                              className="text-gray-300"
                            />
                          </div>
                          <button onClick={() => toggleChapter(chapterIndex)}>
                            {expandedChapters.has(chapterIndex) ? (
                              <ChevronDown
                                size={14}
                                className="text-gray-500"
                              />
                            ) : (
                              <ChevronRight
                                size={14}
                                className="text-gray-500"
                              />
                            )}
                          </button>
                          <FolderOpen
                            size={14}
                            className="text-gray-500"
                          />
                          <Input
                            value={chapter.name}
                            onChange={(e) =>
                              updateChapterName(
                                chapterIndex,
                                e.target.value
                              )
                            }
                            className="h-7 text-sm border-0 bg-transparent focus:bg-white"
                          />
                          <button
                            onClick={() => removeChapter(chapterIndex)}
                            className="text-gray-300 hover:text-red-500"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>

                        {/* Activities */}
                        {expandedChapters.has(chapterIndex) && (
                          <div className="p-3 space-y-2">
                            <Droppable
                              droppableId={`chapter-activities-${chapterIndex}`}
                              type="ACTIVITY"
                            >
                              {(provided) => (
                                <div
                                  ref={provided.innerRef}
                                  {...provided.droppableProps}
                                  className="space-y-2"
                                >
                                  {chapter.activities.map(
                                    (activity, actIndex) => (
                                      <Draggable
                                        key={`activity-${chapterIndex}-${actIndex}`}
                                        draggableId={`activity-${chapterIndex}-${actIndex}`}
                                        index={actIndex}
                                      >
                                        {(provided, snapshot) => (
                                          <div
                                            ref={provided.innerRef}
                                            {...provided.draggableProps}
                                            className={`border rounded-md p-2 ${
                                              snapshot.isDragging
                                                ? 'shadow-md bg-blue-50'
                                                : 'bg-white'
                                            }`}
                                          >
                                            <div className="flex items-center space-x-2">
                                              <div
                                                {...provided.dragHandleProps}
                                              >
                                                <GripVertical
                                                  size={12}
                                                  className="text-gray-300"
                                                />
                                              </div>
                                              <Input
                                                value={activity.name}
                                                onChange={(e) =>
                                                  updateActivityName(
                                                    chapterIndex,
                                                    actIndex,
                                                    e.target.value
                                                  )
                                                }
                                                className="h-6 text-xs border-0 bg-transparent focus:bg-white"
                                              />
                                              <span className="text-[10px] text-gray-400 flex-shrink-0">
                                                {activity.activity_type.replace(
                                                  'TYPE_',
                                                  ''
                                                )}
                                              </span>
                                              <button
                                                onClick={() =>
                                                  removeActivity(
                                                    chapterIndex,
                                                    actIndex
                                                  )
                                                }
                                                className="text-gray-300 hover:text-red-500 flex-shrink-0"
                                              >
                                                <Trash2 size={12} />
                                              </button>
                                            </div>

                                            {/* File drop zone for activity */}
                                            <Droppable
                                              droppableId={`activity-${chapterIndex}-${actIndex}`}
                                              type="FILE"
                                            >
                                              {(provided, snapshot) => (
                                                <div
                                                  ref={provided.innerRef}
                                                  {...provided.droppableProps}
                                                  className={`mt-1 min-h-[24px] rounded px-1 transition-colors ${
                                                    snapshot.isDraggingOver
                                                      ? 'bg-blue-50 border border-blue-200'
                                                      : ''
                                                  }`}
                                                >
                                                  {activity.file_ids.map(
                                                    (fid) => {
                                                      const file =
                                                        fileLookup[fid]
                                                      if (!file) return null
                                                      return (
                                                        <div
                                                          key={fid}
                                                          className="flex items-center space-x-1 text-xs text-gray-500 py-0.5"
                                                        >
                                                          {getFileIcon(
                                                            file.extension
                                                          )}
                                                          <span className="truncate">
                                                            {file.filename}
                                                          </span>
                                                          <button
                                                            onClick={() =>
                                                              removeFileFromActivity(
                                                                chapterIndex,
                                                                actIndex,
                                                                fid
                                                              )
                                                            }
                                                            className="text-gray-300 hover:text-red-500"
                                                          >
                                                            <X size={10} />
                                                          </button>
                                                        </div>
                                                      )
                                                    }
                                                  )}
                                                  {provided.placeholder}
                                                  {activity.file_ids
                                                    .length === 0 &&
                                                    !snapshot.isDraggingOver && (
                                                      <p className="text-[10px] text-gray-300 py-1">
                                                        {t(
                                                          'migration.drop_file_here'
                                                        )}
                                                      </p>
                                                    )}
                                                </div>
                                              )}
                                            </Droppable>
                                          </div>
                                        )}
                                      </Draggable>
                                    )
                                  )}
                                  {provided.placeholder}
                                </div>
                              )}
                            </Droppable>
                            <button
                              onClick={() => addActivity(chapterIndex)}
                              className="flex items-center space-x-1 text-xs text-gray-400 hover:text-gray-600 px-2 py-1"
                            >
                              <Plus size={12} />
                              <span>{t('migration.add_activity')}</span>
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </div>
      </div>
    </DragDropContext>
  )
}
