import { useAssignments } from '@components/Contexts/Assignments/AssignmentContext';
import { useAssignmentsTask, useAssignmentsTaskDispatch } from '@components/Contexts/Assignments/AssignmentsTaskContext';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import React, { useEffect } from 'react'
import TaskQuizObject from './TaskTypes/TaskQuizObject';

function AssignmentTaskContentEdit() {
    const session = useLHSession() as any;
    const access_token = session?.data?.tokens?.access_token;
    const assignmentTaskStateHook = useAssignmentsTaskDispatch() as any
    const assignment = useAssignments() as any

    useEffect(() => {
    }
        , [assignment, assignmentTaskStateHook])

    return (
        <div>
            <TaskQuizObject />
        </div>
    )
}

export default AssignmentTaskContentEdit