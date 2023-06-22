import React from "react";
import styled from "styled-components";
import { DragDropContext, Droppable, Draggable } from "react-beautiful-dnd";
import Activity from "./Activity";
import { PlusSquare, Trash, Trash2 } from "lucide-react";

function Chapter(props: any) {
  return (
    <Draggable key={props.info.list.chapter.id} draggableId={props.info.list.chapter.id} index={props.index}>
      {(provided, snapshot) => (
        <ChapterWrapper
          {...provided.dragHandleProps}
          {...provided.draggableProps}
          ref={provided.innerRef}
          //  isDragging={snapshot.isDragging}
          className="backdrop-blur-md"
          key={props.info.list.chapter.id}
        >
          <h3 className="flex space-x-2 pt-3 font-bold text-md items-center">
            <p>{props.info.list.chapter.name}
            </p>


            <div
              className="hover:cursor-pointer p-1 rounded-md bg-slate-100"
              onClick={() => {
                props.deleteChapter(props.info.list.chapter.id);
              }}
            >
              <Trash2 className="text-slate-500" size={16} />
            </div>
          </h3>
          <Droppable key={props.info.list.chapter.id} droppableId={props.info.list.chapter.id} type="activity">
            {(provided) => (
              <ActivitiesList {...provided.droppableProps} ref={provided.innerRef}>
                <div className="flex flex-col ">
                  {props.info.list.activities.map((activity: any, index: any) => (
                    <Activity orgslug={props.orgslug} courseid={props.courseid} key={activity.id} activity={activity} index={index}></Activity>
                  ))}
                  {provided.placeholder}

                  <div onClick={() => {
                    props.openNewActivityModal(props.info.list.chapter.id);
                  }} className="flex space-x-2 items-center py-2 my-3 rounded-md justify-center text-slate-500 outline-slate-200 bg-slate-50  hover:cursor-pointer">
                    <PlusSquare className="" size={17} />
                    <div className="text-sm mx-auto my-auto  items-center font-bold">Add Activity</div>
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
  padding: 4px;
  background-color: #ffffff9d;
  width: 900px;
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
