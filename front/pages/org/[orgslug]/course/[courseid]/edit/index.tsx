import React from "react";
import { useState, useEffect } from "react";
import styled from "styled-components";
import { Header } from "../../../../../../components/ui/header";
import Layout from "../../../../../../components/ui/layout";
import { Title } from "../../../../../../components/ui/styles/title";
import { DragDropContext, Droppable, Draggable } from "react-beautiful-dnd";
import { initialData } from "../../../../../../components/drags/data";
import Chapter from "../../../../../../components/drags/chapter";

function CourseEdit() {
  const [data, setData] = useState(initialData) as any;
  const [winReady, setwinReady] = useState(false);

  useEffect(() => {
    setwinReady(true);
  }, []);

  // get a list of chapters order by chapter order
  const getChapters = () => {
    return data.chapterOrder.map((chapterId: any) => {
      const chapter = data.chapters[chapterId];
      const elements = chapter.elementIds.map((elementId: any) => data.elements[elementId]);
      return {
        list: {
          chapter: chapter,
          elements: elements,
        },
      };
    });
  };

  const onDragEnd = (result: any) => {
    const { destination, source, draggableId, type } = result;
    console.log(result);

    // check if the element is dropped outside the droppable area
    if (!destination) {
      return;
    }

    // check if the element is dropped in the same place
    if (destination.droppableId === source.droppableId && destination.index === source.index) {
      return;
    }
    //////////////////////////// CHAPTERS ////////////////////////////
    if (type === "chapter") {
      const newChapterOrder = Array.from(data.chapterOrder);
      newChapterOrder.splice(source.index, 1);
      newChapterOrder.splice(destination.index, 0, draggableId);

      const newState = {
        ...data,
        chapterOrder: newChapterOrder,
      };
      console.log(newState);
      
      setData(newState);
      return;
    }

    //////////////////////// ELEMENTS IN SAME CHAPTERS ////////////////////////////
    // check if the element is dropped in the same chapter
    const start = data.chapters[source.droppableId];
    const finish = data.chapters[destination.droppableId];

    // check if the element is dropped in the same chapter
    if (start === finish) {
      // create new arrays for chapters and elements
      const chapter = data.chapters[source.droppableId];
      const newElementIds = Array.from(chapter.elementIds);

      // remove the element from the old position
      newElementIds.splice(source.index, 1);

      // add the element to the new position
      newElementIds.splice(destination.index, 0, draggableId);

      const newChapter = {
        ...chapter,
        elementIds: newElementIds,
      };

      const newState = {
        ...data,
        chapters: {
          ...data.chapters,
          [newChapter.id]: newChapter,
        },
      };

      setData(newState);
      return;
    }

    //////////////////////// ELEMENTS IN DIFF CHAPTERS ////////////////////////////
    // check if the element is dropped in a different chapter
    if (start !== finish) {
      // create new arrays for chapters and elements
      const startChapterElementIds = Array.from(start.elementIds);

      // remove the element from the old position
      startChapterElementIds.splice(source.index, 1);
      const newStart = {
        ...start,
        elementIds: startChapterElementIds,
      };

      // add the element to the new position within the chapter
      const finishChapterElementIds = Array.from(finish.elementIds);
      finishChapterElementIds.splice(destination.index, 0, draggableId);
      const newFinish = {
        ...finish,
        elementIds: finishChapterElementIds,
      };

      const newState = {
        ...data,
        chapters: {
          ...data.chapters,
          [newStart.id]: newStart,
          [newFinish.id]: newFinish,
        },
      };

      setData(newState);
      return;
    }
  };

  return (
    <Layout>
      <Header></Header>
      <Title>Edit Course Chapters</Title>
      <br />
      {winReady && (
        <ChapterlistWrapper>
          <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId="chapters" type="chapter">
            {(provided) => (
              <div  key={"chapters"} {...provided.droppableProps} ref={provided.innerRef}>
                {getChapters().map((info: any, index: any) => (
                  <Chapter key={index} info={info} index={index}></Chapter>
                  
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
        </ChapterlistWrapper>
      )}
    </Layout>
  );
}

const ChapterlistWrapper = styled.div`
  display: flex;
  padding-left: 30px;
`;
export default CourseEdit;
