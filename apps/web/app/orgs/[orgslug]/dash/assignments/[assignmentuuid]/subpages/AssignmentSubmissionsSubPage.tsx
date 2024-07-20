import { useLHSession } from '@components/Contexts/LHSessionContext';
import { getAPIUrl } from '@services/config/config'
import { swrFetcher } from '@services/utils/ts/requests';
import React from 'react'
import useSWR from 'swr';

function AssignmentSubmissionsSubPage({ assignment_uuid }: { assignment_uuid: string }) {
    const session = useLHSession() as any;
    const access_token = session?.data?.tokens?.access_token;

    const { data: assignmentSubmission, error: assignmentError } = useSWR(
        `${getAPIUrl()}assignments/assignment_${assignment_uuid}/submissions`,
        (url) => swrFetcher(url, access_token)
    )
    return (
        <div className='pl-10 mr-10 flex'>
            {assignmentSubmission && assignmentSubmission.length > 0 && (
                <div>s</div>
            )}

        </div>
    )
}

export default AssignmentSubmissionsSubPage