import { useAssignmentsTaskDispatch } from '@components/Contexts/Assignments/AssignmentsTaskContext';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import { getAPIUrl } from '@services/config/config';
import { createAssignmentTask } from '@services/courses/assignments'
import { AArrowUp, FileUp, ListTodo } from 'lucide-react'
import React from 'react'
import toast from 'react-hot-toast';
import { mutate } from 'swr';
import { useTranslation } from 'react-i18next';

function NewTaskModal({ closeModal, assignment_uuid }: any) {
  const { t } = useTranslation()
  const session = useLHSession() as any;
  const access_token = session?.data?.tokens?.access_token;
  const reminderShownRef = React.useRef(false);
  const assignmentTaskStateHook = useAssignmentsTaskDispatch() as any

  function showReminderToast() {
    // Check if the reminder has already been shown using sessionStorage
    if (sessionStorage.getItem("TasksReminderShown") !== "true") {
      setTimeout(() => {
        toast(t('dashboard.assignments.editor.toasts.reminder'),
              { icon: '✋', duration: 10000, style: { minWidth: 600 }  });
        // Mark the reminder as shown in sessionStorage
        sessionStorage.setItem("TasksReminderShown", "true");
      }, 3000);
    }
  }

  async function createTask(type: string) {
    const task_object = {
      title: "Untitled Task",
      description: "",
      hint: "",
      reference_file: "",
      assignment_type: type,
      contents: {},
      max_grade_value: 100,
    }
    const res = await createAssignmentTask(task_object, assignment_uuid, access_token)
    toast.success(t('dashboard.assignments.editor.toasts.task_created'))
    showReminderToast()
    mutate(`${getAPIUrl()}assignments/${assignment_uuid}/tasks`)
    assignmentTaskStateHook({ type: 'setSelectedAssignmentTaskUUID', payload: res.data.assignment_task_uuid })
    closeModal(false)
  }


  return (
    <div className='flex space-x-6 mx-auto justify-center items-center'>
      <div
        onClick={() => createTask('QUIZ')}
        className='flex flex-col space-y-2 justify-center  text-center pt-10'>
        <div className='px-5 py-5 rounded-full nice-shadow w-fit mx-auto bg-gray-100/50 text-gray-500 cursor-pointer hover:bg-gray-100 transition-all ease-linear'>
          <ListTodo size={30} />
        </div>
        <p className='text-xl text-gray-700 font-semibold'>{t('dashboard.assignments.editor.task_types.quiz.title')}</p>
        <p className='text-sm text-gray-500 w-40'>{t('dashboard.assignments.editor.task_types.quiz.description')}</p>
      </div>
      <div
        onClick={() => createTask('FILE_SUBMISSION')}
        className='flex flex-col space-y-2 justify-center  text-center pt-10'>
        <div className='px-5 py-5 rounded-full nice-shadow w-fit mx-auto bg-gray-100/50 text-gray-500 cursor-pointer hover:bg-gray-100 transition-all ease-linear'>
          <FileUp size={30} />
        </div>
        <p className='text-xl text-gray-700 font-semibold'>{t('dashboard.assignments.editor.task_types.file_submission.title')}</p>
        <p className='text-sm text-gray-500 w-40'>{t('dashboard.assignments.editor.task_types.file_submission.description')}</p>
      </div>
      <div
        onClick={() => createTask('FORM')}
        className='flex flex-col space-y-2 justify-center  text-center pt-10'>
        <div className='px-5 py-5 rounded-full nice-shadow w-fit mx-auto bg-gray-100/50 text-gray-500 cursor-pointer hover:bg-gray-100 transition-all ease-linear'>
          <AArrowUp size={30} />
        </div>
        <p className='text-xl text-gray-700 font-semibold'>{t('dashboard.assignments.editor.task_types.form.title')}</p>
        <p className='text-sm text-gray-500 w-40'>{t('dashboard.assignments.editor.task_types.form.description')}</p>
      </div>
    </div>
  )
}

export default NewTaskModal