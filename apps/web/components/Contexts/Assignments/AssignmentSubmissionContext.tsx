'use client'
import { getAPIUrl } from '@services/config/config'
import { swrFetcher } from '@services/utils/ts/requests'
import type { ReactNode } from 'react'
import { createContext, use } from 'react'
import useSWR from 'swr'
import { useLHSession } from '../LHSessionContext'

export const AssignmentSubmissionContext = createContext({})

function AssignmentSubmissionProvider({
  children,
  assignment_uuid,
}: {
  children: ReactNode
  assignment_uuid: string
}) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token

  const { data: assignmentSubmission, error: assignmentError } = useSWR(
    `${getAPIUrl()}assignments/${assignment_uuid}/submissions/me`,
    (url) => swrFetcher(url, accessToken)
  )

  return (
    <AssignmentSubmissionContext value={assignmentSubmission}>
      {children}
    </AssignmentSubmissionContext>
  )
}

export function useAssignmentSubmission() {
  return use(AssignmentSubmissionContext)
}

export default AssignmentSubmissionProvider
