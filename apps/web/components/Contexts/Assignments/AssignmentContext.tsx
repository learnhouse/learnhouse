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
    const [assignmentsFull, setAssignmentsFull] = React.useState({ assignment_object: null, assignment_tasks: null, course_object: null , activity_object: null})

    const { data: assignment, error: assignmentError } = useSWR(
        `${getAPIUrl()}assignments/${assignment_uuid}`,
        (url) => swrFetcher(url, accessToken)
    )

    const { data: assignment_tasks, error: assignmentTasksError } = useSWR(
        `${getAPIUrl()}assignments/${assignment_uuid}/tasks`,
        (url) => swrFetcher(url, accessToken)
    )

    const course_id = assignment?.course_id

    const { data: course_object, error: courseObjectError } = useSWR(
        course_id ? `${getAPIUrl()}courses/id/${course_id}` : null,
        (url) => swrFetcher(url, accessToken)
    )

    const activity_id = assignment?.activity_id

    const { data: activity_object, error: activityObjectError } = useSWR(
        activity_id ? `${getAPIUrl()}activities/id/${activity_id}` : null,
        (url) => swrFetcher(url, accessToken)
    )

    useEffect(() => {
        if (assignment && assignment_tasks && (!course_id || course_object) && (!activity_id || activity_object)) {
            setAssignmentsFull({ assignment_object: assignment, assignment_tasks: assignment_tasks, course_object: course_object, activity_object: activity_object })
        }
    }, [assignment, assignment_tasks, course_object, activity_object, course_id, activity_id])

    if (assignmentError || assignmentTasksError || courseObjectError || activityObjectError) return <div></div>

    if (!assignment || !assignment_tasks || (course_id && !course_object) || (activity_id && !activity_object)) return <div></div>

    return <AssignmentContext.Provider value={assignmentsFull}>{children}</AssignmentContext.Provider>
}

export function useAssignments() {
    return useContext(AssignmentContext)
}
