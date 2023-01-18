"use client";
import React from "react";
import { useState, useEffect } from "react";
import styled from "styled-components";
import { Header } from "../../../../../../components/UI/Header";
import Layout from "../../../../../../components/UI/Layout";
import { Title } from "../../../../../../components/UI/Elements/Styles/Title";
import { DragDropContext, Droppable } from "react-beautiful-dnd";
import { initialData, initialData2 } from "../../../../../../components/Drags/data";
import Chapter from "../../../../../../components/Drags/Chapter";
import { createChapter, deleteChapter, getCourseChaptersMetadata, updateChaptersMetadata } from "../../../../../../services/courses/chapters";
import { useRouter } from "next/navigation";
import NewChapterModal from "../../../../../../components/Modals/CourseEdit/NewChapter";
import NewLectureModal from "../../../../../../components/Modals/CourseEdit/NewLecture";
import { createLecture, createFileLecture } from "../../../../../../services/courses/lectures";

function CourseEdit(params: any) {
  const router = useRouter();

  // Initial Course State
  const [data, setData] = useState(initialData2) as any;

  // New Chapter Modal State
  const [newChapterModal, setNewChapterModal] = useState(false) as any;
  // New Lecture Modal State
  const [newLectureModal, setNewLectureModal] = useState(false) as any;
  const [newLectureModalData, setNewLectureModalData] = useState("") as any;

  // Check window availability
  const [winReady, setwinReady] = useState(false);
  const courseid = params.params.courseid;
  const orgslug = params.params.orgslug;

  async function getCourseChapters() {
    const courseChapters = await getCourseChaptersMetadata(courseid);
    setData(courseChapters);
    console.log("courseChapters", courseChapters);
  }

  useEffect(() => {
    if (courseid && orgslug) {
      getCourseChapters();
    }

    setwinReady(true);
  }, [courseid, orgslug]);

  // get a list of chapters order by chapter order
  const getChapters = () => {
    const chapterOrder = data.chapterOrder ? data.chapterOrder : [];
    return chapterOrder.map((chapterId: any) => {
      const chapter = data.chapters[chapterId];
      let lectures = [];
      if (data.lectures) {
        lectures = chapter.lectureIds.map((lectureId: any) => data.lectures[lectureId])
          ? chapter.lectureIds.map((lectureId: any) => data.lectures[lectureId])
          : [];
      }
      return {
        list: {
          chapter: chapter,
          lectures: lectures,
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

  // Submit new lecture
  const submitLecture = async (lecture: any) => {
    console.log("submitLecture", lecture);
    await updateChaptersMetadata(courseid, data);
    await createLecture(lecture, lecture.chapterId);
    await getCourseChapters();
    setNewLectureModal(false);
  };

  // Submit File Upload
  const submitFileLecture = async (file: any, type: any, lecture: any, chapterId: string) => {
    console.log("submitFileLecture", file);
    await updateChaptersMetadata(courseid, data);
    await createFileLecture(file, type, lecture, chapterId);
    await getCourseChapters();
    setNewLectureModal(false);
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

  const openNewLectureModal = async (chapterId: any) => {
    console.log("openNewLectureModal", chapterId);
    setNewLectureModal(true);
    setNewLectureModalData(chapterId);
  };

  // Close new chapter modal
  const closeNewChapterModal = () => {
    setNewChapterModal(false);
  };

  const closeNewLectureModal = () => {
    setNewLectureModal(false);
  };

  /* 
  Drag and drop functions

  */
  const onDragEnd = (result: any) => {
    const { destination, source, draggableId, type } = result;
    console.log(result);

    // check if the lecture is dropped outside the droppable area
    if (!destination) {
      return;
    }

    // check if the lecture is dropped in the same place
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

    //////////////////////// LECTURES IN SAME CHAPTERS ////////////////////////////
    // check if the lecture is dropped in the same chapter
    const start = data.chapters[source.droppableId];
    const finish = data.chapters[destination.droppableId];

    // check if the lecture is dropped in the same chapter
    if (start === finish) {
      // create new arrays for chapters and lectures
      const chapter = data.chapters[source.droppableId];
      const newLectureIds = Array.from(chapter.lectureIds);

      // remove the lecture from the old position
      newLectureIds.splice(source.index, 1);

      // add the lecture to the new position
      newLectureIds.splice(destination.index, 0, draggableId);

      const newChapter = {
        ...chapter,
        lectureIds: newLectureIds,
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

    //////////////////////// LECTURES IN DIFF CHAPTERS ////////////////////////////
    // check if the lecture is dropped in a different chapter
    if (start !== finish) {
      // create new arrays for chapters and lectures
      const startChapterLectureIds = Array.from(start.lectureIds);

      // remove the lecture from the old position
      startChapterLectureIds.splice(source.index, 1);
      const newStart = {
        ...start,
        lectureIds: startChapterLectureIds,
      };

      // add the lecture to the new position within the chapter
      const finishChapterLectureIds = Array.from(finish.lectureIds);
      finishChapterLectureIds.splice(destination.index, 0, draggableId);
      const newFinish = {
        ...finish,
        lectureIds: finishChapterLectureIds,
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
    <>
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
      {newLectureModal && (
        <NewLectureModal
          closeModal={closeNewLectureModal}
          submitFileLecture={submitFileLecture}
          submitLecture={submitLecture}
          chapterId={newLectureModalData}
        ></NewLectureModal>
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
                          openNewLectureModal={openNewLectureModal}
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
    </>
  );
}

const ChapterlistWrapper = styled.div`
  display: flex;
  padding-left: 30px;
`;
export default CourseEdit;
