'use client'
import { getAPIUrl } from '@services/config/config'
import { swrFetcher } from '@services/utils/ts/requests'
import React, { createContext, useContext, useEffect } from 'react'
import useSWR from 'swr'
import { useLHSession } from '@components/Contexts/LHSessionContext'

export const AssignmentContext = createContext({})

export function AssignmentProvider({ children, assignment_uuid }: { children: React.ReactNode, assignment_uuid: string }) {
    const session = useLHSession() as any
    const accessToken = session?.data?.tokens?.access_token
    const [assignmentsFull, setAssignmentsFull] = React.useState({ assignment_object: null, assignment_tasks: null })

    const { data: assignment, error: assignmentError } = useSWR(
        `${getAPIUrl()}assignments/${assignment_uuid}`,
        (url) => swrFetcher(url, accessToken)
    )

    const { data: assignment_tasks, error: assignmentTasksError } = useSWR(
        `${getAPIUrl()}assignments/${assignment_uuid}/tasks`,
        (url) => swrFetcher(url, accessToken)
    )

    useEffect(() => {
        setAssignmentsFull({ assignment_object: assignment, assignment_tasks: assignment_tasks })
    }
        , [assignment, assignment_tasks])

    if (assignmentError || assignmentTasksError) return <div></div>

    if (!assignment || !assignment_tasks) return <div></div>


    return <AssignmentContext.Provider value={assignmentsFull}>{children}</AssignmentContext.Provider>
}

export function useAssignments() {
    return useContext(AssignmentContext)
}
