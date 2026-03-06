'use client'

import { useEffect, useState } from 'react'

type FeedbackItem = {
  submission: {
    id: string
    activityId: string
    studentId: string
    content: string
    createdAt: string
  }
  reviews: {
    reviewId: string
    reviewerId: string
    feedback: string | null
    score: number | null
    createdAt: string
  }[]
}

export default function PeerFeedbackPage() {
  const [studentId, setStudentId] = useState('student-a')
  const [feedbackItems, setFeedbackItems] = useState<FeedbackItem[]>([])

  async function loadFeedback(currentStudentId: string) {
    const res = await fetch(`/api/custom-dev/peer-coursework/peer-feedback/my?studentId=${currentStudentId}`)
    const data = await res.json()
    setFeedbackItems(data)
  }

  useEffect(() => {
    loadFeedback(studentId)
  }, [studentId])

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">My Peer Feedback</h1>

      <label className="block mb-2 font-medium">Student ID</label>
      <select
        className="border rounded px-3 py-2 mb-6 w-full"
        value={studentId}
        onChange={(e) => setStudentId(e.target.value)}
      >
        <option value="student-a">student-a</option>
        <option value="student-b">student-b</option>
        <option value="student-c">student-c</option>
        <option value="student-d">student-d</option>
      </select>

      {feedbackItems.length === 0 && (
        <p>No submissions found for this student yet.</p>
      )}

      <div className="space-y-8">
        {feedbackItems.map((item) => (
          <div key={item.submission.id} className="border rounded p-4">
            <h2 className="text-lg font-semibold mb-2">Your Submission</h2>

            <div className="border rounded p-3 bg-gray-50 whitespace-pre-wrap mb-4">
              {item.submission.content}
            </div>

            <h3 className="font-semibold mb-3">Feedback Received</h3>

            {item.reviews.length === 0 && (
              <p>No feedback yet.</p>
            )}

            <div className="space-y-4">
              {item.reviews.map((review) => (
                <div key={review.reviewId} className="border rounded p-3">
                  <p className="font-medium mb-2">
                    Reviewer: {review.reviewerId}
                  </p>

                  <div className="whitespace-pre-wrap">
                    {review.feedback ? review.feedback : 'Review assigned but not yet submitted.'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}