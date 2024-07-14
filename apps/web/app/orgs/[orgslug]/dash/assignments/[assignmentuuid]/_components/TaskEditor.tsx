'use client';
import { useAssignments } from '@components/Contexts/Assignments/AssignmentContext';
import { useAssignmentsTask, useAssignmentsTaskDispatch } from '@components/Contexts/Assignments/AssignmentsTaskContext';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import FormLayout, { FormField, FormLabelAndMessage, Input, Textarea } from '@components/StyledElements/Form/Form';
import * as Form from '@radix-ui/react-form';
import { getActivity } from '@services/courses/activities';
import { updateAssignmentTask, updateReferenceFile } from '@services/courses/assignments';
import { getTaskRefFileDir } from '@services/media/media';
import { useFormik } from 'formik';
import { ArrowBigUpDash, Cloud, File, GalleryVerticalEnd, Info, Loader, TentTree, Upload, UploadCloud } from 'lucide-react'
import Link from 'next/link';
import React, { use, useEffect } from 'react'
import toast from 'react-hot-toast';

function AssignmentTaskEditor({ page }: any) {
    const [selectedSubPage, setSelectedSubPage] = React.useState(page)
    const assignmentTaskState = useAssignmentsTask() as any

    useEffect(() => {
        console.log(assignmentTaskState)
    }
        , [assignmentTaskState])

    return (
        <div className="flex flex-col font-black text-sm w-full z-20">
            {assignmentTaskState.assignmentTask && Object.keys(assignmentTaskState.assignmentTask).length > 0 && (
                <div className='flex flex-col space-y-3'>
                    <div className='flex flex-col bg-white pl-10 pr-10 text-sm tracking-tight  z-10 shadow-[0px_4px_16px_rgba(0,0,0,0.06)] pt-5 mb-3 nice-shadow'>
                        <div className='font-semibold text-lg py-1'>
                            {assignmentTaskState?.assignmentTask.title}
                        </div>
                        <div className='flex space-x-2 '>
                            <div
                                onClick={() => setSelectedSubPage('general')}
                                className={`flex space-x-4 py-2 w-fit text-center border-black transition-all ease-linear ${selectedSubPage === 'general'
                                    ? 'border-b-4'
                                    : 'opacity-50'
                                    } cursor-pointer`}
                            >
                                <div className="flex items-center space-x-2.5 mx-2">
                                    <Info size={16} />
                                    <div>General</div>
                                </div>
                            </div>
                            <div
                                onClick={() => setSelectedSubPage('content')}
                                className={`flex space-x-4 py-2 w-fit text-center border-black transition-all ease-linear ${selectedSubPage === 'content'
                                    ? 'border-b-4'
                                    : 'opacity-50'
                                    } cursor-pointer`}
                            >
                                <div className="flex items-center space-x-2.5 mx-2">
                                    <GalleryVerticalEnd size={16} />
                                    <div>Content</div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className='ml-10 mr-10 mt-10 mx-auto bg-white rounded-xl shadow-sm px-6 py-5 nice-shadow'>
                        {selectedSubPage === 'general' && <AssignmentTaskGeneralEdit />}
                    </div>
                </div>
            )}
            {Object.keys(assignmentTaskState.assignmentTask).length == 0 && (
                <div className='flex flex-col h-full bg-white pl-10 pr-10 text-sm tracking-tight  z-10 shadow-[0px_4px_16px_rgba(0,0,0,0.06)] pt-5'>
                    <div className='flex justify-center items-center h-full text-gray-300 antialiased'>
                        <div className='flex flex-col space-y-2 items-center'>
                            <TentTree size={60} />
                            <div className='font-semibold text-2xl py-1'>
                                No Task Selected
                            </div>
                        </div>
                    </div>
                </div>
            )}

        </div>
    )
}

