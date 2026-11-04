'use client';
import { useAssignments } from '@components/Contexts/Assignments/AssignmentContext';
import { useAssignmentsTask, useAssignmentsTaskDispatch } from '@components/Contexts/Assignments/AssignmentsTaskContext';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import { useOrg } from '@components/Contexts/OrgContext';
import FormLayout, { FormField, FormLabelAndMessage, Input, Textarea } from '@components/Objects/StyledElements/Form/Form';
import * as Form from '@radix-ui/react-form';
import { getActivityByID } from '@services/courses/activities';
import { updateAssignmentTask, updateReferenceFile } from '@services/courses/assignments';
import { getTaskRefFileDir } from '@services/media/media';
import { useFormik } from 'formik';
import { Check, Download, File, Info, Loader, UploadCloud } from 'lucide-react'
import Link from 'next/link';
import React, { useEffect } from 'react'
import toast from 'react-hot-toast';
import { constructAcceptValue } from '@/lib/constants';
import { useTranslation } from 'react-i18next';

const SUPPORTED_FILES = constructAcceptValue(['pdf', 'docx', 'mp4', 'jpg', 'png', 'pptx', 'zip'])

export function AssignmentTaskGeneralEdit() {
    const { t } = useTranslation()
    const session = useLHSession() as any;
    const access_token = session?.data?.tokens?.access_token;
    const assignmentTaskState = useAssignmentsTask() as any
    const assignmentTaskStateHook = useAssignmentsTaskDispatch() as any
    const assignment = useAssignments() as any

    // No validate function: the teacher no longer configures points per task.
    // All tasks are graded out of 100 (a percentage). max_grade_value is still
    // sent in the update payload for backwards compatibility with legacy tasks
    // but is fixed at 100 for any edit from this screen.

    const formik = useFormik({
        initialValues: {
            title: assignmentTaskState.assignmentTask.title,
            description: assignmentTaskState.assignmentTask.description,
            hint: assignmentTaskState.assignmentTask.hint,
            max_grade_value: 100,
        },
        onSubmit: async values => {
            const res = await updateAssignmentTask(values, assignmentTaskState.assignmentTask.assignment_task_uuid, assignment.assignment_object.assignment_uuid, access_token)
            if (res) {
                assignmentTaskStateHook({ type: 'reload' })
                toast.success(t('dashboard.assignments.editor.toasts.task_updated'))
            }

            else {
                toast.error(t('dashboard.assignments.editor.toasts.task_update_error'))
            }
        },
        enableReinitialize: true,
    }) as any;

    return (
        <FormLayout onSubmit={formik.handleSubmit}>
            <FormField name="title">
                <FormLabelAndMessage label={t('dashboard.assignments.editor.task_editor.general.title')} message={formik.errors.title} />
                <Form.Control asChild>
                    <Input
                        onChange={formik.handleChange}
                        value={formik.values.title}
                        type="text"
                    />
                </Form.Control>
            </FormField>

            <FormField name="description">
                <FormLabelAndMessage label={t('dashboard.assignments.editor.task_editor.general.description')} message={formik.errors.description} />
                <Form.Control asChild>
                    <Input
                        onChange={formik.handleChange}
                        value={formik.values.description}
                        type="text"
                    />
                </Form.Control>
            </FormField>

            <FormField name="hint">
                <FormLabelAndMessage label={t('dashboard.assignments.editor.task_editor.general.hint')} message={formik.errors.hint} />
                <Form.Control asChild>
                    <Textarea
                        onChange={formik.handleChange}
                        value={formik.values.hint}
                    />
                </Form.Control>
            </FormField>

            <FormField name="hint">
                <div className='flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1'>
                    <FormLabelAndMessage label={t('dashboard.assignments.editor.task_editor.general.reference_file')} message={formik.errors.hint} />
                    <div className='flex gap-1.5 text-xs items-center text-neutral-500'>
                        <Info size={14} className='shrink-0' />
                        <p>{t('dashboard.assignments.editor.task_editor.general.reference_file_info')}</p>
                    </div>
                </div>
                <Form.Control asChild>
                    <UpdateTaskRef />
                </Form.Control>
            </FormField>

            {/* Submit button */}
            <Form.Submit asChild>
                <button
                    type="submit"
                    className="inline-flex items-center justify-center gap-1.5 w-full sm:w-auto h-10 px-5 mt-4 rounded-xl bg-neutral-900 text-white text-sm font-semibold hover:bg-neutral-800 transition-colors"
                >
                    <Check size={16} />
                    {t('common.save_changes')}
                </button>
            </Form.Submit>


        </FormLayout>
    )
}

function UpdateTaskRef() {
    const { t } = useTranslation()
    const session = useLHSession() as any;
    const org = useOrg() as any;
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
            toast.success(t('dashboard.assignments.editor.task_editor.general.reference_file_updated'))
            setIsLoading(false)
            setError('')
        }
    }

    const getTaskRefDirUI = () => {
        return getTaskRefFileDir(
            org?.org_uuid,
            assignment.course_object.course_uuid,
            assignment.activity_object.activity_uuid,
            assignment.assignment_object.assignment_uuid,
            assignmentTaskState.assignmentTask.assignment_task_uuid,
            assignmentTaskState.assignmentTask.reference_file
        )
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
        const res = await getActivityByID(assignment.assignment_object.activity_id, null, access_token)
        setActivity(res.data)
    }



    useEffect(() => {
        getActivityUI()
    }
        , [assignmentTaskState, org])



    return (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50/60 px-4 py-6 text-center">
            {error && (
                <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div>
            )}

            {assignmentTaskState.assignmentTask.reference_file && !isLoading && (
                <div className='flex items-center gap-3 rounded-xl bg-white nice-shadow ps-3 pe-2 py-2 max-w-full'>
                    <span className='w-9 h-9 rounded-lg bg-neutral-100 text-neutral-500 flex items-center justify-center shrink-0'>
                        <File size={18} />
                    </span>
                    <span className='text-sm font-semibold text-neutral-800 uppercase'>
                        {assignmentTaskState.assignmentTask.reference_file.split('.').pop()}
                    </span>
                    <Link
                        href={getTaskRefDirUI()}
                        download
                        target='_blank'
                        className='inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-neutral-100 text-neutral-800 text-xs font-semibold hover:bg-neutral-200 transition-colors'
                    >
                        <Download size={14} />
                        {t('dashboard.assignments.editor.task_editor.general.download')}
                    </Link>
                </div>
            )}

            <input
                type="file"
                accept={SUPPORTED_FILES}
                id="fileInput"
                style={{ display: 'none' }}
                onChange={handleFileChange}
            />
            {isLoading ? (
                <div className="inline-flex items-center gap-2 h-9 px-4 rounded-xl bg-neutral-100 text-sm font-semibold text-neutral-600">
                    <Loader size={16} className="animate-spin" />
                    <span>{t('dashboard.assignments.editor.task_editor.general.loading')}</span>
                </div>
            ) : (
                <button
                    type="button"
                    className="inline-flex items-center gap-2 h-9 px-4 rounded-xl bg-white nice-shadow text-sm font-semibold text-neutral-800 hover:bg-neutral-50 transition-colors"
                    onClick={() => document.getElementById('fileInput')?.click()}
                >
                    <UploadCloud size={16} />
                    <span>{t('dashboard.assignments.editor.task_editor.general.change_reference_file')}</span>
                </button>
            )}
        </div>
    )
}
