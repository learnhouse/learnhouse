'use client'
import { getAPIUrl } from '@services/config/config'
import { swrFetcher } from '@services/utils/ts/requests'
import React, { createContext, useContext, useMemo } from 'react'
import useSWR from 'swr'
import { useLHSession } from '@components/Contexts/LHSessionContext'

export const AssignmentContext = createContext({})

export function AssignmentProvider({ children, assignment_uuid }: { children: React.ReactNode, assignment_uuid: string }) {
    const session = useLHSession() as any
    const accessToken = session?.data?.tokens?.access_token

    const { data: assignment, error: assignmentError } = useSWR(
        `${getAPIUrl()}assignments/${assignment_uuid}`,
        (url) => swrFetcher(url, accessToken)
    )

    const { data: assignment_tasks, error: assignmentTasksError } = useSWR(
        `${getAPIUrl()}assignments/${assignment_uuid}/tasks`,
        (url) => swrFetcher(url, accessToken)
    )

    // course_uuid/activity_uuid are now embedded in the assignment payload
    // (joined server-side) so we don't need separate /courses/id and
    // /activities/id round trips. We synthesize tiny shim objects to keep
    // existing consumers (which read .course_uuid / .activity_uuid) working
    // without changes. useMemo (vs useState+useEffect) means the provider
    // value is correct on the same render the SWR data lands, with no
    // wasted null-context render cycle.
    const assignmentsFull = useMemo(() => {
        if (!assignment || !assignment_tasks) return null
        return {
            assignment_object: assignment,
            assignment_tasks: assignment_tasks,
            course_object: assignment.course_uuid
                ? { course_uuid: assignment.course_uuid }
                : null,
            activity_object: assignment.activity_uuid
                ? { activity_uuid: assignment.activity_uuid }
                : null,
        }
    }, [assignment, assignment_tasks])

    if (assignmentError || assignmentTasksError) return <div></div>

    if (!assignmentsFull) return <div></div>

    return <AssignmentContext.Provider value={assignmentsFull}>{children}</AssignmentContext.Provider>
}

export function useAssignments() {
    return useContext(AssignmentContext)
}
