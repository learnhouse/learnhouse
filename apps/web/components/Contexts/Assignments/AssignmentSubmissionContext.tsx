'use client'
import { getAPIUrl } from '@services/config/config'
import { swrFetcher } from '@services/utils/ts/requests'
import React from 'react'
import useSWR from 'swr'
import { useLHSession } from '../LHSessionContext'

export const AssignmentSubmissionContext = React.createContext({})

function AssignmentSubmissionProvider({
  children,
  assignment_uuid,
}: {
  children: React.ReactNode
  assignment_uuid: string
}) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token

  const { data: assignmentSubmission, error: assignmentError } = useSWR(
    `${getAPIUrl()}assignments/${assignment_uuid}/submissions/me`,
    (url) => swrFetcher(url, accessToken)
  )

  return (
    <AssignmentSubmissionContext.Provider value={assignmentSubmission}>
      {children}
    </AssignmentSubmissionContext.Provider>
  )
}

export function useAssignmentSubmission() {
  return React.useContext(AssignmentSubmissionContext)
}

export default AssignmentSubmissionProvider
