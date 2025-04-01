import { useAssignments } from '@components/Contexts/Assignments/AssignmentContext'
import {
  useAssignmentsTask,
  useAssignmentsTaskDispatch,
} from '@components/Contexts/Assignments/AssignmentsTaskContext'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { FileUp, ListTodo, PanelLeftOpen, Plus } from 'lucide-react'
import React, { useEffect } from 'react'
import NewTaskModal from './Modals/NewTaskModal'

function AssignmentTasks({ assignment_uuid }: any) {
  const assignments = useAssignments() as any
  const assignmentTask = useAssignmentsTask() as any
  const assignmentTaskHook = useAssignmentsTaskDispatch() as any
  const [isNewTaskModalOpen, setIsNewTaskModalOpen] = React.useState(false)

  async function setSelectTask(task_uuid: string) {
    assignmentTaskHook({
      type: 'setSelectedAssignmentTaskUUID',
      payload: task_uuid,
    })
  }

  useEffect(() => {}, [assignments])

  return (
    <div className="flex w-full">
      <div className="mx-auto flex flex-col space-y-3">
        {assignments && assignments?.assignment_tasks?.length < 10 && (
          <Modal
            isDialogOpen={isNewTaskModalOpen}
            onOpenChange={setIsNewTaskModalOpen}
            minHeight="sm"
            minWidth="sm"
            dialogContent={
              <NewTaskModal
                assignment_uuid={assignment_uuid}
                closeModal={setIsNewTaskModalOpen}
              />
            }
            dialogTitle="Add an Assignment Task"
            dialogDescription="Create a new task for this assignment"
            dialogTrigger={
              <div className="flex cursor-pointer items-center justify-center space-x-1.5 rounded-md bg-black px-2 py-2 text-xs font-semibold text-white antialiased">
                <Plus size={17} />
                <p>Add Task</p>
              </div>
            }
          />
        )}
        {assignments &&
          assignments?.assignment_tasks?.map((task: any) => {
            return (
              <div
                key={task.id}
                className="nice-shadow flex w-[250px] flex-col rounded-md bg-white p-3 shadow-[0px_4px_16px_rgba(0,0,0,0.06)]"
                onClick={() => setSelectTask(task.assignment_task_uuid)}
              >
                <div className="flex items-center justify-between px-2">
                  <div className="flex items-center space-x-3">
                    <div className="text-gray-500">
                      {task.assignment_type === 'QUIZ' && (
                        <ListTodo size={15} />
                      )}
                      {task.assignment_type === 'FILE_SUBMISSION' && (
                        <FileUp size={15} />
                      )}
                    </div>
                    <div className="text-sm font-semibold">{task.title}</div>
                  </div>
                  <button
                    className={`outline outline-1 outline-gray-200 ${task.assignment_task_uuid == assignmentTask.selectedAssignmentTaskUUID ? 'bg-slate-100' : ''} rounded-md px-3 py-2 font-bold text-gray-500 transition-all ease-linear hover:bg-slate-100/50`}
                  >
                    <PanelLeftOpen size={16} />
                  </button>
                </div>
              </div>
            )
          })}
      </div>
    </div>
  )
}

export default AssignmentTasks
