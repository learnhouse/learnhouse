import { useCourse } from '@components/Dashboard/CourseContext';
import NewActivityModal from '@components/Objects/Modals/Activities/Create/NewActivity';
import Modal from '@components/StyledElements/Modal/Modal';
import { getAPIUrl } from '@services/config/config';
import { createActivity, createExternalVideoActivity, createFileActivity } from '@services/courses/activities';
import { getOrganizationContextInfoWithoutCredentials } from '@services/organizations/orgs';
import { revalidateTags } from '@services/utils/ts/requests';
import { Sparkles } from 'lucide-react'
import { useRouter } from 'next/navigation';
import React, { use, useEffect } from 'react'
import { mutate } from 'swr';

type NewActivityButtonProps = {
    chapterId: string,
    orgslug: string
}

function NewActivityButton(props: NewActivityButtonProps) {
    const [newActivityModal, setNewActivityModal] = React.useState(false);
    const router = useRouter();
    const course = useCourse() as any;

    const openNewActivityModal = async (chapterId: any) => {
        setNewActivityModal(true);
    };

    const closeNewActivityModal = async () => {
        setNewActivityModal(false);
    };

    // Submit new activity
    const submitActivity = async (activity: any) => {
        let org = await getOrganizationContextInfoWithoutCredentials(props.orgslug, { revalidate: 1800 });
        await createActivity(activity, props.chapterId, org.org_id);
        mutate(`${getAPIUrl()}courses/${course.courseStructure.course_uuid}/meta`);
        setNewActivityModal(false);
        await revalidateTags(['courses'], props.orgslug);
        router.refresh();
    };



    // Submit File Upload
    const submitFileActivity = async (file: any, type: any, activity: any, chapterId: string) => {
        await createFileActivity(file, type, activity, chapterId);
        mutate(`${getAPIUrl()}courses/${course.courseStructure.course_uuid}/meta`);
        setNewActivityModal(false);
        await revalidateTags(['courses'], props.orgslug);
        router.refresh();
    };

    // Submit YouTube Video Upload
    const submitExternalVideo = async (external_video_data: any, activity: any, chapterId: string) => {
        await createExternalVideoActivity(external_video_data, activity, props.chapterId);
        mutate(`${getAPIUrl()}courses/${course.courseStructure.course_uuid}/meta`);
        setNewActivityModal(false);
        await revalidateTags(['courses'], props.orgslug);
        router.refresh();
    };

    useEffect(() => { }
        , [course])

    return (
        <div>
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
                    chapterId={props.chapterId}
                    course={course}
                ></NewActivityModal>}
                dialogTitle="Create Activity"
                dialogDescription="Choose between types of activities to add to the course"

            />
            <div onClick={() => {
                openNewActivityModal(props.chapterId)
            }} className="flex space-x-2 items-center py-2 my-3 rounded-md justify-center text-white  bg-black  hover:cursor-pointer">
                <Sparkles className="" size={17} />
                <div className="text-sm mx-auto my-auto  items-center font-bold">Add Activity + </div>
            </div>
        </div>
    )
}

export default NewActivityButton