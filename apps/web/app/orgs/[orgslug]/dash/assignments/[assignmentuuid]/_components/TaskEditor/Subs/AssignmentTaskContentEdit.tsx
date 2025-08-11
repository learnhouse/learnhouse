import { useAssignmentsTask, useAssignmentsTaskDispatch } from '@components/Contexts/Assignments/AssignmentsTaskContext';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import React, { useEffect } from 'react'
import TaskQuizObject from './TaskTypes/TaskQuizObject';
import TaskFileObject from './TaskTypes/TaskFileObject';
import TaskFormObject from './TaskTypes/TaskFormObject';

function AssignmentTaskContentEdit() {
    const session = useLHSession() as any;
    const access_token = session?.data?.tokens?.access_token;
    const assignmentTaskStateHook = useAssignmentsTaskDispatch() as any
    const assignment_task = useAssignmentsTask() as any

    useEffect(() => {
    }
        , [assignment_task, assignmentTaskStateHook])

    return (
        <div>
            {assignment_task?.assignmentTask.assignment_type === 'QUIZ' && <TaskQuizObject view='teacher' />}
            {assignment_task?.assignmentTask.assignment_type === 'FILE_SUBMISSION' && <TaskFileObject view='teacher' />}
            {assignment_task?.assignmentTask.assignment_type === 'FORM' && <TaskFormObject view='teacher' assignmentTaskUUID={assignment_task?.assignmentTask.assignment_task_uuid} />}
        </div>
    )
}

export default AssignmentTaskContentEdit