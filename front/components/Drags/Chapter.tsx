import React from "react";
import styled from "styled-components";
import { DragDropContext, Droppable, Draggable } from "react-beautiful-dnd";
import Activity, { ActivityWrapper } from "./Activity";

function Chapter(props: any) {
  return (
    <Draggable key={props.info.list.chapter.id} draggableId={props.info.list.chapter.id} index={props.index}>
      {(provided, snapshot) => (
        <ChapterWrapper
          {...provided.dragHandleProps}
          {...provided.draggableProps}
          ref={provided.innerRef}
          //  isDragging={snapshot.isDragging}
          key={props.info.list.chapter.id}
        >
          <h3>
            {props.info.list.chapter.name}{" "}
            <button
              onClick={() => {
                props.openNewActivityModal(props.info.list.chapter.id);
              }}
            >
              Create Activity
            </button>
            <button
              onClick={() => {
                props.deleteChapter(props.info.list.chapter.id);
              }}
            >
              X
            </button>
          </h3>
          <Droppable key={props.info.list.chapter.id} droppableId={props.info.list.chapter.id} type="activity">
            {(provided) => (
              <ActivitiesList {...provided.droppableProps} ref={provided.innerRef}>
                {props.info.list.activities.map((activity: any, index: any) => (
                  <Activity orgslug={props.orgslug} courseid={props.courseid} key={activity.id} activity={activity} index={index}></Activity>
                ))}
                {provided.placeholder}
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
  background-color: #ffffffc5;
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
