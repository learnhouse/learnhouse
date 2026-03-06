import { randomUUID } from 'crypto'

export type PeerSubmission = {
  id: string
  activityId: string
  studentId: string
  content: string
  createdAt: string
}

export type PeerReview = {
  id: string
  submissionId: string
  reviewerId: string
  feedback: string | null
  score: number | null
  createdAt: string
}

type PeerActivity = {
  id: string
  courseId: string
  title: string
  description: string
  dueDate: string
  peerReviewEnabled: boolean
  createdAt: string
}

type PeerStore = {
  peerActivities: PeerActivity[]
  peerSubmissions: PeerSubmission[]
  peerReviews: PeerReview[]
}

declare global {
  // eslint-disable-next-line no-var
  var __peerStore: PeerStore | undefined
}

const store: PeerStore =
  globalThis.__peerStore ??
  {
    peerActivities: [
      {
        id: 'activity-1',
        courseId: 'course-1',
        title: 'Simple Peer Activity',
        description: 'Write a short paragraph about what you learned today.',
        dueDate: '2026-03-20T23:59:59.000Z',
        peerReviewEnabled: true,
        createdAt: new Date().toISOString(),
      },
    ],
    peerSubmissions: [],
    peerReviews: [],
  }

globalThis.__peerStore = store

export function submitPeerSubmission(input: {
  activityId: string
  studentId: string
  content: string
}): PeerSubmission {
  const existing = store.peerSubmissions.find(
    (s) => s.activityId === input.activityId && s.studentId === input.studentId
  )

  if (existing) {
    throw new Error('You have already submitted for this activity.')
  }

  if (!input.content.trim()) {
    throw new Error('Submission content is required.')
  }

  const submission: PeerSubmission = {
    id: randomUUID(),
    activityId: input.activityId,
    studentId: input.studentId,
    content: input.content,
    createdAt: new Date().toISOString(),
  }

  store.peerSubmissions.push(submission)
  return submission
}

export function getAllSubmissions() {
  return store.peerSubmissions
}

export function assignReviewer(input: {
  submissionId: string
  reviewerId: string
}): PeerReview {
  const submission = store.peerSubmissions.find(
    (s) => s.id === input.submissionId
  )

  if (!submission) {
    throw new Error('Submission not found.')
  }

  if (submission.studentId === input.reviewerId) {
    throw new Error('A student cannot review their own submission.')
  }

  const existing = store.peerReviews.find(
    (r) =>
      r.submissionId === input.submissionId &&
      r.reviewerId === input.reviewerId
  )

  if (existing) {
    throw new Error('This reviewer is already assigned.')
  }

  const review: PeerReview = {
    id: randomUUID(),
    submissionId: input.submissionId,
    reviewerId: input.reviewerId,
    feedback: null,
    score: null,
    createdAt: new Date().toISOString(),
  }

  store.peerReviews.push(review)
  return review
}

export function getAssignedReviewsForStudent(reviewerId: string) {
  return store.peerReviews
    .filter((r) => r.reviewerId === reviewerId)
    .map((r) => {
      const submission = store.peerSubmissions.find(
        (s) => s.id === r.submissionId
      )

      return {
        reviewId: r.id,
        submissionId: r.submissionId,
        feedback: r.feedback,
        score: r.score,
        submission,
      }
    })
}

export function submitPeerReview(input: {
  submissionId: string
  reviewerId: string
  feedback: string
  score?: number | null
}) {
  const review = store.peerReviews.find(
    (r) =>
      r.submissionId === input.submissionId &&
      r.reviewerId === input.reviewerId
  )

  if (!review) {
    throw new Error('Review assignment not found.')
  }

  if (!input.feedback.trim()) {
    throw new Error('Feedback is required.')
  }

  review.feedback = input.feedback
  review.score = input.score ?? null

  return review
}

export function getFeedbackForStudent(studentId: string) {
  const studentSubmissions = store.peerSubmissions.filter(
    (s) => s.studentId === studentId
  )

  return studentSubmissions.map((submission) => {
    const reviewsForSubmission = store.peerReviews
      .filter((r) => r.submissionId === submission.id)
      .map((review) => ({
        reviewId: review.id,
        reviewerId: review.reviewerId,
        feedback: review.feedback,
        score: review.score,
        createdAt: review.createdAt,
      }))

    return {
      submission,
      reviews: reviewsForSubmission,
    }
  })
}