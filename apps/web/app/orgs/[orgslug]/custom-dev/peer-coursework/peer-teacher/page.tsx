'use client'

import { useEffect, useState } from 'react'
import { getPeerSubmissions, assignPeerReviewer } from '@/services/custom-dev/peer-coursework/peerCourseworkService'

type Submission = {
  id: string
  activity_id: string
  course_id: string
  student_id: string
  content: string
  created_at: string
}

export default function PeerTeacherPage() {
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [reviewerMap, setReviewerMap] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')

  async function loadSubmissions() {
    try {
      const data = await getPeerSubmissions('course-1')
      setSubmissions(data)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Failed to load submissions')
    }
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

    try {
      await assignPeerReviewer({
        submission_id: submissionId,
        reviewer_id: reviewerId,
      } as any)

      setMessage('Reviewer assigned successfully')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Failed to assign reviewer')
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Teacher Peer Review Assignment</h1>

      {submissions.length === 0 && <p>No submissions yet.</p>}

      <div className="space-y-6">
        {submissions.map((submission) => (
          <div key={submission.id} className="border rounded p-4">
            <p className="font-semibold mb-2">Student: {submission.student_id}</p>

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
              {submission.student_id !== 'student-a' && (
                <option value="student-a">student-a</option>
              )}
              {submission.student_id !== 'student-b' && (
                <option value="student-b">student-b</option>
              )}
              {submission.student_id !== 'student-c' && (
                <option value="student-c">student-c</option>
              )}
              {submission.student_id !== 'student-d' && (
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