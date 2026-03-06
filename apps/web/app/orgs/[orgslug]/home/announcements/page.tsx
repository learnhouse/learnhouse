'use client'

import { useMemo, useState } from 'react'

type Announcement = {
  id: string
  title: string
  body: string
  createdAt: string
}

export default function AnnouncementsPage() {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [items, setItems] = useState<Announcement[]>([])

  const canSubmit = useMemo(
    () => title.trim().length > 0 && body.trim().length > 0,
    [title, body]
  )

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return

    const now = new Date()
    setItems((prev) => [
      {
        id: crypto.randomUUID(),
        title: title.trim(),
        body: body.trim(),
        createdAt: now.toISOString(),
      },
      ...prev,
    ])
    setTitle('')
    setBody('')
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 16 }}>Announcements</h1>

      <form onSubmit={onSubmit} style={{ border: '1px solid #ddd', padding: 16, borderRadius: 12, marginBottom: 24 }}>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}>Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Maintenance on Friday"
            style={{ width: '100%', padding: 10, borderRadius: 10, border: '1px solid #ccc' }}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}>Message</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write the announcement details…"
            rows={4}
            style={{ width: '100%', padding: 10, borderRadius: 10, border: '1px solid #ccc' }}
          />
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          style={{
            padding: '10px 14px',
            borderRadius: 10,
            border: '1px solid #333',
            background: canSubmit ? '#111' : '#999',
            color: '#fff',
            cursor: canSubmit ? 'pointer' : 'not-allowed',
          }}
        >
          Post announcement
        </button>
      </form>

      <div style={{ display: 'grid', gap: 12 }}>
        {items.length === 0 ? (
          <div style={{ color: '#666' }}>No announcements yet.</div>
        ) : (
          items.map((a) => (
            <div key={a.id} style={{ border: '1px solid #ddd', padding: 16, borderRadius: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ fontWeight: 700 }}>{a.title}</div>
                <div style={{ color: '#666', fontSize: 12 }}>{new Date(a.createdAt).toLocaleString()}</div>
              </div>
              <div style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{a.body}</div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}