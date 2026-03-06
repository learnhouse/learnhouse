'use client'

import { useState } from 'react'

export default function PeerSubmitPage() {
  const [studentId, setStudentId] = useState('student-a')
  const [content, setContent] = useState('')
  const [message, setMessage] = useState('')

  async function handleSubmit() {
    setMessage('')

    const res = await fetch('/api/custom-dev/peer-coursework/peer-submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        activityId: 'activity-1',
        studentId,
        content,
      }),
    })

    const data = await res.json()

    if (!res.ok) {
      setMessage(data.error || 'Submission failed')
      return
    }

    setMessage('Submission successful')
    setContent('')
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Submit Work</h1>

      <label className="block mb-2 font-medium">Student ID</label>
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

      <label className="block mb-2 font-medium">Your Work</label>
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