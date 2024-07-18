import { useAssignments } from '@components/Contexts/Assignments/AssignmentContext';
import { useAssignmentsTask, useAssignmentsTaskDispatch } from '@components/Contexts/Assignments/AssignmentsTaskContext';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import AssignmentBoxUI from '@components/Objects/Activities/Assignment/AssignmentBoxUI'
import { getAssignmentTask, updateSubFile } from '@services/courses/assignments';
import { Cloud, File, Info, Loader, UploadCloud } from 'lucide-react'
import React, { useEffect } from 'react'
import toast from 'react-hot-toast';

type FileSchema = {
    fileID: string;
};

type TaskFileObjectProps = {
    view: 'teacher' | 'student';
    assignmentTaskUUID?: string;
};

export default function TaskFileObject({ view, assignmentTaskUUID }: TaskFileObjectProps) {
    const session = useLHSession() as any;
    const access_token = session?.data?.tokens?.access_token;
    const [isLoading, setIsLoading] = React.useState(false);
    const [localUploadFile, setLocalUploadFile] = React.useState<File | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const [assignmentTask, setAssignmentTask] = React.useState<any>(null);
    const assignmentTaskStateHook = useAssignmentsTaskDispatch() as any;
    const assignment = useAssignments() as any;

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
        assignmentTaskStateHook({ type: 'reload' })
        // wait for 1 second to show loading animation
        await new Promise((r) => setTimeout(r, 1500))
        if (res.success === false) {
            setError(res.data.detail)
            setIsLoading(false)
        } else {
            setIsLoading(false)
            setError('')
        }

    }

    async function getAssignmentTaskUI() {
        if (assignmentTaskUUID) {
            const res = await getAssignmentTask(assignmentTaskUUID, access_token);
            if (res.success) {
                setAssignmentTask(res.data);
            }

        }
    }

    useEffect(() => {
        getAssignmentTaskUI()
    }
        , [assignmentTaskUUID])

    return (
        <AssignmentBoxUI view={view} type="file">
            {view === 'teacher' && (
                <div className='flex py-5 text-sm justify-center mx-auto space-x-2 text-slate-500'>
                    <Info size={20} />
                    <p>User will be able to submit a file for this task, you'll be able to review it in the Submissions Tab</p>
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
                                <div className='flex pt-4 font-semibold space-x-1.5 text-xs items-center text-gray-500 '>
                        <Info size={16} />
                        <p>Allowed formats : pdf, docx, mp4, jpg, jpeg, pptx</p>
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
                                            id="fileInput"
                                            style={{ display: 'none' }}
                                            onChange={handleFileChange}
                                        />
                                        <button
                                            className="font-bold antialiased items-center  text-gray text-sm rounded-md px-4  mt-6 flex"
                                            onClick={() => document.getElementById('fileInput')?.click()}
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
