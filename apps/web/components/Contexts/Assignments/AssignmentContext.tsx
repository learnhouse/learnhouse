'use client'
import { getAPIUrl } from '@services/config/config'
import { apiFetch } from '@services/utils/ts/requests'
import React, { createContext, useContext, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { useLHSession } from '@components/Contexts/LHSessionContext'

export const AssignmentContext = createContext({})

// `lang` (learner view only): the content language list, so the assignment
// and task texts come in the published translation. Uuids are the same in
// every language, so submissions and grading don't change.
export function AssignmentProvider({ children, assignment_uuid, lang }: { children: React.ReactNode, assignment_uuid: string, lang?: string }) {
    const session = useLHSession() as any
    const accessToken = session?.data?.tokens?.access_token
    const langQs = lang ? `?lang=${encodeURIComponent(lang)}` : ''

    const { data: assignment, error: assignmentError } = useQuery({
        queryKey: queryKeys.assignments.detail(assignment_uuid, lang || undefined),
        queryFn: () => apiFetch(`${getAPIUrl()}assignments/${assignment_uuid}${langQs}`, accessToken),
        enabled: !!(assignment_uuid && accessToken),
        staleTime: 60_000,
    })

    const { data: assignment_tasks, error: assignmentTasksError } = useQuery({
        queryKey: queryKeys.assignments.tasks(assignment_uuid, lang || undefined),
        queryFn: () => apiFetch(`${getAPIUrl()}assignments/${assignment_uuid}/tasks${langQs}`, accessToken),
        enabled: !!(assignment_uuid && accessToken),
        staleTime: 60_000,
    })

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
