"use client";
import React from "react";
import { useState, useEffect } from "react";
import { DragDropContext, Droppable } from "react-beautiful-dnd";
import Chapter from "@components/Pages/CourseEdit/Draggables/Chapter";
import { createChapter, deleteChapter, getCourseChaptersMetadata, updateChaptersMetadata } from "@services/courses/chapters";
import { useRouter } from "next/navigation";
import NewChapterModal from "@components/Objects/Modals/Chapters/NewChapter";
import NewActivityModal from "@components/Objects/Modals/Activities/Create/NewActivity";
import { createActivity, createFileActivity, createExternalVideoActivity } from "@services/courses/activities";
import { getOrganizationContextInfo, getOrganizationContextInfoWithoutCredentials } from "@services/organizations/orgs";
import Modal from "@components/StyledElements/Modal/Modal";
import { denyAccessToUser } from "@services/utils/react/middlewares/views";
import { Folders, Hexagon, SaveIcon } from "lucide-react";
import GeneralWrapperStyled from "@components/StyledElements/Wrappers/GeneralWrapper";
import { revalidateTags, swrFetcher } from "@services/utils/ts/requests";
import { getAPIUrl } from "@services/config/config";
import { mutate } from "swr";

function CourseContentEdition(props: any) {
    const router = useRouter();
    // Initial Course Chapters State
    const course_chapters_with_orders_and_activities = props.course_chapters_with_orders_and_activities;
    console.log('dev', course_chapters_with_orders_and_activities)

    // New Chapter Modal State
    const [newChapterModal, setNewChapterModal] = useState(false) as any;
    // New Activity Modal State
    const [newActivityModal, setNewActivityModal] = useState(false) as any;
    const [newActivityModalData, setNewActivityModalData] = useState("") as any;

    // Check window availability
    const [winReady, setwinReady] = useState(false);
    const course = props.course;
    const course_uuid = props.course ? props.course.course_uuid : ''
    const orgslug = props.orgslug;

    // 



    useEffect(() => {
        setwinReady(true);
    }, [course_uuid, orgslug]);

    // get a list of chapters order by chapter order
    const getChapters = () => {
        const chapterOrder = course_chapters_with_orders_and_activities.chapterOrder ? course_chapters_with_orders_and_activities.chapterOrder : [];
        return chapterOrder.map((chapterId: any) => {
            const chapter = course_chapters_with_orders_and_activities.chapters[chapterId];
            let activities = [];
            if (course_chapters_with_orders_and_activities.activities) {
                activities = chapter.activityIds.map((activityId: any) => course_chapters_with_orders_and_activities.activities[activityId])
                    ? chapter.activityIds.map((activityId: any) => course_chapters_with_orders_and_activities.activities[activityId])
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
        await createChapter(chapter);

        mutate(`${getAPIUrl()}chapters/course/${course_uuid}/meta`,true);
        await revalidateTags(['courses'], orgslug);
        router.refresh();
        setNewChapterModal(false);
    };

    // Submit new activity
    const submitActivity = async (activity: any) => {
        let org = await getOrganizationContextInfoWithoutCredentials(orgslug, { revalidate: 1800 });
        await updateChaptersMetadata(course_uuid, course_chapters_with_orders_and_activities);
        await createActivity(activity, activity.chapterId, org.org_id);
        mutate(`${getAPIUrl()}chapters/course/${course_uuid}/meta`);
        // await getCourseChapters();
        setNewActivityModal(false);
        await revalidateTags(['courses'], orgslug);
        router.refresh();
    };



    // Submit File Upload
    const submitFileActivity = async (file: any, type: any, activity: any, chapterId: string) => {
        await updateChaptersMetadata(course_uuid, course_chapters_with_orders_and_activities);
        await createFileActivity(file, type, activity, chapterId);
        mutate(`${getAPIUrl()}chapters/course/${course_uuid}/meta`);
        // await getCourseChapters();
        setNewActivityModal(false);
        await revalidateTags(['courses'], orgslug);
        router.refresh();
    };

    // Submit YouTube Video Upload
    const submitExternalVideo = async (external_video_data: any, activity: any, chapterId: string) => {
        await updateChaptersMetadata(course_uuid, course_chapters_with_orders_and_activities);
        await createExternalVideoActivity(external_video_data, activity, chapterId);
        mutate(`${getAPIUrl()}chapters/course/${course_uuid}/meta`);
        // await getCourseChapters();
        setNewActivityModal(false);
        await revalidateTags(['courses'], orgslug);
        router.refresh();
    };

    const deleteChapterUI = async (chapterId: any) => {
        await deleteChapter(chapterId);

        mutate(`${getAPIUrl()}chapters/course/${course_uuid}/meta`,true);
        // await getCourseChapters();
        await revalidateTags(['courses'], orgslug);
        router.refresh();
    };

    

    /* 
    Modals
    */

    const openNewActivityModal = async (chapterId: any) => {
        setNewActivityModal(true);
        setNewActivityModalData(chapterId);
    };

    // Close new chapter modal
    const closeNewChapterModal = () => {
        setNewChapterModal(false);
    };

    const closeNewActivityModal = () => {
        setNewActivityModal(false);
    };

    /* 
    Drag and drop functions
  
    */
    const onDragEnd = async (result: any) => {
        const { destination, source, draggableId, type } = result;


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
            const newChapterOrder = Array.from(course_chapters_with_orders_and_activities.chapterOrder);
            newChapterOrder.splice(source.index, 1);
            newChapterOrder.splice(destination.index, 0, draggableId);

            const newState = {
                ...course_chapters_with_orders_and_activities,
                chapterOrder: newChapterOrder,
            };

            props.dispatchCourseChaptersMetadata({ type: 'updated_chapter', payload: newState })
            props.dispatchSavedContent({ type: 'unsaved_content' })
            //setData(newState);
            return;
        }

        //////////////////////// ACTIVITIES IN SAME CHAPTERS ////////////////////////////
        // check if the activity is dropped in the same chapter
        const start = course_chapters_with_orders_and_activities.chapters[source.droppableId];
        const finish = course_chapters_with_orders_and_activities.chapters[destination.droppableId];

        // check if the activity is dropped in the same chapter
        if (start === finish) {
            // create new arrays for chapters and activities
            const chapter = course_chapters_with_orders_and_activities.chapters[source.droppableId];
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
                ...course_chapters_with_orders_and_activities,
                chapters: {
                    ...course_chapters_with_orders_and_activities.chapters,
                    [newChapter.id]: newChapter,
                },
            };
            props.dispatchCourseChaptersMetadata({ type: 'updated_chapter', payload: newState })
            props.dispatchSavedContent({ type: 'unsaved_content' })
            //setData(newState);
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
                ...course_chapters_with_orders_and_activities,
                chapters: {
                    ...course_chapters_with_orders_and_activities.chapters,
                    [newStart.id]: newStart,
                    [newFinish.id]: newFinish,
                },
            };

            props.dispatchCourseChaptersMetadata({ type: 'updated_chapter', payload: newState })
            props.dispatchSavedContent({ type: 'unsaved_content' })
            //setData(newState);
            return;
        }
    };

    return (
        <>
            <div className=""
            >
                <GeneralWrapperStyled>
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
                    {winReady && (
                        <div className="flex flex-col">
                            <DragDropContext onDragEnd={onDragEnd}>
                                <Droppable key="chapters" droppableId="chapters" type="chapter">
                                    {(provided) => (
                                        <>
                                            <div key={"chapters"} {...provided.droppableProps} ref={provided.innerRef}>
                                                {getChapters().map((info: any, index: any) => (
                                                    <>
                                                        <Chapter
                                                            orgslug={orgslug}
                                                            course_uuid={course_uuid}
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
                            <Modal
                                isDialogOpen={newChapterModal}
                                onOpenChange={setNewChapterModal}
                                minHeight="sm"
                                dialogContent={<NewChapterModal
                                    course={props.course ? props.course : null}
                                    closeModal={closeNewChapterModal}
                                    submitChapter={submitChapter}
                                ></NewChapterModal>}
                                dialogTitle="Create chapter"
                                dialogDescription="Add a new chapter to the course"
                                dialogTrigger={
                                    <div className="flex max-w-7xl bg-black text-sm shadow rounded-md items-center text-white justify-center mx-auto space-x-2 p-3 w-72 hover:bg-gray-900 hover:cursor-pointer">
                                        <Hexagon size={16} />
                                        <div>Add chapter +</div>
                                    </div>
                                }
                            />
                        </div>
                    )}
                </GeneralWrapperStyled >
            </div>
        </>
    );
}


export default CourseContentEdition;