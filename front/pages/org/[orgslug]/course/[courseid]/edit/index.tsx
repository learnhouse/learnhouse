import React from "react";
import { useState, useEffect } from "react";
import styled from "styled-components";
import { Header } from "../../../../../../components/ui/Header";
import Layout from "../../../../../../components/ui/Layout";
import { Title } from "../../../../../../components/ui/styles/Title";
import { DragDropContext, Droppable, Draggable } from "react-beautiful-dnd";
import { initialData, initialData2 } from "../../../../../../components/drags/data";
import Chapter from "../../../../../../components/drags/Chapter";
import { createChapter, deleteChapter, getCourseChaptersMetadata, updateChaptersMetadata } from "../../../../../../services/courses/chapters";
import { useRouter } from "next/router";
import NewChapterModal from "../../../../../../components/modals/CourseEdit/NewChapter";
import NewElementModal from "../../../../../../components/modals/CourseEdit/NewElement";
import { createElement, createFileElement } from "../../../../../../services/courses/elements";

function CourseEdit() {
  const router = useRouter();

  // Initial Course State
  const [data, setData] = useState(initialData2) as any;

  // New Chapter Modal State
  const [newChapterModal, setNewChapterModal] = useState(false) as any;
  // New Element Modal State
  const [newElementModal, setNewElementModal] = useState(false) as any;
  const [newElementModalData, setNewElementModalData] = useState("") as any;

  // Check window availability
  const [winReady, setwinReady] = useState(false);
  const { courseid, orgslug } = router.query;

  async function getCourseChapters() {
    const courseChapters = await getCourseChaptersMetadata(courseid);
    setData(courseChapters);
    console.log("courseChapters", courseChapters);
  }

  useEffect(() => {
    if (router.isReady) {
      getCourseChapters();
    }

    setwinReady(true);
  }, [router.isReady]);

  // get a list of chapters order by chapter order
  const getChapters = () => {
    const chapterOrder = data.chapterOrder ? data.chapterOrder : [];
    return chapterOrder.map((chapterId: any) => {
      const chapter = data.chapters[chapterId];
      let elements = [];
      if (data.elements) {
        elements = chapter.elementIds.map((elementId: any) => data.elements[elementId])
          ? chapter.elementIds.map((elementId: any) => data.elements[elementId])
          : [];
      }
      return {
        list: {
          chapter: chapter,
          elements: elements,
        },
      };
    });
  };

  // Submit new chapter
  const submitChapter = async (chapter: any) => {
    await createChapter(chapter, courseid);
    await getCourseChapters();
    setNewChapterModal(false);
  };

  // Submit new element
  const submitElement = async (element: any) => {
    console.log("submitElement", element);
    await updateChaptersMetadata(courseid, data);
    await createElement(element, element.chapterId);
    await getCourseChapters();
    setNewElementModal(false);
  };

  // Submit File Upload
  const submitFileElement = async (file: any, type: any, element: any, chapterId: string) => {
    console.log("submitFileElement", file);
    await updateChaptersMetadata(courseid, data);
    await createFileElement(file, type, element, chapterId);
    await getCourseChapters();
    setNewElementModal(false);
  };

  const deleteChapterUI = async (chapterId: any) => {
    console.log("deleteChapter", chapterId);
    await deleteChapter(chapterId);
    getCourseChapters();
  };

  const updateChapters = () => {
    console.log(data);
    updateChaptersMetadata(courseid, data);
  };

  /* 
  
  Modals

  */

  const openNewElementModal = async (chapterId: any) => {
    console.log("openNewElementModal", chapterId);
    setNewElementModal(true);
    setNewElementModalData(chapterId);
  };

  // Close new chapter modal
  const closeNewChapterModal = () => {
    setNewChapterModal(false);
  };

  const closeNewElementModal = () => {
    setNewElementModal(false);
  };

  /* 
  Drag and drop functions

  */
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
      <Title>
        Edit Course Chapters{" "}
        <button
          onClick={() => {
            setNewChapterModal(true);
          }}
        >
          +
        </button>
        <button
          onClick={() => {
            updateChapters();
          }}
        >
          Save Chapters
        </button>
      </Title>
      {newChapterModal && <NewChapterModal closeModal={closeNewChapterModal} submitChapter={submitChapter}></NewChapterModal>}
      {newElementModal && (
        <NewElementModal
          closeModal={closeNewElementModal}
          submitFileElement={submitFileElement}
          submitElement={submitElement}
          chapterId={newElementModalData}
        ></NewElementModal>
      )}

      <br />
      {winReady && (
        <ChapterlistWrapper>
          <DragDropContext onDragEnd={onDragEnd}>
            <Droppable key="chapters" droppableId="chapters" type="chapter">
              {(provided) => (
                <>
                  <div key={"chapters"} {...provided.droppableProps} ref={provided.innerRef}>
                    {getChapters().map((info: any, index: any) => (
                      <>
                        <Chapter
                          orgslug={orgslug}
                          courseid={courseid}
                          openNewElementModal={openNewElementModal}
                          deleteChapter={deleteChapterUI}
                          key={index}
                          info={info}
                          index={index}
                        ></Chapter>
                      </>
                    ))}
                    {provided.placeholder}
                  </div>
                </>
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
