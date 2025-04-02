import { useAssignmentsTaskDispatch } from '@components/Contexts/Assignments/AssignmentsTaskContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl } from '@services/config/config'
import { createAssignmentTask } from '@services/courses/assignments'
import { AArrowUp, FileUp, ListTodo } from 'lucide-react'
import { useRef } from 'react'
import toast from 'react-hot-toast'
import { mutate } from 'swr'

function NewTaskModal({ closeModal, assignment_uuid }: any) {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const reminderShownRef = useRef(false)
  const assignmentTaskStateHook = useAssignmentsTaskDispatch() as any

  function showReminderToast() {
    // Check if the reminder has already been shown using sessionStorage
    if (sessionStorage.getItem('TasksReminderShown') !== 'true') {
      setTimeout(() => {
        toast(
          'When editing/adding your tasks, make sure to Unpublish your Assignment to avoid any issues with students, you can Publish it again when you are ready.',
          { icon: '✋', duration: 10000, style: { minWidth: 600 } }
        )
        // Mark the reminder as shown in sessionStorage
        sessionStorage.setItem('TasksReminderShown', 'true')
      }, 3000)
    }
  }

  async function createTask(type: string) {
    const task_object = {
      title: 'Untitled Task',
      description: '',
      hint: '',
      reference_file: '',
      assignment_type: type,
      contents: {},
      max_grade_value: 100,
    }
    const res = await createAssignmentTask(
      task_object,
      assignment_uuid,
      access_token
    )
    toast.success('Task created successfully')
    showReminderToast()
    mutate(`${getAPIUrl()}assignments/${assignment_uuid}/tasks`)
    assignmentTaskStateHook({
      type: 'setSelectedAssignmentTaskUUID',
      payload: res.data.assignment_task_uuid,
    })
    closeModal(false)
  }

  return (
    <div className="mx-auto flex items-center justify-center space-x-6">
      <div
        onClick={() => createTask('QUIZ')}
        className="flex flex-col justify-center space-y-2 pt-10 text-center"
      >
        <div className="nice-shadow mx-auto w-fit cursor-pointer rounded-full bg-gray-100/50 px-5 py-5 text-gray-500 transition-all ease-linear hover:bg-gray-100">
          <ListTodo size={30} />
        </div>
        <p className="text-xl font-semibold text-gray-700">Quiz</p>
        <p className="w-40 text-sm text-gray-500">
          Questions with multiple choice answers
        </p>
      </div>
      <div
        onClick={() => createTask('FILE_SUBMISSION')}
        className="flex flex-col justify-center space-y-2 pt-10 text-center"
      >
        <div className="nice-shadow mx-auto w-fit cursor-pointer rounded-full bg-gray-100/50 px-5 py-5 text-gray-500 transition-all ease-linear hover:bg-gray-100">
          <FileUp size={30} />
        </div>
        <p className="text-xl font-semibold text-gray-700">File submission</p>
        <p className="w-40 text-sm text-gray-500">
          Students can submit files for this task
        </p>
      </div>
      <div
        onClick={() => toast.error('Forms are not yet supported')}
        className="flex flex-col justify-center space-y-2 pt-10 text-center opacity-25"
      >
        <div className="nice-shadow mx-auto w-fit cursor-pointer rounded-full bg-gray-100/50 px-5 py-5 text-gray-500 transition-all ease-linear hover:bg-gray-100">
          <AArrowUp size={30} />
        </div>
        <p className="text-xl font-semibold text-gray-700">Form</p>
        <p className="w-40 text-sm text-gray-500">
          Forms for students to fill out
        </p>
      </div>
    </div>
  )
}

export default NewTaskModal
