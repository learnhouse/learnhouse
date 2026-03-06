'use client'

import { useEffect, useState } from 'react'

type Submission = {
  id: string
  activityId: string
  studentId: string
  content: string
  createdAt: string
}

export default function PeerTeacherPage() {
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [reviewerMap, setReviewerMap] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')

  async function loadSubmissions() {
    const res = await fetch('/api/custom-dev/peer-coursework/peer-submissions')
    const data = await res.json()
    setSubmissions(data)
  }

  useEffect(() => {
    loadSubmissions()
  }, [])

  async function handleAssign(submissionId: string) {
    setMessage('')

    const reviewerId = reviewerMap[submissionId]

    if (!reviewerId) {
      setMessage('Please choose a reviewer first.')
      return
    }

    const res = await fetch('/api/custom-dev/peer-coursework/peer-reviews/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        submissionId,
        reviewerId,
      }),
    })

    const data = await res.json()

    if (!res.ok) {
      setMessage(data.error || 'Failed to assign reviewer')
      return
    }

    setMessage('Reviewer assigned successfully')
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Teacher Peer Review Assignment</h1>

      {submissions.length === 0 && (
        <p>No submissions yet. Go to /peer-submit first and submit student work.</p>
      )}

      <div className="space-y-6">
        {submissions.map((submission) => (
          <div key={submission.id} className="border rounded p-4">
            <p className="font-semibold mb-2">Student: {submission.studentId}</p>

            <div className="border rounded p-3 bg-gray-50 mb-4 whitespace-pre-wrap">
              {submission.content}
            </div>

            <label className="block mb-2 font-medium">Assign Reviewer</label>
            
            <select
              className="border rounded px-3 py-2 w-full mb-3"
              value={reviewerMap[submission.id] || ''}
              onChange={(e) =>
                setReviewerMap((prev) => ({
                  ...prev,
                  [submission.id]: e.target.value,
                }))
              }
            >
              <option value="">Select reviewer</option>

              {submission.studentId !== 'student-a' && (
                <option value="student-a">student-a</option>
              )}

              {submission.studentId !== 'student-b' && (
                <option value="student-b">student-b</option>
              )}

              {submission.studentId !== 'student-c' && (
                <option value="student-c">student-c</option>
              )}

              {submission.studentId !== 'student-d' && (
                <option value="student-d">student-d</option>
              )}
            </select>

            <button
              onClick={() => handleAssign(submission.id)}
              className="bg-black text-white px-4 py-2 rounded"
            >
              Assign Reviewer
            </button>
          </div>
        ))}
      </div>

      {message && <p className="mt-6">{message}</p>}
    </div>
  )
}