import { useAssignments } from '@components/Contexts/Assignments/AssignmentContext';
import { useAssignmentsTask, useAssignmentsTaskDispatch } from '@components/Contexts/Assignments/AssignmentsTaskContext';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import { useOrg } from '@components/Contexts/OrgContext';
import AssignmentBoxUI from '@components/Objects/Activities/Assignment/AssignmentBoxUI'
import { getAssignmentTask, getAssignmentTaskSubmissionsMe, getAssignmentTaskSubmissionsUser, handleAssignmentTaskSubmission, updateSubFile } from '@services/courses/assignments';
import { getTaskFileSubmissionDir } from '@services/media/media';
import { Cloud, Download, File, Info, Loader, UploadCloud } from 'lucide-react'
import Link from 'next/link';
import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast';

type FileSchema = {
    fileUUID: string;
};

type TaskFileObjectProps = {
    view: 'teacher' | 'student' | 'grading' | 'custom-grading';
    assignmentTaskUUID?: string;
    user_id?: string;
};

export default function TaskFileObject({ view, user_id, assignmentTaskUUID }: TaskFileObjectProps) {
    const session = useLHSession() as any;
    const org = useOrg() as any;
    const access_token = session?.data?.tokens?.access_token;
    const [isLoading, setIsLoading] = React.useState(false);
    const [localUploadFile, setLocalUploadFile] = React.useState<File | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const [assignmentTask, setAssignmentTask] = React.useState<any>(null);
    const assignmentTaskStateHook = useAssignmentsTaskDispatch() as any;
    const assignment = useAssignments() as any;

    /* TEACHER VIEW CODE */
    /* TEACHER VIEW CODE */

    /* STUDENT VIEW CODE */
    const [showSavingDisclaimer, setShowSavingDisclaimer] = useState<boolean>(false);
    const [userSubmissions, setUserSubmissions] = useState<FileSchema>({
        fileUUID: '',
    });
    const [initialUserSubmissions, setInitialUserSubmissions] = useState<FileSchema>({
        fileUUID: '',
    });

    const handleFileChange = async (event: any) => {
        const file = event.target.files[0]

        setLocalUploadFile(file)
        setIsLoading(true)
        const res = await updateSubFile(
            file,
            assignmentTask.assignment_task_uuid,
            assignment.assignment_object.assignment_uuid,
            access_token
        )

        // wait for 1 second to show loading animation
        await new Promise((r) => setTimeout(r, 1500))
        if (res.success === false) {

            setError(res.data.detail)
            setIsLoading(false)
        } else {
            assignmentTaskStateHook({ type: 'reload' })
            setUserSubmissions({
                fileUUID: res.data.file_uuid,
            })
            setIsLoading(false)
            setError('')
        }

    }

    async function getAssignmentTaskSubmissionFromUserUI() {
        if (assignmentTaskUUID) {
            const res = await getAssignmentTaskSubmissionsMe(assignmentTaskUUID, assignment.assignment_object.assignment_uuid, access_token);
            if (res.success) {
                setUserSubmissions(res.data.task_submission);
                setInitialUserSubmissions(res.data.task_submission);
            }

        }
    }

    const submitFC = async () => {
        // Save the quiz to the server
        const values = {
            task_submission: userSubmissions,
            grade: 0,
            task_submission_grade_feedback: '',
        };
        if (assignmentTaskUUID) {
            const res = await handleAssignmentTaskSubmission(values, assignmentTaskUUID, assignment.assignment_object.assignment_uuid, access_token);
            if (res) {
                assignmentTaskStateHook({
                    type: 'reload',
                });
                toast.success('Task saved successfully');
                setShowSavingDisclaimer(false);
            } else {
                toast.error('Error saving task, please retry later.');
            }
        }
    };

    async function getAssignmentTaskUI() {
        if (assignmentTaskUUID) {
            const res = await getAssignmentTask(assignmentTaskUUID, access_token);
            if (res.success) {
                setAssignmentTask(res.data);
                setAssignmentTaskOutsideProvider(res.data);
            }

        }
    }

    // Detect changes between initial and current submissions
    useEffect(() => {
        if (userSubmissions.fileUUID !== initialUserSubmissions.fileUUID) {
            setShowSavingDisclaimer(true);
        } else {
            setShowSavingDisclaimer(false);
        }
    }, [userSubmissions]);

    /* STUDENT VIEW CODE */

    /* GRADING VIEW CODE */
    const [userSubmissionObject, setUserSubmissionObject] = useState<any>(null);
    async function getAssignmentTaskSubmissionFromIdentifiedUserUI() {
        if (assignmentTaskUUID && user_id) {
            const res = await getAssignmentTaskSubmissionsUser(assignmentTaskUUID, user_id, assignment.assignment_object.assignment_uuid, access_token);
            if (res.success) {
                setUserSubmissions(res.data.task_submission);
                setUserSubmissionObject(res.data);
                setInitialUserSubmissions(res.data.task_submission);
            }

        }
    }

    async function gradeCustomFC(grade: number) {
        if (assignmentTaskUUID) {
            if (grade > assignmentTaskOutsideProvider.max_grade_value) {
                toast.error(`Grade cannot be more than ${assignmentTaskOutsideProvider.max_grade_value} points`);
                return;
            }
            
    
            // Save the grade to the server
            const values = {
                task_submission: userSubmissions,
                grade: grade,
                task_submission_grade_feedback: 'Graded by teacher : @' + session.data.user.username,
            };
    
            const res = await handleAssignmentTaskSubmission(values, assignmentTaskUUID, assignment.assignment_object.assignment_uuid, access_token);
            if (res) {
                getAssignmentTaskSubmissionFromIdentifiedUserUI();
                toast.success(`Task graded successfully with ${grade} points`);
            } else {
                toast.error('Error grading task, please retry later.');
            }
        }
    }

    /* GRADING VIEW CODE */
    const [assignmentTaskOutsideProvider, setAssignmentTaskOutsideProvider] = useState<any>(null);
    useEffect(() => {
        // Student area
        if (view === 'student') {
            getAssignmentTaskUI()
            getAssignmentTaskSubmissionFromUserUI()
        }

        // Grading area
        else if (view == 'custom-grading') {
            getAssignmentTaskUI();
            //setQuestions(assignmentTaskState.assignmentTask.contents.questions);
            getAssignmentTaskSubmissionFromIdentifiedUserUI();
        }
    }
        , [assignmentTaskUUID])

    return (
        <AssignmentBoxUI submitFC={submitFC} showSavingDisclaimer={showSavingDisclaimer} view={view} gradeCustomFC={gradeCustomFC} currentPoints={userSubmissionObject?.grade} maxPoints={assignmentTaskOutsideProvider?.max_grade_value} type="file">
            {view === 'teacher' && (
                <div className='flex py-5 text-sm justify-center mx-auto space-x-2 text-slate-500'>
                    <Info size={20} />
                    <p>User will be able to submit a file for this task, you'll be able to review it in the Submissions Tab</p>
                </div>
            )}
            {view === 'custom-grading' && (
                <div className='flex flex-col space-y-1'>
                    <div className='flex py-5 text-sm justify-center mx-auto space-x-2 text-slate-500'>
                        <Download size={20} />
                        <p>Please download the file and grade it manually, then input the grade above</p>
                    </div>
                    {userSubmissions.fileUUID && !isLoading && assignmentTaskUUID && (
                        <Link
                            href={getTaskFileSubmissionDir(org?.org_uuid, assignment.course_object.course_uuid, assignment.activity_object.activity_uuid, assignment.assignment_object.assignment_uuid, assignmentTaskUUID, userSubmissions.fileUUID)}
                            target='_blank'
                            className='flex flex-col rounded-lg bg-white text-gray-400 shadow-lg nice-shadow px-5 py-3 space-y-1 items-center relative'>
                            <div className='absolute top-0 right-0 transform translate-x-1/2 -translate-y-1/2 bg-green-500 rounded-full px-1.5 py-1.5 text-white flex justify-center items-center'>
                                <Cloud size={15} />
                            </div>

                            <div

                                className='flex space-x-2 mt-2'>
                                <File size={20} className='' />
                                <div className='font-semibold text-sm uppercase'>
                                    {`${userSubmissions.fileUUID.slice(0, 8)}...${userSubmissions.fileUUID.slice(-4)}`}
                                </div>
                            </div>
                        </Link>
                    )}
                </div>
            )}
            {view === 'student' && (
                <>
                    <div className="w-auto bg-white rounded-xl outline outline-1 outline-gray-200 h-[200px] shadow">
                        <div className="flex flex-col justify-center items-center h-full">
                            <div className="flex flex-col justify-center items-center">
                                <div className="flex flex-col justify-center items-center">
                                    {error && (
                                        <div className="flex justify-center bg-red-200 rounded-md text-red-950 space-x-2 items-center p-2 transition-all shadow-sm">
                                            <div className="text-sm font-semibold">{error}</div>
                                        </div>
                                    )}

                                </div>
                                {localUploadFile && !isLoading && (
                                    <div className='flex flex-col rounded-lg bg-white text-gray-400 shadow-lg nice-shadow px-5 py-3 space-y-1 items-center relative'>
                                        <div className='absolute top-0 right-0 transform translate-x-1/2 -translate-y-1/2 bg-green-500 rounded-full px-1.5 py-1.5 text-white flex justify-center items-center'>
                                            <Cloud size={15} />
                                        </div>

                                        <div className='flex space-x-2 mt-2'>

                                            <File size={20} className='' />
                                            <div className='font-semibold text-sm uppercase'>
                                                {localUploadFile.name}
                                            </div>
                                        </div>
                                    </div>
                                )}
                                {userSubmissions.fileUUID && !isLoading && !localUploadFile && (
                                    <div className='flex flex-col rounded-lg bg-white text-gray-400 shadow-lg nice-shadow px-5 py-3 space-y-1 items-center relative'>
                                        <div className='absolute top-0 right-0 transform translate-x-1/2 -translate-y-1/2 bg-green-500 rounded-full px-1.5 py-1.5 text-white flex justify-center items-center'>
                                            <Cloud size={15} />
                                        </div>

                                        <div className='flex space-x-2 mt-2'>

                                            <File size={20} className='' />
                                            <div className='font-semibold text-sm uppercase'>
                                                {`${userSubmissions.fileUUID.slice(0, 8)}...${userSubmissions.fileUUID.slice(-4)}`}
                                            </div>
                                        </div>
                                    </div>
                                )}
                                <div className='flex pt-4 font-semibold space-x-1.5 text-xs items-center text-gray-500 '>
                                    <Info size={16} />
                                    <p>Allowed formats : pdf, docx, mp4, jpg, jpeg, png, pptx</p>
                                </div>
                                {isLoading ? (
                                    <div className="flex justify-center items-center">
                                        <input
                                            type="file"
                                            id="fileInput"
                                            style={{ display: 'none' }}
                                            onChange={handleFileChange}
                                        />
                                        <div className="font-bold  animate-pulse antialiased items-center bg-slate-200 text-gray text-sm rounded-md px-4 py-2 mt-4 flex">
                                            <Loader size={16} className="mr-2" />
                                            <span>Loading</span>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex justify-center items-center">
                                        <input
                                            type="file"
                                            id={"fileInput_" + assignmentTaskUUID}
                                            style={{ display: 'none' }}
                                            onChange={handleFileChange}
                                        />
                                        <button
                                            className="font-bold antialiased items-center  text-gray text-sm rounded-md px-4  mt-6 flex"
                                            onClick={() => document.getElementById("fileInput_" + assignmentTaskUUID)?.click()}
                                        >
                                            <UploadCloud size={16} className="mr-2" />
                                            <span>Submit File</span>
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </>
            )}
        </AssignmentBoxUI>
    )
}
