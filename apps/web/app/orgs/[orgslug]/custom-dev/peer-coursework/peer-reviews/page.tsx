'use client'

import { useEffect, useState } from 'react'

type AssignedReview = {
  reviewId: string
  submissionId: string
  feedback: string | null
  score: number | null
  submission?: {
    id: string
    activityId: string
    studentId: string
    content: string
    createdAt: string
  }
}

export default function PeerReviewsPage() {
  const [reviewerId, setReviewerId] = useState('student-b')
  const [assignedReviews, setAssignedReviews] = useState<AssignedReview[]>([])
  const [feedbackMap, setFeedbackMap] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')

  async function loadReviews(currentReviewerId: string) {
    const res = await fetch(`/api/custom-dev/peer-coursework/peer-reviews/my?reviewerId=${currentReviewerId}`)
    const data = await res.json()
    setAssignedReviews(data)
  }

  useEffect(() => {
    loadReviews(reviewerId)
  }, [reviewerId])

  async function handleSubmitReview(submissionId: string) {
    setMessage('')

    const feedback = feedbackMap[submissionId] || ''

    const res = await fetch('/api/custom-dev/peer-coursework/peer-reviews/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        submissionId,
        reviewerId,
        feedback,
      }),
    })

    const data = await res.json()

    if (!res.ok) {
      setMessage(data.error || 'Failed to submit review')
      return
    }

    setMessage('Review submitted successfully')
    loadReviews(reviewerId)
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

      {assignedReviews.length === 0 && (
        <p>No assigned reviews yet.</p>
      )}

      <div className="space-y-6">
        {assignedReviews.map((item) => (
          <div key={item.reviewId} className="border rounded p-4">
            <p className="font-semibold mb-2">
              Submission by: {item.submission?.studentId}
            </p>

            <div className="border rounded p-3 bg-gray-50 mb-4 whitespace-pre-wrap">
              {item.submission?.content}
            </div>

            <textarea
              className="border rounded px-3 py-2 w-full min-h-[120px]"
              placeholder="Write feedback here..."
              value={feedbackMap[item.submissionId] ?? item.feedback ?? ''}
              onChange={(e) =>
                setFeedbackMap((prev) => ({
                  ...prev,
                  [item.submissionId]: e.target.value,
                }))
              }
            />

            <button
              onClick={() => handleSubmitReview(item.submissionId)}
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