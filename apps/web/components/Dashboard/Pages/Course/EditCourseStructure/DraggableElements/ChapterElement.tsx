import { useLHSession } from '@components/Contexts/LHSessionContext'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import { Draggable, Droppable } from '@hello-pangea/dnd'
import { getAPIUrl } from '@services/config/config'
import { deleteChapter, updateChapter } from '@services/courses/chapters'
import { revalidateTags } from '@services/utils/ts/requests'
import {
  Hexagon,
  MoreHorizontal,
  MoreVertical,
  Pencil,
  Save,
  Trash2,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { mutate } from 'swr'
import NewActivityButton from '../Buttons/NewActivityButton'
import ActivityElement from './ActivityElement'

type ChapterElementProps = {
  chapter: any
  chapterIndex: number
  orgslug: string
  course_uuid: string
}

interface ModifiedChapterInterface {
  chapterId: string
  chapterName: string
}

function ChapterElement(props: ChapterElementProps) {
  const activities = props.chapter.activities || []
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const [modifiedChapter, setModifiedChapter] = useState<
    ModifiedChapterInterface | undefined
  >(undefined)
  const [selectedChapter, setSelectedChapter] = useState<string | undefined>(
    undefined
  )

  const router = useRouter()

  const deleteChapterUI = async () => {
    await deleteChapter(props.chapter.id, access_token)
    mutate(`${getAPIUrl()}courses/${props.course_uuid}/meta`)
    await revalidateTags(['courses'], props.orgslug)
    router.refresh()
  }

  async function updateChapterName(chapterId: string) {
    if (modifiedChapter?.chapterId === chapterId) {
      const modifiedChapterCopy = {
        name: modifiedChapter.chapterName,
      }
      await updateChapter(chapterId, modifiedChapterCopy, access_token)
      mutate(`${getAPIUrl()}courses/${props.course_uuid}/meta`)
      await revalidateTags(['courses'], props.orgslug)
      router.refresh()
    }
    setSelectedChapter(undefined)
  }

  return (
    <Draggable
      key={props.chapter.chapter_uuid}
      draggableId={props.chapter.chapter_uuid}
      index={props.chapterIndex}
    >
      {(provided, snapshot) => (
        <div
          className="nice-shadow mx-2 rounded-xl bg-white px-3 pt-4 sm:mx-4 sm:px-4 sm:pt-6 md:mx-6 md:px-6 lg:mx-10"
          key={props.chapter.chapter_uuid}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          ref={provided.innerRef}
        >
          <div className="flex flex-wrap items-center justify-between pb-3">
            <div className="mb-2 flex grow items-center space-x-2 sm:mb-0">
              <div className="rounded-md bg-neutral-100 p-2">
                <Hexagon
                  strokeWidth={3}
                  size={16}
                  className="text-neutral-600"
                />
              </div>
              <div className="flex items-center space-x-2">
                {selectedChapter === props.chapter.id ? (
                  <div className="chapter-modification-zone flex items-center space-x-2 rounded-lg bg-neutral-100 px-2 py-1 sm:px-4">
                    <input
                      type="text"
                      className="w-full max-w-[150px] bg-transparent text-sm text-neutral-700 outline-hidden sm:max-w-none"
                      placeholder="Chapter name"
                      value={
                        modifiedChapter
                          ? modifiedChapter?.chapterName
                          : props.chapter.name
                      }
                      onChange={(e) =>
                        setModifiedChapter({
                          chapterId: props.chapter.id,
                          chapterName: e.target.value,
                        })
                      }
                    />
                    <button
                      onClick={() => updateChapterName(props.chapter.id)}
                      className="bg-transparent text-neutral-700 hover:cursor-pointer hover:text-neutral-900"
                    >
                      <Save size={15} />
                    </button>
                  </div>
                ) : (
                  <p className="text-sm text-neutral-700 first-letter:uppercase sm:text-base">
                    {props.chapter.name}
                  </p>
                )}
                <Pencil
                  size={15}
                  onClick={() => setSelectedChapter(props.chapter.id)}
                  className="text-neutral-600 hover:cursor-pointer"
                />
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <MoreVertical size={15} className="text-gray-300" />
              <ConfirmationModal
                confirmationButtonText="Delete Chapter"
                confirmationMessage="Are you sure you want to delete this chapter?"
                dialogTitle={'Delete ' + props.chapter.name + ' ?'}
                dialogTrigger={
                  <button
                    className="flex items-center rounded-md bg-red-600 p-1 px-2 text-sm text-rose-100 shadow-sm hover:cursor-pointer sm:px-3"
                    rel="noopener noreferrer"
                  >
                    <Trash2 size={15} className="text-rose-200" />
                  </button>
                }
                functionToExecute={() => deleteChapterUI()}
                status="warning"
              />
            </div>
          </div>
          <Droppable
            key={props.chapter.chapter_uuid}
            droppableId={props.chapter.chapter_uuid}
            type="activity"
          >
            {(provided) => (
              <div {...provided.droppableProps} ref={provided.innerRef}>
                <div className="flex min-h-[60px] flex-col">
                  {activities.map((activity: any, index: any) => {
                    return (
                      <div
                        key={activity.activity_uuid}
                        className="flex items-center"
                      >
                        <ActivityElement
                          orgslug={props.orgslug}
                          course_uuid={props.course_uuid}
                          activityIndex={index}
                          activity={activity}
                        />
                      </div>
                    )
                  })}
                  {provided.placeholder}
                </div>
              </div>
            )}
          </Droppable>
          <NewActivityButton
            orgslug={props.orgslug}
            chapterId={props.chapter.id}
          />
          <div className="h-6">
            <div className="flex items-center">
              <MoreHorizontal size={19} className="mx-auto text-gray-300" />
            </div>
          </div>
        </div>
      )}
    </Draggable>
  )
}

export default ChapterElement
