import { getAPIUrl } from '@services/config/config'
import { RequestBodyWithAuthHeader, errorHandling } from '@services/utils/ts/requests'
import type {
  PeerReview,
  PeerReviewOverview,
  PeerReviewSettings,
  PeerReviewSettingsUpdate,
  PeerReviewSubmissionDetail,
} from '@services/courses/peerReview'

// Instructor-side peer review calls (dash/assignments/[uuid]?subpage=peer-review).
// Shared types live in ./peerReview. Every helper throws on a non-2xx response
// (an Error with `status` and `detail`, see errorHandling).

const base = (assignmentUUID: string) => `${getAPIUrl()}assignments/${assignmentUUID}/peer-review`

async function call<T>(url: string, method: string, body: unknown, accessToken: string): Promise<T> {
  const res = await fetch(url, RequestBodyWithAuthHeader(method, body ?? null, null, accessToken))
  return errorHandling(res) as Promise<T>
}

/** Full settings, calibration answers included (instructor view). */
export function fetchPeerReviewSettings(assignmentUUID: string, accessToken: string) {
  return call<PeerReviewSettings>(`${base(assignmentUUID)}/settings`, 'GET', null, accessToken)
}

export function savePeerReviewSettings(assignmentUUID: string, body: PeerReviewSettingsUpdate, accessToken: string) {
  return call<PeerReviewSettings>(`${base(assignmentUUID)}/settings`, 'PUT', body, accessToken)
}

export function fetchPeerReviewOverview(assignmentUUID: string, accessToken: string) {
  return call<PeerReviewOverview>(`${base(assignmentUUID)}/overview`, 'GET', null, accessToken)
}

export function fetchPeerReviewSubmission(assignmentUUID: string, userId: number | string, accessToken: string) {
  return call<PeerReviewSubmissionDetail>(`${base(assignmentUUID)}/submissions/${userId}`, 'GET', null, accessToken)
}

export function discardPeerReviewAsInstructor(assignmentUUID: string, reviewUUID: string, reason: string, accessToken: string) {
  return call<PeerReview>(`${base(assignmentUUID)}/reviews/${reviewUUID}/discard`, 'POST', { reason }, accessToken)
}

export function restorePeerReviewAsInstructor(assignmentUUID: string, reviewUUID: string, accessToken: string) {
  return call<PeerReview>(`${base(assignmentUUID)}/reviews/${reviewUUID}/restore`, 'POST', {}, accessToken)
}

// React-query keys: queryKeys.peerReview in lib/query/keys (shared with the learner view).
