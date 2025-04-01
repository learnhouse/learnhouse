import { AssignmentProvider } from '@components/Contexts/Assignments/AssignmentContext'
import AssignmentSubmissionProvider from '@components/Contexts/Assignments/AssignmentSubmissionContext'
import { AssignmentsTaskProvider } from '@components/Contexts/Assignments/AssignmentsTaskContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import UserAvatar from '@components/Objects/UserAvatar'
import { getAPIUrl } from '@services/config/config'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import { swrFetcher } from '@services/utils/ts/requests'
import { SendHorizonal, UserCheck, X } from 'lucide-react'
import React, { useEffect } from 'react'
import useSWR from 'swr'
import EvaluateAssignment from './Modals/EvaluateAssignment'

function AssignmentSubmissionsSubPage({
  assignment_uuid,
}: {
  assignment_uuid: string
}) {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const { data: assignmentSubmission, error: assignmentError } = useSWR(
    `${getAPIUrl()}assignments/assignment_${assignment_uuid}/submissions`,
    (url) => swrFetcher(url, access_token)
  )

  useEffect(() => {
    console.log(assignmentSubmission)
  }, [session, assignmentSubmission])

  const renderSubmissions = (status: string) => {
    return assignmentSubmission
      ?.filter((submission: any) => submission.submission_status === status)
      .map((submission: any) => (
        <SubmissionBox
          key={submission.submission_uuid}
          submission={submission}
          assignment_uuid={assignment_uuid}
          user_id={submission.user_id}
        />
      ))
  }

  return (
    <div className="mr-10 flex w-full flex-col pt-3 pl-10">
      <div className="flex w-full flex-row">
        <div className="flex-1">
          <div className="mx-auto my-5 flex w-fit items-center space-x-2 rounded-full bg-rose-600/80 px-3.5 py-1 text-sm font-bold text-white">
            <X size={18} />
            <h3>Late</h3>
          </div>
          <div className="flex flex-col gap-4">{renderSubmissions('LATE')}</div>
        </div>
        <div className="flex-1">
          <div className="mx-auto my-5 flex w-fit items-center space-x-2 rounded-full bg-amber-600/80 px-3.5 py-1 text-sm font-bold text-white">
            <SendHorizonal size={18} />
            <h3>Submitted</h3>
          </div>
          <div className="flex flex-col gap-4">
            {renderSubmissions('SUBMITTED')}
          </div>
        </div>
        <div className="flex-1">
          <div className="mx-auto my-5 flex w-fit items-center space-x-2 rounded-full bg-emerald-600/80 px-3.5 py-1 text-sm font-bold text-white">
            <UserCheck size={18} />
            <h3>Graded</h3>
          </div>
          <div className="flex flex-col gap-4">
            {renderSubmissions('GRADED')}
          </div>
        </div>
      </div>
    </div>
  )
}

function SubmissionBox({ assignment_uuid, user_id, submission }: any) {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const [gradeSudmissionModal, setGradeSubmissionModal] = React.useState({
    open: false,
    submission_id: '',
  })

  const { data: user, error: userError } = useSWR(
    `${getAPIUrl()}users/id/${user_id}`,
    (url) => swrFetcher(url, access_token)
  )

  useEffect(() => {
    console.log(user)
  }, [session, user])

  return (
    <div className="nice-shadow mx-auto flex w-[350px] flex-row rounded-lg bg-white p-4 shadow-[0px_4px_16px_rgba(0,0,0,0.06)]">
      <div className="flex w-full flex-col space-y-2">
        <div className="flex w-full justify-between">
          <h2 className="text-xs font-semibold tracking-tight text-slate-400 uppercase">
            Submission
          </h2>
          <p className="text-xs font-semibold tracking-tight uppercase">
            {new Date(submission.creation_date).toLocaleDateString('en-UK', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        </div>
        <div className="flex justify-between space-x-2">
          <div className="flex space-x-2">
            <UserAvatar
              border="border-4"
              avatar_url={getUserAvatarMediaDirectory(
                user?.user_uuid,
                user?.avatar_image
              )}
              predefined_avatar={user?.avatar_image ? undefined : 'empty'}
              width={40}
            />
            <div className="flex flex-col">
              {user?.first_name && user?.last_name ? (
                <p className="text-sm font-semibold">
                  {user?.first_name} {user?.last_name}
                </p>
              ) : (
                <p className="text-sm font-semibold">@{user?.username}</p>
              )}
              <p className="text-xs text-slate-400">{user?.email}</p>
            </div>
          </div>
          <div className="flex flex-col">
            <Modal
              isDialogOpen={
                gradeSudmissionModal.open &&
                gradeSudmissionModal.submission_id ===
                  submission.submission_uuid
              }
              onOpenChange={(open: boolean) =>
                setGradeSubmissionModal({
                  open,
                  submission_id: submission.submission_uuid,
                })
              }
              minHeight="lg"
              minWidth="lg"
              dialogContent={
                <AssignmentProvider
                  assignment_uuid={'assignment_' + assignment_uuid}
                >
                  <AssignmentsTaskProvider>
                    <AssignmentSubmissionProvider
                      assignment_uuid={'assignment_' + assignment_uuid}
                    >
                      <EvaluateAssignment user_id={user_id} />
                    </AssignmentSubmissionProvider>
                  </AssignmentsTaskProvider>
                </AssignmentProvider>
              }
              dialogTitle={`Evaluate @${user?.username}`}
              dialogDescription="Evaluate the submission"
              dialogTrigger={
                <div className="cursor-pointer rounded bg-slate-800 px-4 py-2 text-xs font-bold text-white hover:bg-slate-700">
                  Evaluate
                </div>
              }
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export default AssignmentSubmissionsSubPage
