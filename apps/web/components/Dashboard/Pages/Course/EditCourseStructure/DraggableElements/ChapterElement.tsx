import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import {
  Hexagon,
  MoreHorizontal,
  MoreVertical,
  Pencil,
  Save,
  X,
  Trash2,
} from 'lucide-react'
import React from 'react'
import { Draggable, Droppable } from 'react-beautiful-dnd'
import ActivityElement from './ActivityElement'
import NewActivityButton from '../Buttons/NewActivityButton'
import { deleteChapter, updateChapter } from '@services/courses/chapters'
import { revalidateTags } from '@services/utils/ts/requests'
import { useRouter } from 'next/navigation'
import { getAPIUrl } from '@services/config/config'
import { mutate } from 'swr'
import { useLHSession } from '@components/Contexts/LHSessionContext'

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
  const session = useLHSession() as any;
  const access_token = session?.data?.tokens?.access_token;
  const [modifiedChapter, setModifiedChapter] = React.useState<
    ModifiedChapterInterface | undefined
  >(undefined)
  const [selectedChapter, setSelectedChapter] = React.useState<
    string | undefined
  >(undefined)

  const router = useRouter()

  const deleteChapterUI = async () => {
    await deleteChapter(props.chapter.id, access_token)
    mutate(`${getAPIUrl()}courses/${props.course_uuid}/meta`)
    await revalidateTags(['courses'], props.orgslug)
    router.refresh()
  }

  async function updateChapterName(chapterId: string) {
    if (modifiedChapter?.chapterId === chapterId) {
      let modifiedChapterCopy = {
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
          className="mx-2 sm:mx-4 md:mx-6 lg:mx-10 bg-white rounded-xl nice-shadow px-3 sm:px-4 md:px-6 pt-4 sm:pt-6"
          key={props.chapter.chapter_uuid}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          ref={provided.innerRef}
        >
          <div className="flex flex-wrap items-center justify-between pb-3">
            <div className="flex grow items-center space-x-2 mb-2 sm:mb-0">
              <div className="bg-neutral-100 rounded-md p-2">
                <Hexagon
                  strokeWidth={3}
                  size={16}
                  className="text-neutral-600"
                />
              </div>
              <div className="flex items-center space-x-2">
                {selectedChapter === props.chapter.id ? (
                  <div className="chapter-modification-zone bg-neutral-100 py-1 px-2 sm:px-4 rounded-lg flex items-center space-x-2">
                    <input
                      type="text"
                      className="bg-transparent outline-hidden text-sm text-neutral-700 w-full max-w-[150px] sm:max-w-none"
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
                  <p className="text-neutral-700 first-letter:uppercase text-sm sm:text-base">
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
                    className="hover:cursor-pointer p-1 px-2 sm:px-3 bg-red-600 rounded-md shadow-sm flex items-center text-rose-100 text-sm"
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
                <div className="flex flex-col">
                  {activities.map((activity: any, index: any) => {
                    return (
                      <div key={activity.activity_uuid} className="flex items-center ">
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
              <MoreHorizontal size={19} className="text-gray-300 mx-auto" />
            </div>
          </div>
        </div>
      )}
    </Draggable>
  )
}

export default ChapterElement
