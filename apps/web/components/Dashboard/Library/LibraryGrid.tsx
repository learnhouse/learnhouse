'use client'
import { DotsSixVertical } from '@phosphor-icons/react'
import { DragDropContext, Droppable, Draggable, type DropResult, type DraggableProvidedDragHandleProps } from '@hello-pangea/dnd'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { FolderCard, FolderRow, ItemCard, ItemRow, LIB_ROW_GRID, LIB_TABLE_GRID } from '@components/Dashboard/Library/libraryItems'
import type { ViewMode } from '@components/Dashboard/Shared/DashKit/DashKit'

type Props = {
  folders: any[]
  items: any[]
  orgslug: string
  org_id: number
  view: ViewMode
  onChanged: () => void
  onRemoveItem: (_item: any) => void | Promise<void>
  onDeleteFolder: (_folder: any) => void | Promise<void>
  /** When true (manual sort mode + admin), folders/items can be drag-reordered in grid view. */
  isManual?: boolean
  /** Persist the reordered folder list (already in the new order). */
  onReorderFolders?: (_folders: any[]) => void
  /** Persist the reordered content items (already in the new order). */
  onReorderItems?: (_items: any[]) => void
  /** Extra line under each card/row, e.g. the folder path in search results. */
  contextFor?: (_entry: any) => React.ReactNode
}

const FOLDER_GRID = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3'
const ITEM_GRID = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 items-start'

function reorder<T>(list: T[], from: number, to: number) {
  const next = Array.from(list)
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

function DragHandle({ props, className }: { props: DraggableProvidedDragHandleProps | null | undefined; className: string }) {
  const { t } = useTranslation()
  return (
    <div
      {...props}
      title={t('library.sort.drag_to_reorder')}
      aria-label={t('library.sort.drag_to_reorder')}
      className={`cursor-grab active:cursor-grabbing text-neutral-300 hover:text-neutral-600 transition-colors ${className}`}
    >
      <DotsSixVertical size={16} weight="bold" />
    </div>
  )
}

export default function LibraryGrid({
  folders,
  items,
  orgslug,
  org_id,
  view,
  onChanged,
  onRemoveItem,
  onDeleteFolder,
  isManual = false,
  onReorderFolders,
  onReorderItems,
  contextFor,
}: Props) {
  const { t } = useTranslation()
  const foldersDrag = view === 'grid' && isManual && !!onReorderFolders
  const itemsDrag = view === 'grid' && isManual && !!onReorderItems

  const folderProps = (folder: any) => ({
    folder,
    orgslug,
    org_id,
    onChanged,
    onDelete: onDeleteFolder,
    context: contextFor?.(folder),
  })
  const itemProps = (item: any) => ({ item, orgslug, org_id, onRemove: onRemoveItem, context: contextFor?.(item) })
  const itemKey = (item: any) =>
    `${item.resource_uuid}-${(item.path || []).map((p: any) => p.folder_uuid).join('-')}`

  if (view === 'list') {
    return (
      <div className={`bg-white rounded-2xl nice-shadow overflow-hidden ${LIB_TABLE_GRID}`}>
        <div className={`hidden ${LIB_ROW_GRID} px-5 py-3 border-b border-neutral-100 text-xs font-medium text-neutral-500`}>
          <span>{t('library.dash.columns.name')}</span>
          <span>{t('library.dash.columns.type')}</span>
          <span>{t('library.visibility')}</span>
          <span>{t('library.dash.columns.details')}</span>
          <span className="sr-only">{t('library.item_actions')}</span>
        </div>
        <ul className={`divide-y divide-neutral-100 ${LIB_ROW_GRID}`}>
          {folders.map((folder) => (
            <FolderRow key={folder.folder_uuid} {...folderProps(folder)} />
          ))}
          {items.map((item) => (
            <ItemRow key={itemKey(item)} {...itemProps(item)} />
          ))}
        </ul>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {folders.length > 0 &&
        (foldersDrag ? (
          <DragDropContext
            onDragEnd={(r: DropResult) => {
              if (!r.destination || r.destination.index === r.source.index) return
              onReorderFolders!(reorder(folders, r.source.index, r.destination.index))
            }}
          >
            <Droppable droppableId="folders" direction="horizontal">
              {(provided) => (
                <div ref={provided.innerRef} {...provided.droppableProps} className={FOLDER_GRID}>
                  {folders.map((folder, i) => (
                    <Draggable key={folder.folder_uuid} draggableId={folder.folder_uuid} index={i}>
                      {(drag, snapshot) => (
                        <div
                          ref={drag.innerRef}
                          {...drag.draggableProps}
                          className={snapshot.isDragging ? 'z-drag-overlay rotate-1 scale-[1.02]' : ''}
                        >
                          <FolderCard
                            {...folderProps(folder)}
                            dragHandle={<DragHandle props={drag.dragHandleProps} className="-ms-1 -me-1.5" />}
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
          <div className={FOLDER_GRID}>
            {folders.map((folder) => (
              <FolderCard key={folder.folder_uuid} {...folderProps(folder)} />
            ))}
          </div>
        ))}

      {items.length > 0 &&
        (itemsDrag ? (
          <DragDropContext
            onDragEnd={(r: DropResult) => {
              if (!r.destination || r.destination.index === r.source.index) return
              onReorderItems!(reorder(items, r.source.index, r.destination.index))
            }}
          >
            <Droppable droppableId="items" direction="horizontal">
              {(provided) => (
                <div ref={provided.innerRef} {...provided.droppableProps} className={ITEM_GRID}>
                  {items.map((item, i) => (
                    <Draggable key={item.resource_uuid} draggableId={String(item.resource_uuid)} index={i}>
                      {(drag, snapshot) => (
                        <div
                          ref={drag.innerRef}
                          {...drag.draggableProps}
                          className={snapshot.isDragging ? 'z-drag-overlay rotate-1 scale-[1.02]' : ''}
                        >
                          <ItemCard
                            {...itemProps(item)}
                            dragHandle={
                              <DragHandle
                                props={drag.dragHandleProps}
                                className="absolute top-2 start-2 z-10 w-7 h-7 rounded-md bg-white/95 backdrop-blur shadow-sm flex items-center justify-center !text-neutral-500 hover:!text-neutral-900"
                              />
                            }
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
          <div className={ITEM_GRID}>
            {items.map((item) => (
              <ItemCard key={itemKey(item)} {...itemProps(item)} />
            ))}
          </div>
        ))}
    </div>
  )
}
