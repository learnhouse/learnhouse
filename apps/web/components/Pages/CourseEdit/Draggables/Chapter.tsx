import { useLHSession } from '@components/Contexts/LHSessionContext'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import { Draggable, Droppable } from '@hello-pangea/dnd'
import { getAPIUrl } from '@services/config/config'
import { updateChapter } from '@services/courses/chapters'
import { revalidateTags } from '@services/utils/ts/requests'
import { Hexagon, MoreVertical, Pencil, Save, Sparkles, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import styled from 'styled-components'
import { mutate } from 'swr'
import Activity from './Activity'

interface ModifiedChapterInterface {
  chapterId: string
  chapterName: string
}

function Chapter(props: any) {
  const router = useRouter()
  const session = useLHSession() as any
  const [modifiedChapter, setModifiedChapter] = useState<
    ModifiedChapterInterface | undefined
  >(undefined)
  const [selectedChapter, setSelectedChapter] = useState<string | undefined>(
    undefined
  )

  async function updateChapterName(chapterId: string) {
    if (modifiedChapter?.chapterId === chapterId) {
      const modifiedChapterCopy = {
        name: modifiedChapter.chapterName,
      }
      await updateChapter(
        chapterId,
        modifiedChapterCopy,
        session.data?.tokens?.access_token
      )
      await mutate(`${getAPIUrl()}chapters/course/${props.course_uuid}/meta`)
      await revalidateTags(['courses'], props.orgslug)
      router.refresh()
    }
    setSelectedChapter(undefined)
  }

  return (
    <Draggable
      key={props.info.list.chapter.uuid}
      draggableId={String(props.info.list.chapter.uuid)}
      index={props.index}
    >
      {(provided, snapshot) => (
        <ChapterWrapper
          {...provided.dragHandleProps}
          {...provided.draggableProps}
          ref={provided.innerRef}
          //  isDragging={snapshot.isDragging}
          className="mx-auto max-w-(--breakpoint-2xl) bg-white px-5"
          key={props.info.list.chapter.id}
        >
          <div className="text-md flex items-center space-x-2 pt-3 pr-3 font-bold">
            <div className="flex grow items-center space-x-3 rounded-md px-3 py-1 text-lg">
              <div className="rounded-md bg-neutral-100 p-2">
                <Hexagon
                  strokeWidth={3}
                  size={16}
                  className="text-neutral-600"
                />
              </div>

              <div className="flex items-center space-x-2">
                {selectedChapter === props.info.list.chapter.id ? (
                  <div className="chapter-modification-zone space-x-3 rounded-lg bg-neutral-100 px-4 py-1">
                    <input
                      type="text"
                      className="bg-transparent text-sm text-neutral-700 outline-hidden"
                      placeholder="Chapter name"
                      value={
                        modifiedChapter
                          ? modifiedChapter?.chapterName
                          : props.info.list.chapter.name
                      }
                      onChange={(e) =>
                        setModifiedChapter({
                          chapterId: props.info.list.chapter.id,
                          chapterName: e.target.value,
                        })
                      }
                    />
                    <button
                      onClick={() =>
                        updateChapterName(props.info.list.chapter.id)
                      }
                      className="bg-transparent text-neutral-700 hover:cursor-pointer hover:text-neutral-900"
                    >
                      <Save
                        size={15}
                        onClick={() =>
                          updateChapterName(props.info.list.chapter.id)
                        }
                      />
                    </button>
                  </div>
                ) : (
                  <p className="text-neutral-700 first-letter:uppercase">
                    {props.info.list.chapter.name}
                  </p>
                )}
                <Pencil
                  size={15}
                  className="text-neutral-600 hover:cursor-pointer"
                  onClick={() => setSelectedChapter(props.info.list.chapter.id)}
                />
              </div>
            </div>
            <MoreVertical size={15} className="text-gray-300" />
            <ConfirmationModal
              confirmationButtonText="Delete Chapter"
              confirmationMessage="Are you sure you want to delete this chapter?"
              dialogTitle={'Delete ' + props.info.list.chapter.name + ' ?'}
              dialogTrigger={
                <div
                  className="flex items-center space-x-1 rounded-md bg-red-600 p-1 px-4 text-sm text-rose-100 shadow-sm hover:cursor-pointer"
                  rel="noopener noreferrer"
                >
                  <X size={15} className="font-bold text-rose-200" />
                  <p>Delete Chapter</p>
                </div>
              }
              functionToExecute={() =>
                props.deleteChapter(props.info.list.chapter.id)
              }
              status="warning"
            ></ConfirmationModal>
          </div>
          <Droppable
            key={props.info.list.chapter.id}
            droppableId={String(props.info.list.chapter.id)}
            type="activity"
          >
            {(provided) => (
              <ActivitiesList
                {...provided.droppableProps}
                ref={provided.innerRef}
              >
                <div className="flex flex-col">
                  {props.info.list.activities.map(
                    (activity: any, index: any) => (
                      <Activity
                        orgslug={props.orgslug}
                        courseid={props.courseid}
                        key={activity.id}
                        activity={activity}
                        index={index}
                      ></Activity>
                    )
                  )}
                  {provided.placeholder}

                  <div
                    onClick={() => {
                      props.openNewActivityModal(props.info.list.chapter.id)
                    }}
                    className="my-3 flex items-center justify-center space-x-2 rounded-md bg-black py-5 text-white hover:cursor-pointer"
                  >
                    <Sparkles className="" size={17} />
                    <div className="mx-auto my-auto items-center text-sm font-bold">
                      Add Activity +{' '}
                    </div>
                  </div>
                </div>
              </ActivitiesList>
            )}
          </Droppable>
        </ChapterWrapper>
      )}
    </Draggable>
  )
}

const ChapterWrapper = styled.div`
  margin-bottom: 20px;
  padding: 12px;
  font-size: 15px;
  display: block;
  border-radius: 9px;
  border: 1px solid rgba(255, 255, 255, 0.19);
  box-shadow: 0px 13px 33px -13px rgb(0 0 0 / 12%);
  transition: all 0.2s ease;
  h3 {
    padding-left: 20px;
    padding-right: 20px;
  }
`

const ActivitiesList = styled.div`
  padding: 10px;
`

export default Chapter
