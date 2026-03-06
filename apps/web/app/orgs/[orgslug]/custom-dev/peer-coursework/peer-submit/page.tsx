'use client'

import { useState } from 'react'
import { submitPeerSubmission } from '@/services/custom-dev/peer-coursework/peerCourseworkService'

export default function PeerSubmitPage() {
  const [studentId, setStudentId] = useState('student-a')
  const [content, setContent] = useState('')
  const [message, setMessage] = useState('')

  async function handleSubmit() {
    try {
      await submitPeerSubmission({
        course_id: 'course-1',
        activity_id: 'activity-1',
        student_id: studentId,
        content,
      } as any)

      setMessage('Submission successful')
      setContent('')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Submission failed')
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Submit Work</h1>

      <select
        className="border rounded px-3 py-2 mb-4 w-full"
        value={studentId}
        onChange={(e) => setStudentId(e.target.value)}
      >
        <option value="student-a">student-a</option>
        <option value="student-b">student-b</option>
        <option value="student-c">student-c</option>
        <option value="student-d">student-d</option>
      </select>

      <textarea
        className="border rounded px-3 py-2 w-full min-h-[180px]"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Write your answer here..."
      />

      <button
        onClick={handleSubmit}
        className="mt-4 bg-black text-white px-4 py-2 rounded"
      >
        Submit
      </button>

      {message && <p className="mt-4">{message}</p>}
    </div>
  )
}