import { useAssignments } from '@components/Contexts/Assignments/AssignmentContext';
import { useAssignmentsTaskDispatch } from '@components/Contexts/Assignments/AssignmentsTaskContext';
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
    assignment_task_submission_uuid?: string;
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
        // Check if user is authenticated
        if (!access_token) {
            setError('Authentication required. Please sign in to upload files.');
            return;
        }

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
                assignment_task_submission_uuid: res.data.assignment_task_submission_uuid
            })
            setIsLoading(false)
            setError('')
        }
    }

    async function getAssignmentTaskSubmissionFromUserUI() {
        if (!access_token) {
            // Silently fail if not authenticated
            return;
        }
        
        if (assignmentTaskUUID) {
            const res = await getAssignmentTaskSubmissionsMe(assignmentTaskUUID, assignment.assignment_object.assignment_uuid, access_token);
            if (res.success) {
                setUserSubmissions({
                    ...res.data.task_submission,
                    assignment_task_submission_uuid: res.data.assignment_task_submission_uuid
                });
                setInitialUserSubmissions({
                    ...res.data.task_submission,
                    assignment_task_submission_uuid: res.data.assignment_task_submission_uuid
                });
            }
        }
    }

    const submitFC = async () => {
        // Check if user is authenticated
        if (!access_token) {
            toast.error('Authentication required. Please sign in to submit your task.');
            return;
        }

        // Save the file submission to the server
        const values = {
            assignment_task_submission_uuid: userSubmissions.assignment_task_submission_uuid || null,
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
                // Update userSubmissions with the returned UUID for future updates
                const updatedUserSubmissions = {
                    ...userSubmissions,
                    assignment_task_submission_uuid: res.data?.assignment_task_submission_uuid || userSubmissions.assignment_task_submission_uuid
                };
                setUserSubmissions(updatedUserSubmissions);
                setInitialUserSubmissions(updatedUserSubmissions);
            } else {
                toast.error('Error saving task, please retry later.');
            }
        }
    };

    async function getAssignmentTaskUI() {
        if (!access_token) {
            // Silently fail if not authenticated
            return;
        }
        
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
        if (!access_token) {
            // Silently fail if not authenticated
            return;
        }
        
        if (assignmentTaskUUID && user_id) {
            const res = await getAssignmentTaskSubmissionsUser(assignmentTaskUUID, user_id, assignment.assignment_object.assignment_uuid, access_token);
            if (res.success) {
                setUserSubmissions({
                    ...res.data.task_submission,
                    assignment_task_submission_uuid: res.data.assignment_task_submission_uuid
                });
                setUserSubmissionObject(res.data);
                setInitialUserSubmissions({
                    ...res.data.task_submission,
                    assignment_task_submission_uuid: res.data.assignment_task_submission_uuid
                });
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
                assignment_task_submission_uuid: userSubmissions.assignment_task_submission_uuid,
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
                <div className='flex flex-col sm:flex-row py-5 sm:py-6 text-xs sm:text-sm justify-center mx-auto space-y-2 sm:space-y-0 sm:space-x-3 text-slate-600 px-4 sm:px-2 text-center sm:text-left bg-slate-50 rounded-lg border border-slate-100'>
                    <Info size={18} className="mx-auto sm:mx-0 text-slate-500" />
                    <p>User will be able to submit a file for this task, you'll be able to review it in the Submissions Tab</p>
                </div>
            )}
            {view === 'custom-grading' && (
                <div className='flex flex-col space-y-4 w-full px-2 sm:px-0'>
                    <div className='flex flex-col sm:flex-row py-5 sm:py-6 text-xs sm:text-sm justify-center mx-auto space-y-2 sm:space-y-0 sm:space-x-3 text-slate-600 px-4 sm:px-2 text-center sm:text-left bg-slate-50 rounded-lg border border-slate-100'>
                        <Download size={18} className="mx-auto sm:mx-0 text-slate-500" />
                        <p>Please download the file and grade it manually, then input the grade above</p>
                    </div>
                    {userSubmissions.fileUUID && !isLoading && assignmentTaskUUID && (
                        <Link
                            href={getTaskFileSubmissionDir(org?.org_uuid, assignment.course_object.course_uuid, assignment.activity_object.activity_uuid, assignment.assignment_object.assignment_uuid, assignmentTaskUUID, userSubmissions.fileUUID)}
                            target='_blank'
                            className='flex flex-col rounded-lg bg-white text-gray-500 shadow-xs hover:shadow-md transition-shadow border border-gray-100 px-4 sm:px-5 py-4 space-y-1 items-center relative w-full sm:w-auto mx-auto'>
                            <div className='absolute top-0 right-0 transform translate-x-1/2 -translate-y-1/2 bg-emerald-500 rounded-full p-1.5 text-white flex justify-center items-center shadow-xs'>
                                <Cloud size={14} />
                            </div>

                            <div className='flex space-x-2 mt-2 items-center'>
                                <File size={18} className="text-emerald-500" />
                                <div className='font-medium text-xs sm:text-sm uppercase break-all'>
                                    {`${userSubmissions.fileUUID.slice(0, 8)}...${userSubmissions.fileUUID.slice(-4)}`}
                                </div>
                            </div>
                        </Link>
                    )}
                </div>
            )}
            {view === 'student' && (
                <>
                    <div className="w-full bg-white rounded-lg border border-gray-100 min-h-[200px] shadow-xs px-4 sm:px-6 py-5 sm:py-6">
                        <div className="flex flex-col justify-center items-center h-full w-full">
                            <div className="flex flex-col justify-center items-center w-full max-w-full">
                                <div className="flex flex-col justify-center items-center w-full">
                                    {error && (
                                        <div className="flex justify-center bg-red-50 border border-red-100 rounded-md text-red-600 space-x-2 items-center p-3 transition-all shadow-xs w-full sm:w-auto mb-4">
                                            <div className="text-xs sm:text-sm font-medium">{error}</div>
                                        </div>
                                    )}
                                </div>
                                {localUploadFile && !isLoading && (
                                    <div className='flex flex-col rounded-lg bg-white text-gray-500 shadow-xs border border-gray-100 px-4 sm:px-5 py-4 space-y-1 items-center relative w-full sm:w-auto mt-3'>
                                        <div className='absolute top-0 right-0 transform translate-x-1/2 -translate-y-1/2 bg-emerald-500 rounded-full p-1.5 text-white flex justify-center items-center shadow-xs'>
                                            <Cloud size={14} />
                                        </div>

                                        <div className='flex space-x-2 mt-2 items-center'>
                                            <File size={18} className="text-emerald-500" />
                                            <div className='font-medium text-xs sm:text-sm uppercase break-all'>
                                                {localUploadFile.name.length > 20 
                                                    ? `${localUploadFile.name.slice(0, 10)}...${localUploadFile.name.slice(-10)}`
                                                    : localUploadFile.name}
                                            </div>
                                        </div>
                                    </div>
                                )}
                                {userSubmissions.fileUUID && !isLoading && !localUploadFile && (
                                    <div className='flex flex-col rounded-lg bg-white text-gray-500 shadow-xs border border-gray-100 px-4 sm:px-5 py-4 space-y-1 items-center relative w-full sm:w-auto mt-3'>
                                        <div className='absolute top-0 right-0 transform translate-x-1/2 -translate-y-1/2 bg-emerald-500 rounded-full p-1.5 text-white flex justify-center items-center shadow-xs'>
                                            <Cloud size={14} />
                                        </div>

                                        <div className='flex space-x-2 mt-2 items-center'>
                                            <File size={18} className="text-emerald-500" />
                                            <div className='font-medium text-xs sm:text-sm uppercase break-all'>
                                                {`${userSubmissions.fileUUID.slice(0, 8)}...${userSubmissions.fileUUID.slice(-4)}`}
                                            </div>
                                        </div>
                                    </div>
                                )}
                                <div className='flex flex-col sm:flex-row pt-5 font-medium space-y-1 sm:space-y-0 sm:space-x-2 text-xs items-center text-slate-500 text-center sm:text-left bg-slate-50 rounded-lg px-3 py-2 mt-5 border border-slate-100 w-full sm:w-auto'>
                                    <Info size={15} className="mx-auto sm:mx-0 text-slate-400" />
                                    <p>Allowed formats: pdf, docx, mp4, jpg, jpeg, png, pptx, zip</p>
                                </div>
                                {!access_token ? (
                                    <div className="flex justify-center items-center w-full mt-5">
                                        <div className="flex justify-center bg-amber-50 border border-amber-100 rounded-md text-amber-600 space-x-2 items-center p-3 transition-all shadow-xs w-full sm:w-auto">
                                            <Info size={15} className="text-amber-500" />
                                            <div className="text-xs sm:text-sm font-medium">Please sign in to upload files</div>
                                        </div>
                                    </div>
                                ) : isLoading ? (
                                    <div className="flex justify-center items-center w-full mt-5">
                                        <input
                                            type="file"
                                            id="fileInput"
                                            style={{ display: 'none' }}
                                            onChange={handleFileChange}
                                        />
                                        <div className="font-medium animate-pulse antialiased items-center bg-slate-100 text-slate-600 text-xs sm:text-sm rounded-md px-4 sm:px-5 py-2.5 flex">
                                            <Loader size={15} className="mr-2" />
                                            <span>Loading</span>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex justify-center items-center w-full mt-5">
                                        <input
                                            type="file"
                                            id={"fileInput_" + assignmentTaskUUID}
                                            style={{ display: 'none' }}
                                            onChange={handleFileChange}
                                        />
                                        <button
                                            className="font-medium antialiased items-center text-white text-xs sm:text-sm rounded-md px-4 sm:px-5 py-2.5 flex bg-emerald-500 hover:bg-emerald-600 transition-colors shadow-xs"
                                            onClick={() => document.getElementById("fileInput_" + assignmentTaskUUID)?.click()}
                                        >
                                            <UploadCloud size={15} className="mr-2" />
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
