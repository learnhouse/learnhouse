import React from "react";
import styled from "styled-components";
import { DragDropContext, Droppable, Draggable } from "react-beautiful-dnd";
import Lecture, { LectureWrapper } from "./Lecture";

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
                props.openNewLectureModal(props.info.list.chapter.id);
              }}
            >
              Create Lecture
            </button>
            <button
              onClick={() => {
                props.deleteChapter(props.info.list.chapter.id);
              }}
            >
              X
            </button>
          </h3>
          <Droppable key={props.info.list.chapter.id} droppableId={props.info.list.chapter.id} type="lecture">
            {(provided) => (
              <LecturesList {...provided.droppableProps} ref={provided.innerRef}>
                {props.info.list.lectures.map((lecture: any, index: any) => (
                  <Lecture orgslug={props.orgslug} courseid={props.courseid} key={lecture.id} lecture={lecture} index={index}></Lecture>
                ))}
                {provided.placeholder}
              </LecturesList>
            )}
          </Droppable>
        </ChapterWrapper>
      )}
    </Draggable>
  );
}

const ChapterWrapper = styled.div`
  margin-bottom: 5px;
  padding: 11px;
  background-color: #00000010;
  width: 310px;
  display: block;
  border-radius: 9px;
  border: 1px solid rgba(255, 255, 255, 0.19);
  box-shadow: 0px 13px 33px -13px rgb(0 0 0 / 12%);
  transition: all 0.2s ease;
`;

const LecturesList = styled.div`
  padding: 10px;
`;

export default Chapter;
