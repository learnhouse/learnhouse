import React from "react";
import styled from "styled-components";
import { DragDropContext, Droppable, Draggable } from "react-beautiful-dnd";
import Element, { ElementWrapper } from "./element";
import Link from "next/link";


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

function Chapter(props: any) {
  return (
    <Draggable key={props.info.list.chapter.id} draggableId={props.info.list.chapter.id} index={props.index}>
      {(provided, snapshot) => (
        <ChapterWrapper {...provided.dragHandleProps} {...provided.draggableProps} ref={provided.innerRef} isDragging={snapshot.isDragging} key={props.info.list.chapter.id}>
          <h3>{props.info.list.chapter.name} <button onClick={() => {props.deleteChapter(props.info.list.chapter.id)}}>X</button></h3>
          <Droppable key={props.info.list.chapter.id} droppableId={props.info.list.chapter.id} type="element">
            {(provided) => (
              <ElementsList {...provided.droppableProps} ref={provided.innerRef}>
                {props.info.list.elements.map((element: any, index: any) => (
                  <Element key={element.id} element={element} index={index}></Element>
                ))}
                {provided.placeholder}
              </ElementsList>
            )}
          </Droppable>
        </ChapterWrapper>
      )}
    </Draggable>
  );
}

const ElementsList = styled.div`
  padding: 10px;
`;



export default Chapter;
