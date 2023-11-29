import React from "react";
import styled from "styled-components";
import { DragDropContext, Droppable, Draggable } from "react-beautiful-dnd";
import Activity from "./Activity";
import { Folders, Hexagon, MoreVertical, Pencil, PlusSquare, Save, Sparkle, Sparkles, Trash, Trash2, X } from "lucide-react";
import ConfirmationModal from "@components/StyledElements/ConfirmationModal/ConfirmationModal";
import { useRouter } from "next/navigation";
import { updateChapter } from "@services/courses/chapters";
import { mutate } from "swr";
import { getAPIUrl } from "@services/config/config";
import { revalidateTags } from "@services/utils/ts/requests";

interface ModifiedChapterInterface {
  chapterId: string;
  chapterName: string;
}

function Chapter(props: any) {
  const router = useRouter();
  const [modifiedChapter, setModifiedChapter] = React.useState<ModifiedChapterInterface | undefined>(undefined);
  const [selectedChapter, setSelectedChapter] = React.useState<string | undefined>(undefined);

  async function updateChapterName(chapterId: string) {
    if (modifiedChapter?.chapterId === chapterId) {
      setSelectedChapter(undefined);
      let modifiedChapterCopy = {
        name: modifiedChapter.chapterName,
      }
      await updateChapter(chapterId, modifiedChapterCopy)
      await mutate(`${getAPIUrl()}chapters/course/${props.course_uuid}/meta`)
      await revalidateTags(['courses'], props.orgslug)
      router.refresh();
    }
  }

  return (
    <Draggable key={props.info.list.chapter.uuid} draggableId={String(props.info.list.chapter.uuid)} index={props.index}>
      {(provided, snapshot) => (
        <ChapterWrapper
          {...provided.dragHandleProps}
          {...provided.draggableProps}
          ref={provided.innerRef}
          //  isDragging={snapshot.isDragging}
          className="max-w-screen-2xl mx-auto bg-white px-5"
          key={props.info.list.chapter.id}
        >
          <div className="flex pt-3 pr-3 font-bold text-md items-center space-x-2">
            <div className="flex grow text-lg space-x-3 items-center rounded-md px-3 py-1">
              <div className="bg-neutral-100 rounded-md p-2">
                <Hexagon strokeWidth={3} size={16} className="text-neutral-600 " />
              </div>

              <div className="flex space-x-2 items-center">

                {selectedChapter === props.info.list.chapter.id ?
                  (<div className="chapter-modification-zone bg-neutral-100 py-1 px-4 rounded-lg space-x-3">
                    <input type="text" className="bg-transparent outline-none text-sm text-neutral-700" placeholder="Chapter name" value={modifiedChapter ? modifiedChapter?.chapterName : props.info.list.chapter.name} onChange={(e) => setModifiedChapter({ chapterId: props.info.list.chapter.id, chapterName: e.target.value })} />
                    <button onClick={() => updateChapterName(props.info.list.chapter.id)} className="bg-transparent text-neutral-700 hover:cursor-pointer hover:text-neutral-900">
                      <Save size={15} onClick={() => updateChapterName(props.info.list.chapter.id)} />
                    </button>
                  </div>) : (<p className="text-neutral-700 first-letter:uppercase">{props.info.list.chapter.name}</p>)}
                <Pencil size={15} className="text-neutral-600 hover:cursor-pointer" onClick={() => setSelectedChapter(props.info.list.chapter.id)} />
              </div>
            </div>
            <MoreVertical size={15} className="text-gray-300" />
            <ConfirmationModal
              confirmationButtonText="Delete Chapter"
              confirmationMessage="Are you sure you want to delete this chapter?"
              dialogTitle={"Delete " + props.info.list.chapter.name + " ?"}
              dialogTrigger={
                <div
                  className=" hover:cursor-pointer p-1 px-4 bg-red-600 rounded-md shadow flex space-x-1 items-center text-rose-100 text-sm"
                  rel="noopener noreferrer">
                  <X size={15} className="text-rose-200 font-bold" />
                  <p>Delete Chapter</p>
                </div>}
              functionToExecute={() => props.deleteChapter(props.info.list.chapter.id)}
              status='warning'
            ></ConfirmationModal>

          </div>
          <Droppable key={props.info.list.chapter.id} droppableId={String(props.info.list.chapter.id)} type="activity">
            {(provided) => (
              <ActivitiesList {...provided.droppableProps} ref={provided.innerRef}>
                <div className="flex flex-col">
                  {props.info.list.activities.map((activity: any, index: any) => (
                    <Activity orgslug={props.orgslug} courseid={props.courseid} key={activity.id} activity={activity} index={index}></Activity>
                  ))}
                  {provided.placeholder}

                  <div onClick={() => {
                    props.openNewActivityModal(props.info.list.chapter.id);
                  }} className="flex space-x-2 items-center py-2 my-3 rounded-md justify-center text-white  bg-black  hover:cursor-pointer">
                    <Sparkles className="" size={17} />
                    <div className="text-sm mx-auto my-auto  items-center font-bold">Add Activity + </div>
                  </div>
                </div>
              </ActivitiesList>

            )}
          </Droppable>

        </ChapterWrapper>
      )}
    </Draggable>
  );
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
  h3{
    padding-left: 20px;
    padding-right: 20px;
  }
`;

const ActivitiesList = styled.div`
  padding: 10px;
`;

export default Chapter;
