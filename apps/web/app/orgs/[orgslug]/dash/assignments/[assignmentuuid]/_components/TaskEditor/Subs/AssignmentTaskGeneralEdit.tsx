'use client'
import { constructAcceptValue } from '@/lib/constants'
import { useAssignments } from '@components/Contexts/Assignments/AssignmentContext'
import {
  useAssignmentsTask,
  useAssignmentsTaskDispatch,
} from '@components/Contexts/Assignments/AssignmentsTaskContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import FormLayout, {
  FormField,
  FormLabelAndMessage,
  Input,
  Textarea,
} from '@components/Objects/StyledElements/Form/Form'
import * as Form from '@radix-ui/react-form'
import { getActivityByID } from '@services/courses/activities'
import {
  updateAssignmentTask,
  updateReferenceFile,
} from '@services/courses/assignments'
import { getTaskRefFileDir } from '@services/media/media'
import { useFormik } from 'formik'
import { Cloud, File, Info, Loader, UploadCloud } from 'lucide-react'
import Link from 'next/link'
import React, { useEffect } from 'react'
import toast from 'react-hot-toast'

const SUPPORTED_FILES = constructAcceptValue([
  'pdf',
  'docx',
  'mp4',
  'jpg',
  'png',
  'pptx',
  'zip',
])

export function AssignmentTaskGeneralEdit() {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const assignmentTaskState = useAssignmentsTask() as any
  const assignmentTaskStateHook = useAssignmentsTaskDispatch() as any
  const assignment = useAssignments() as any

  const validate = (values: any) => {
    const errors: any = {}
    if (values.max_grade_value < 20 || values.max_grade_value > 100) {
      errors.max_grade_value = 'Value should be between 20 and 100'
    }
    return errors
  }

  const formik = useFormik({
    initialValues: {
      title: assignmentTaskState.assignmentTask.title,
      description: assignmentTaskState.assignmentTask.description,
      hint: assignmentTaskState.assignmentTask.hint,
      max_grade_value: assignmentTaskState.assignmentTask.max_grade_value,
    },
    validate,
    onSubmit: async (values) => {
      const res = await updateAssignmentTask(
        values,
        assignmentTaskState.assignmentTask.assignment_task_uuid,
        assignment.assignment_object.assignment_uuid,
        access_token
      )
      if (res) {
        assignmentTaskStateHook({ type: 'reload' })
        toast.success('Task updated successfully')
      } else {
        toast.error('Error updating task, please retry later.')
      }
    },
    enableReinitialize: true,
  }) as any

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
        <FormLabelAndMessage
          label="Description"
          message={formik.errors.description}
        />
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
          <Textarea onChange={formik.handleChange} value={formik.values.hint} />
        </Form.Control>
      </FormField>

      <FormField name="hint">
        <div className="flex items-center justify-between space-x-3">
          <FormLabelAndMessage
            label="Reference file"
            message={formik.errors.hint}
          />
          <div className="flex items-center space-x-1.5 text-xs text-gray-500">
            <Info size={16} />
            <p>Allowed formats : pdf, docx, mp4, jpg, jpeg, png, pptx, zip</p>
          </div>
        </div>
        <Form.Control asChild>
          <UpdateTaskRef />
        </Form.Control>
      </FormField>

      <FormField name="max_grade_value">
        <FormLabelAndMessage
          label="Max Grade Value"
          message={formik.errors.max_grade_value}
        />
        <Form.Control asChild>
          <Input
            onChange={formik.handleChange}
            value={formik.values.max_grade_value}
            type="number"
          />
        </Form.Control>
      </FormField>

      {/* Submit button */}
      <Form.Submit>
        <button
          type="submit"
          className="mt-4 flex w-full items-center justify-center rounded-md bg-green-500 px-4 py-2 font-semibold text-white hover:bg-green-600"
        >
          Submit
        </button>
      </Form.Submit>
    </FormLayout>
  )
}

function UpdateTaskRef() {
  const session = useLHSession() as any
  const org = useOrg() as any
  const access_token = session?.data?.tokens?.access_token
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
      toast.success('Reference file updated successfully')
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
    const res = await getActivityByID(
      assignment.assignment_object.activity_id,
      null,
      access_token
    )
    setActivity(res.data)
  }

  useEffect(() => {
    getActivityUI()
  }, [assignmentTaskState, org])

  return (
    <div className="h-[200px] w-auto rounded-xl bg-gray-50 shadow-sm outline outline-1 outline-gray-200">
      <div className="flex h-full flex-col items-center justify-center">
        <div className="flex flex-col items-center justify-center">
          <div className="flex flex-col items-center justify-center">
            {error && (
              <div className="flex items-center justify-center space-x-2 rounded-md bg-red-200 p-2 text-red-950 shadow-xs transition-all">
                <div className="text-sm font-semibold">{error}</div>
              </div>
            )}
          </div>
          {assignmentTaskState.assignmentTask.reference_file && !isLoading && (
            <div className="nice-shadow relative flex flex-col items-center space-y-1 rounded-lg bg-white px-5 py-3 text-gray-400 shadow-lg">
              <div className="absolute top-0 right-0 flex translate-x-1/2 -translate-y-1/2 transform items-center justify-center rounded-full bg-green-500 px-1.5 py-1.5 text-white">
                <Cloud size={15} />
              </div>
              <File size={20} className="" />
              <div className="text-sm font-semibold uppercase">
                {assignmentTaskState.assignmentTask.reference_file
                  .split('.')
                  .pop()}
              </div>
              <div className="mt-2 flex space-x-2">
                <Link
                  href={getTaskRefDirUI()}
                  download
                  target="_blank"
                  className="rounded-full bg-blue-500 px-3 py-1 text-xs font-semibold text-white"
                >
                  Download
                </Link>
                {/** <button onClick={() => deleteReferenceFile()}
                                    className='bg-red-500 text-white px-3 py-1 rounded-full text-xs font-semibold'>Delete</button> */}
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center">
              <input
                type="file"
                accept={SUPPORTED_FILES}
                id="fileInput"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
              <div className="text-gray mt-4 flex animate-pulse items-center rounded-md bg-slate-200 px-4 py-2 text-sm font-bold antialiased">
                <Loader size={16} className="mr-2" />
                <span>Loading</span>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center">
              <input
                type="file"
                accept={SUPPORTED_FILES}
                id="fileInput"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
              <button
                className="text-gray mt-6 flex items-center rounded-md px-4 text-sm font-bold antialiased"
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
