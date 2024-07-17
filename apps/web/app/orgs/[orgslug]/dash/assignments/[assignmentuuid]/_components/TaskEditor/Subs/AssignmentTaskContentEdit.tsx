import { useAssignmentsTask, useAssignmentsTaskDispatch } from '@components/Contexts/Assignments/AssignmentsTaskContext';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import React, { useEffect } from 'react'
import TaskQuizObject from './TaskTypes/TaskQuizObject';
import TaskFileObject from './TaskTypes/TaskFileObject';

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
            {assignment_task?.assignmentTask.assignment_type === 'QUIZ' && <TaskQuizObject />}
            {assignment_task?.assignmentTask.assignment_type === 'FILE_SUBMISSION' && <TaskFileObject view='teacher' />}
        </div>
    )
}

export default AssignmentTaskContentEdit