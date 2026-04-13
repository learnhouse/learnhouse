'use client'
import React from 'react'
import { useLHSession } from '../LHSessionContext'
import { getAPIUrl } from '@services/config/config'
import { swrFetcher } from '@services/utils/ts/requests'
import useSWR from 'swr'

export const AssignmentSubmissionContext = React.createContext({})
export const AssignmentTaskSubmissionsContext = React.createContext<Record<string, any> | null>(null)

function AssignmentSubmissionProvider({ children, assignment_uuid }: { children: React.ReactNode, assignment_uuid: string }) {
    const session = useLHSession() as any
    const accessToken = session?.data?.tokens?.access_token

    const { data: assignmentSubmission } = useSWR(
        `${getAPIUrl()}assignments/${assignment_uuid}/submissions/me`,
        (url) => swrFetcher(url, accessToken)
    )

    // Single batch fetch of every per-task submission for this user. Replaces
    // N per-task /submissions/me calls that each Task*Object used to make.
    const { data: taskSubmissionsMap } = useSWR(
        `${getAPIUrl()}assignments/${assignment_uuid}/tasks/submissions/me`,
        (url) => swrFetcher(url, accessToken)
    )

    return (
        <AssignmentSubmissionContext.Provider value={assignmentSubmission}>
            <AssignmentTaskSubmissionsContext.Provider value={taskSubmissionsMap ?? null}>
                {children}
            </AssignmentTaskSubmissionsContext.Provider>
        </AssignmentSubmissionContext.Provider>
    )
}

export function useAssignmentSubmission() {
    return React.useContext(AssignmentSubmissionContext)
}

export function useAssignmentTaskSubmissions() {
    return React.useContext(AssignmentTaskSubmissionsContext)
}

export default AssignmentSubmissionProvider