function AssignmentTaskGeneralEdit() {
    const session = useLHSession() as any;
    const access_token = session?.data?.tokens?.access_token;
    const assignmentTaskState = useAssignmentsTask() as any
    const assignmentTaskStateHook = useAssignmentsTaskDispatch() as any
    const assignment = useAssignments() as any

    const validate = (values: any) => {
        const errors: any = {};
        if (values.max_grade_value < 20 || values.max_grade_value > 100) {
            errors.max_grade_value = 'Value should be between 20 and 100';
        }
        return errors;
    };



    const formik = useFormik({
        initialValues: {
            title: assignmentTaskState.assignmentTask.title,
            description: assignmentTaskState.assignmentTask.description,
            hint: assignmentTaskState.assignmentTask.hint,
            max_grade_value: assignmentTaskState.assignmentTask.max_grade_value,
        },
        validate,
        onSubmit: async values => {
            const res = await updateAssignmentTask(values, assignmentTaskState.assignmentTask.assignment_task_uuid, assignment.assignment_object.assignment_uuid, access_token)
            if (res) {
                assignmentTaskStateHook({ type: 'reload' })
            }
            else {
                toast.error('Error updating task, please retry later.')
            }
        },
        enableReinitialize: true,
    }) as any;

    return (
        <FormLayout onSubmit={formik.handleSubmit}>
            <FormField name="title">
                <FormLabelAndMessage label="Title" message={formik.errors.title} />
                <Form.Control asChild>
                    <Input
                        onChange={formik.handleChange}
                        value={formik.values.title}
                        type="text"
                    />
                </Form.Control>
            </FormField>

            <FormField name="description">
                <FormLabelAndMessage label="Description" message={formik.errors.description} />
                <Form.Control asChild>
                    <Input
                        onChange={formik.handleChange}
                        value={formik.values.description}
                        type="text"
                    />
                </Form.Control>
            </FormField>

            <FormField name="hint">
                <FormLabelAndMessage label="Hint" message={formik.errors.hint} />
                <Form.Control asChild>
                    <Textarea
                        onChange={formik.handleChange}
                        value={formik.values.hint}
                    />
                </Form.Control>
            </FormField>

            <FormField name="hint">
                <div className='flex space-x-3 justify-between items-center'>
                    <FormLabelAndMessage label="Reference file" message={formik.errors.hint} />
                    <div className='flex space-x-1.5 text-xs items-center text-gray-500 '>
                        <Info size={16} />
                        <p>Allowed formats : pdf, docx, mp4, jpg, jpeg, pptx</p>
                    </div>

                </div>
                <Form.Control asChild>
                    <UpdateTaskRef />
                </Form.Control>
            </FormField>

            <FormField name="max_grade_value">
                <FormLabelAndMessage label="Max Grade Value" message={formik.errors.max_grade_value} />
                <Form.Control asChild>
                    <Input
                        onChange={formik.handleChange}
                        value={formik.values.max_grade_value}
                        type="number"
                    />
                </Form.Control>
            </FormField>

            {/* Submit button */}
            <Form.Submit >
                <button
                    type="submit"
                    className="flex items-center justify-center w-full px-4 py-2 mt-4 font-semibold text-white bg-green-500 rounded-md hover:bg-green-600"
                >
                    Submit
                </button>
            </Form.Submit>


        </FormLayout>
    )
}

function UpdateTaskRef() {
    const session = useLHSession() as any;
    const access_token = session?.data?.tokens?.access_token;
    const assignmentTaskState = useAssignmentsTask() as any
    const assignmentTaskStateHook = useAssignmentsTaskDispatch() as any
    const assignment = useAssignments() as any
    const [isLoading, setIsLoading] = React.useState(false)
    const [error, setError] = React.useState('') as any
    const [localRefFile, setLocalRefFile] = React.useState(null) as any
    const [activity, setActivity] = React.useState('') as any

    const handleFileChange = async (event: any) => {
        const file = event.target.files[0]
        setLocalRefFile(file)
        setIsLoading(true)
        const res = await updateReferenceFile(
            file,
            assignmentTaskState.assignmentTask.assignment_task_uuid,
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

    const deleteReferenceFile = async () => {
        setIsLoading(true)
        const res = await updateReferenceFile(
            '',
            assignmentTaskState.assignmentTask.assignment_task_uuid,
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

    async function getActivityUI() {
        const res = await getActivity(assignment.assignment_object.activity_id, null, access_token)
        console.log(res)
        setActivity(res.data)
    }

    

    useEffect(() => {
        getActivityUI()
        console.log(assignment.assignment_object.assignment_uuid)
        console.log(assignmentTaskState.assignmentTask.assignment_task_uuid)
    }
        , [assignmentTaskState])



    return (
        <div className="w-auto bg-gray-50 rounded-xl outline outline-1 outline-gray-200 h-[200px] shadow">
            <div className="flex flex-col justify-center items-center h-full">
                <div className="flex flex-col justify-center items-center">
                    <div className="flex flex-col justify-center items-center">
                        {error && (
                            <div className="flex justify-center bg-red-200 rounded-md text-red-950 space-x-2 items-center p-2 transition-all shadow-sm">
                                <div className="text-sm font-semibold">{error}</div>
                            </div>
                        )}

                    </div>
                    {assignmentTaskState.assignmentTask.reference_file && (
                        <div className='flex flex-col rounded-lg bg-white text-gray-400 shadow-lg nice-shadow px-5 py-3 space-y-1 items-center relative'>
                            <div className='absolute top-0 right-0 transform translate-x-1/2 -translate-y-1/2 bg-green-500 rounded-full px-1.5 py-1.5 text-white flex justify-center items-center'>
                                <Cloud size={15} />
                            </div>
                            <File size={20} className='' />
                            <div className='font-semibold text-sm uppercase'>
                                {assignmentTaskState.assignmentTask.reference_file.split('.').pop()}
                            </div>
                            <div className='flex space-x-2 mt-2'>
                                <Link 
                                href={''}
                                //href={getTaskRefFileDir(assignment.assignment_object.assignment_uuid, assignmentTaskState.assignmentTask.reference_file)}
                                className='bg-blue-500 text-white px-3 py-1 rounded-full text-xs font-semibold'>Download</Link>
                                {/** <button onClick={() => deleteReferenceFile()}
                                    className='bg-red-500 text-white px-3 py-1 rounded-full text-xs font-semibold'>Delete</button> */}
                            </div>
                        </div>
                    )}

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
                                <span>Change Reference File</span>
                            </button>
                        </div>
                    )}

                </div>
            </div>
        </div>
    )
}

export default AssignmentTaskEditor