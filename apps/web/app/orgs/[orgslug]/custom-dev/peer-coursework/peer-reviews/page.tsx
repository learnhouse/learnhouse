'use client'

import { useEffect, useState } from 'react'
import { getAssignedPeerReviews, submitPeerReview } from '@/services/custom-dev/peer-coursework/peerCourseworkService'

type AssignedReview = {
  review_id: string
  submission_id: string
  feedback: string | null
  submission?: {
    id: string
    activity_id: string
    course_id: string
    student_id: string
    content: string
    created_at: string
  }
}

export default function PeerReviewsPage() {
  const [reviewerId, setReviewerId] = useState('student-b')
  const [assignedReviews, setAssignedReviews] = useState<AssignedReview[]>([])
  const [feedbackMap, setFeedbackMap] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')

  async function loadReviews(currentReviewerId: string) {
    try {
      const data = await getAssignedPeerReviews(currentReviewerId)
      setAssignedReviews(data)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Failed to load assigned reviews')
    }
  }

  useEffect(() => {
    loadReviews(reviewerId)
  }, [reviewerId])

  async function handleSubmitReview(submissionId: string) {
    setMessage('')

    const feedback = feedbackMap[submissionId] || ''

    try {
      await submitPeerReview({
        submission_id: submissionId,
        reviewer_id: reviewerId,
        feedback,
      } as any)

      setMessage('Review submitted successfully')
      loadReviews(reviewerId)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Failed to submit review')
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">My Peer Reviews</h1>

      <label className="block mb-2 font-medium">Reviewer ID</label>
      <select
        className="border rounded px-3 py-2 mb-6 w-full"
        value={reviewerId}
        onChange={(e) => setReviewerId(e.target.value)}
      >
        <option value="student-a">student-a</option>
        <option value="student-b">student-b</option>
        <option value="student-c">student-c</option>
        <option value="student-d">student-d</option>
      </select>

      {assignedReviews.length === 0 && <p>No assigned reviews yet.</p>}

      <div className="space-y-6">
        {assignedReviews.map((item) => (
          <div key={item.review_id} className="border rounded p-4">
            <p className="font-semibold mb-2">
              Submission by: {item.submission?.student_id}
            </p>

            <div className="border rounded p-3 bg-gray-50 mb-4 whitespace-pre-wrap">
              {item.submission?.content}
            </div>

            <textarea
              className="border rounded px-3 py-2 w-full min-h-[120px]"
              placeholder="Write feedback here..."
              value={feedbackMap[item.submission_id] ?? item.feedback ?? ''}
              onChange={(e) =>
                setFeedbackMap((prev) => ({
                  ...prev,
                  [item.submission_id]: e.target.value,
                }))
              }
            />

            <button
              onClick={() => handleSubmitReview(item.submission_id)}
              className="mt-3 bg-black text-white px-4 py-2 rounded"
            >
              Submit Review
            </button>
          </div>
        ))}
      </div>

      {message && <p className="mt-4">{message}</p>}
    </div>
  )
}