const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export async function getPeerSubmissions(courseId: string) {
  const res = await fetch(`${API_BASE}/api/v1/courses/peer-coursework/submissions?course_id=${courseId}`, {
    credentials: 'include',
    cache: 'no-store',
  })

  if (!res.ok) {
    throw new Error('Failed to load submissions')
  }

  return res.json()
}

export async function submitPeerSubmission(input: {
  courseId: string
  activityId: string
  studentId: string
  content: string
}) {
  const res = await fetch(`${API_BASE}/api/v1/courses/peer-coursework/submissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  })

  const data = await res.json()

  if (!res.ok) {
    throw new Error(data.detail || 'Failed to submit work')
  }

  return data
}

export async function assignPeerReviewer(input: {
  submissionId: string
  reviewerId: string
}) {
  const res = await fetch(`${API_BASE}/api/v1/courses/peer-coursework/assign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  })

  const data = await res.json()

  if (!res.ok) {
    throw new Error(data.detail || 'Failed to assign reviewer')
  }

  return data
}

export async function getAssignedPeerReviews(reviewerId: string) {
  const res = await fetch(`${API_BASE}/api/v1/courses/peer-coursework/reviews?reviewer_id=${reviewerId}`, {
    credentials: 'include',
    cache: 'no-store',
  })

  if (!res.ok) {
    throw new Error('Failed to load assigned reviews')
  }

  return res.json()
}

export async function submitPeerReview(input: {
  submissionId: string
  reviewerId: string
  feedback: string
}) {
  const res = await fetch(`${API_BASE}/api/v1/courses/peer-coursework/review-submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  })

  const data = await res.json()

  if (!res.ok) {
    throw new Error(data.detail || 'Failed to submit review')
  }

  return data
}

export async function getPeerFeedback(studentId: string) {
  const res = await fetch(`${API_BASE}/api/v1/courses/peer-coursework/feedback?student_id=${studentId}`, {
    credentials: 'include',
    cache: 'no-store',
  })

  if (!res.ok) {
    throw new Error('Failed to load feedback')
  }

  return res.json()
}