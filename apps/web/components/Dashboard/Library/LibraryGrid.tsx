'use client'
import FolderThumbnail from '@components/Objects/Thumbnails/FolderThumbnail'
import LibraryItemCard from '@components/Dashboard/Library/LibraryItemCard'
import CourseThumbnail, { removeCoursePrefix } from '@components/Objects/Thumbnails/CourseThumbnail'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import { getUriWithOrg } from '@services/config/config'
import { FolderSimple } from '@phosphor-icons/react'
import { FolderMinus, GripVertical } from 'lucide-react'
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd'
import React from 'react'
import { useTranslation } from 'react-i18next'

type Props = {
  folders: any[]
  items: any[]
  orgslug: string
  org_id: number
  onChanged: () => void
  onRemoveItem: (_resourceUuid: string) => void
  emptyTitle?: string
  emptyDescription?: string
  emptyAction?: React.ReactNode
  /** When true (manual sort mode + admin), folders/items can be drag-reordered. */
  isManual?: boolean
  /** Persist the reordered folder list (already in the new order). */
  onReorderFolders?: (_folders: any[]) => void
  /** Persist the reordered content items (already in the new order). */
  onReorderItems?: (_items: any[]) => void
}

function CourseItem({ item, orgslug, onRemove }: { item: any; orgslug: string; onRemove: () => void }) {
  const { t } = useTranslation()
  const resource = item.resource || {}
  return (
    <div className="relative group">
      <CourseThumbnail
        course={resource}
        orgslug={orgslug}
        isDashboard={true}
        customLink={getUriWithOrg(orgslug, `/dash/courses/course/${removeCoursePrefix(resource.course_uuid || item.resource_uuid)}/general`)}
      />
      <div className="absolute top-2 left-2 z-30 opacity-0 group-hover:opacity-100 transition-opacity">
        <ConfirmationModal
          confirmationButtonText={t('library.remove_from_folder')}
          confirmationMessage={t('library.remove_from_folder_confirm')}
          dialogTitle={t('library.remove_from_folder')}
          dialogTrigger={
            <button title={t('library.remove_from_folder')} className="p-1.5 bg-white/90 backdrop-blur-sm rounded-full hover:bg-rose-50 hover:text-rose-600 text-gray-600 transition-all shadow-md">
              <FolderMinus className="w-4 h-4" />
            </button>
          }
          functionToExecute={onRemove}
          status="warning"
        />
      </div>
    </div>
  )
}

export default function LibraryGrid({
  folders,
  items,
  orgslug,
  org_id,
  onChanged,
  onRemoveItem,
  emptyTitle,
  emptyDescription,
  emptyAction,
  isManual = false,
  onReorderFolders,
  onReorderItems,
}: Props) {
  const { t } = useTranslation()
  const isEmpty = folders.length === 0 && items.length === 0
  const dragEnabled = isManual && !!onReorderFolders
  const itemsDragEnabled = isManual && !!onReorderItems

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination || !onReorderFolders) return
    if (result.destination.index === result.source.index) return
    const reordered = Array.from(folders)
    const [moved] = reordered.splice(result.source.index, 1)
    reordered.splice(result.destination.index, 0, moved)
    onReorderFolders(reordered)
  }

  const handleItemsDragEnd = (result: DropResult) => {
    if (!result.destination || !onReorderItems) return
    if (result.destination.index === result.source.index) return
    const reordered = Array.from(items)
    const [moved] = reordered.splice(result.source.index, 1)
    reordered.splice(result.destination.index, 0, moved)
    onReorderItems(reordered)
  }

  const itemKey = (item: any) => item.resource_uuid

  if (isEmpty) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
        <div className="bg-gray-100 rounded-2xl p-4 text-gray-400">
          <FolderSimple size={28} weight="duotone" />
        </div>
        <p className="text-sm font-semibold text-gray-500">{emptyTitle || t('library.empty_folder')}</p>
        {emptyDescription && <p className="text-xs text-gray-400 -mt-1 max-w-xs">{emptyDescription}</p>}
        {emptyAction && <div className="mt-2">{emptyAction}</div>}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-7">
      {/* Folders — always on top, in their own compact grid (Drive-like) */}
      {folders.length > 0 && (
        <section>
          {dragEnabled ? (
            <DragDropContext onDragEnd={handleDragEnd}>
              <Droppable droppableId="folders" direction="horizontal">
                {(provided) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3"
                  >
                    {folders.map((folder: any, i: number) => (
                      <Draggable key={folder.folder_uuid} draggableId={folder.folder_uuid} index={i}>
                        {(dragProvided, snapshot) => (
                          <div
                            ref={dragProvided.innerRef}
                            {...dragProvided.draggableProps}
                            style={{ ...dragProvided.draggableProps.style }}
                            className={`relative ${snapshot.isDragging ? 'z-drag-overlay rotate-1 scale-[1.02]' : ''}`}
                          >
                            <div
                              {...dragProvided.dragHandleProps}
                              className="absolute top-2 left-2 z-30 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 transition-colors"
                              title={t('library.sort.drag_to_reorder', { defaultValue: 'Drag to reorder' })}
                            >
                              <GripVertical size={16} />
                            </div>
                            <FolderThumbnail
                              folder={folder}
                              orgslug={orgslug}
                              org_id={org_id}
                              isDashboard={true}
                              onChanged={onChanged}
                            />
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {folders.map((folder: any) => (
                <FolderThumbnail
                  key={folder.folder_uuid}
                  folder={folder}
                  orgslug={orgslug}
                  org_id={org_id}
                  isDashboard={true}
                  onChanged={onChanged}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Resources — a separate grid of full-size cards below */}
      {items.length > 0 && (
        <section>
          {itemsDragEnabled ? (
            <DragDropContext onDragEnd={handleItemsDragEnd}>
              <Droppable droppableId="items" direction="horizontal">
                {(provided) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 items-start"
                  >
                    {items.map((item: any, i: number) => (
                      <Draggable key={itemKey(item)} draggableId={String(itemKey(item))} index={i}>
                        {(dragProvided, snapshot) => (
                          <div
                            ref={dragProvided.innerRef}
                            {...dragProvided.draggableProps}
                            style={{ ...dragProvided.draggableProps.style }}
                            className={`relative ${snapshot.isDragging ? 'z-drag-overlay rotate-1 scale-[1.02]' : ''}`}
                          >
                            <div
                              {...dragProvided.dragHandleProps}
                              className="absolute top-2 right-2 z-30 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 transition-colors bg-white/90 backdrop-blur-sm rounded-full p-1 shadow-md"
                              title={t('library.sort.drag_to_reorder', { defaultValue: 'Drag to reorder' })}
                            >
                              <GripVertical size={16} />
                            </div>
                            {item.resource_type === 'courses' ? (
                              <CourseItem item={item} orgslug={orgslug} onRemove={() => onRemoveItem(item.resource_uuid)} />
                            ) : (
                              <LibraryItemCard item={item} orgslug={orgslug} org_id={org_id} onRemove={() => onRemoveItem(item.resource_uuid)} />
                            )}
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 items-start">
              {items.map((item: any) =>
                item.resource_type === 'courses' ? (
                  <CourseItem key={item.resource_uuid} item={item} orgslug={orgslug} onRemove={() => onRemoveItem(item.resource_uuid)} />
                ) : (
                  <LibraryItemCard
                    key={item.resource_uuid}
                    item={item}
                    orgslug={orgslug}
                    org_id={org_id}
                    onRemove={() => onRemoveItem(item.resource_uuid)}
                  />
                )
              )}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
