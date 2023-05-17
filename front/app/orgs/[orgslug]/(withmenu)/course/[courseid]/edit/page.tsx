"use client";
import React from "react";

import { useState, useEffect } from "react";
import styled from "styled-components";
import { Title } from "@components/UI/Elements/Styles/Title";
import { DragDropContext, Droppable } from "react-beautiful-dnd";
import { initialData, initialData2 } from "@components/Pages/CourseEdit/Draggables/data";
import Chapter from "@components/Pages/CourseEdit/Draggables/Chapter";
import { createChapter, deleteChapter, getCourseChaptersMetadata, updateChaptersMetadata } from "@services/courses/chapters";
import { useRouter } from "next/navigation";
import NewChapterModal from "@components/Modals/Chapters/NewChapter";
import NewActivityModal from "@components/Modals/Activities/Create/NewActivity";
import { createActivity, createFileActivity, createExternalVideoActivity } from "@services/courses/activities";
import { getOrganizationContextInfo } from "@services/organizations/orgs";
import Modal from "@components/UI/Modal/Modal";
import { denyAccessToUser } from "@services/utils/react/middlewares/views";

function CourseEdit(params: any) {

  const router = useRouter();
  // Initial Course State
  const [data, setData] = useState(initialData2) as any;

  // New Chapter Modal State
  const [newChapterModal, setNewChapterModal] = useState(false) as any;
  // New Activity Modal State
  const [newActivityModal, setNewActivityModal] = useState(false) as any;
  const [newActivityModalData, setNewActivityModalData] = useState("") as any;

  // Check window availability
  const [winReady, setwinReady] = useState(false);
  const courseid = params.params.courseid;
  const orgslug = params.params.orgslug;

  async function getCourseChapters() {
    try {
      const courseChapters = await getCourseChaptersMetadata(courseid);
      setData(courseChapters);
    } catch (error: any) {
      denyAccessToUser(error, router)
    }
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
      let activities = [];
      if (data.activities) {
        activities = chapter.activityIds.map((activityId: any) => data.activities[activityId])
          ? chapter.activityIds.map((activityId: any) => data.activities[activityId])
          : [];
      }
      return {
        list: {
          chapter: chapter,
          activities: activities,
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

  // Submit new activity
  const submitActivity = async (activity: any) => {
    console.log("submitActivity", activity);
    let org = await getOrganizationContextInfo(orgslug);
    await updateChaptersMetadata(courseid, data);
    await createActivity(activity, activity.chapterId, org.org_id);
    await getCourseChapters();
    setNewActivityModal(false);
  };

  // Submit File Upload
  const submitFileActivity = async (file: any, type: any, activity: any, chapterId: string) => {
    await updateChaptersMetadata(courseid, data);
    await createFileActivity(file, type, activity, chapterId);
    await getCourseChapters();
    setNewActivityModal(false);
  };

  // Submit YouTube Video Upload
  const submitExternalVideo = async (external_video_data: any, activity: any, chapterId: string) => {
    console.log("submitExternalVideo", external_video_data);
    await updateChaptersMetadata(courseid, data);
    await createExternalVideoActivity(external_video_data, activity, chapterId);
    await getCourseChapters();
    setNewActivityModal(false);
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

  const openNewActivityModal = async (chapterId: any) => {
    console.log("openNewActivityModal", chapterId);
    setNewActivityModal(true);
    setNewActivityModalData(chapterId);
  };

  // Close new chapter modal
  const closeNewChapterModal = () => {
    setNewChapterModal(false);
  };

  const closeNewActivityModal = () => {
    console.log("closeNewActivityModal");

    setNewActivityModal(false);
  };

  /* 
  Drag and drop functions

  */
  const onDragEnd = (result: any) => {
    const { destination, source, draggableId, type } = result;
    console.log(result);

    // check if the activity is dropped outside the droppable area
    if (!destination) {
      return;
    }

    // check if the activity is dropped in the same place
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

    //////////////////////// ACTIVITIES IN SAME CHAPTERS ////////////////////////////
    // check if the activity is dropped in the same chapter
    const start = data.chapters[source.droppableId];
    const finish = data.chapters[destination.droppableId];

    // check if the activity is dropped in the same chapter
    if (start === finish) {
      // create new arrays for chapters and activities
      const chapter = data.chapters[source.droppableId];
      const newActivityIds = Array.from(chapter.activityIds);

      // remove the activity from the old position
      newActivityIds.splice(source.index, 1);

      // add the activity to the new position
      newActivityIds.splice(destination.index, 0, draggableId);

      const newChapter = {
        ...chapter,
        activityIds: newActivityIds,
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

    //////////////////////// ACTIVITIES IN DIFF CHAPTERS ////////////////////////////
    // check if the activity is dropped in a different chapter
    if (start !== finish) {
      // create new arrays for chapters and activities
      const startChapterActivityIds = Array.from(start.activityIds);

      // remove the activity from the old position
      startChapterActivityIds.splice(source.index, 1);
      const newStart = {
        ...start,
        activityIds: startChapterActivityIds,
      };

      // add the activity to the new position within the chapter
      const finishChapterActivityIds = Array.from(finish.activityIds);
      finishChapterActivityIds.splice(destination.index, 0, draggableId);
      const newFinish = {
        ...finish,
        activityIds: finishChapterActivityIds,
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
      <Page>
        <Title>
          Edit Course {" "}
          <Modal
            isDialogOpen={newChapterModal}
            onOpenChange={setNewChapterModal}
            minHeight="sm"
            dialogContent={<NewChapterModal
              closeModal={closeNewChapterModal}
              submitChapter={submitChapter}
            ></NewChapterModal>}
            dialogTitle="Create chapter"
            dialogDescription="Add a new chapter to the course"
            dialogTrigger={
              <button> Add chapter +
              </button>
            }
          />

          <button
            onClick={() => {
              updateChapters();
            }}
          >
            Save
          </button>
        </Title>

        <Modal
          isDialogOpen={newActivityModal}
          onOpenChange={setNewActivityModal}
          minHeight="no-min"
          addDefCloseButton={false}
          dialogContent={<NewActivityModal
            closeModal={closeNewActivityModal}
            submitFileActivity={submitFileActivity}
            submitExternalVideo={submitExternalVideo}
            submitActivity={submitActivity}
            chapterId={newActivityModalData}
          ></NewActivityModal>}
          dialogTitle="Create Activity"
          dialogDescription="Choose between types of activities to add to the course"

        />

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
                            openNewActivityModal={openNewActivityModal}
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
      </Page >
    </>
  );
}

const Page = styled.div`
  height: 100%;
  width: 100%;
  min-height: 100vh;
  min-width: 100vw;
  padding-top: 30px;

  // dots background
  background-image: radial-gradient(#4744446b 1px, transparent 1px), radial-gradient(#4744446b 1px, transparent 1px);
  background-position: 0 0, 25px 25px;
  background-size: 50px 50px;
  background-attachment: fixed;
  background-repeat: repeat;

  button {
    margin-left: 10px;
    background-color: #000000;
    border: none;
    border-radius: 5px;
    padding: 5px 10px;
    color: white;
    font-size: 13px;
    cursor: pointer;
    transition: 0.2s;
    font-family: "DM Sans", sans-serif;
    &:hover {
      background-color: #474444;

      transition: 0.2s;
    }
  }
`;
const ChapterlistWrapper = styled.div`
  display: flex;
  padding-left: 30px;
  justify-content: center;
`;
export default CourseEdit;
