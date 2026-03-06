"use client";

import React from "react";

type Announcement = {
  id: string;
  title: string;
  body: string;
  createdAt: string; // ISO
};

const STORAGE_KEY = "learnhouse.dev.announcements";

function loadAnnouncements(): Announcement[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Announcement[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveAnnouncements(items: Announcement[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export default function AnnouncementsClient() {
  const [items, setItems] = React.useState<Announcement[]>([]);
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setItems(loadAnnouncements());
  }, []);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const t = title.trim();
    const b = body.trim();

    if (!t) return setError("Title is required.");
    if (!b) return setError("Body is required.");

    const next: Announcement = {
      id: crypto.randomUUID(),
      title: t,
      body: b,
      createdAt: new Date().toISOString(),
    };

    const updated = [next, ...items];
    setItems(updated);
    saveAnnouncements(updated);

    setTitle("");
    setBody("");
  }

  function onDelete(id: string) {
    const updated = items.filter((x) => x.id !== id);
    setItems(updated);
    saveAnnouncements(updated);
  }

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 800 }}>
      <form
        onSubmit={onSubmit}
        style={{
          border: "1px solid rgba(0,0,0,0.12)",
          borderRadius: 12,
          padding: 16,
        }}
      >
        <div style={{ display: "grid", gap: 10 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 600 }}>Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Maintenance window this Friday"
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid rgba(0,0,0,0.2)",
              }}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 600 }}>Body</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write the announcement details..."
              rows={5}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid rgba(0,0,0,0.2)",
                resize: "vertical",
              }}
            />
          </label>

          {error ? (
            <div style={{ color: "crimson", fontWeight: 600 }}>{error}</div>
          ) : null}

          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="submit"
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid rgba(0,0,0,0.2)",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              Publish
            </button>

            <button
              type="button"
              onClick={() => {
                setTitle("");
                setBody("");
                setError(null);
              }}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid rgba(0,0,0,0.2)",
                cursor: "pointer",
              }}
            >
              Clear
            </button>
          </div>
        </div>
      </form>

      <div style={{ display: "grid", gap: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>Published</h2>

        {items.length === 0 ? (
          <div style={{ opacity: 0.8 }}>No announcements yet.</div>
        ) : (
          items.map((a) => (
            <div
              key={a.id}
              style={{
                border: "1px solid rgba(0,0,0,0.12)",
                borderRadius: 12,
                padding: 14,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{a.title}</div>
                  <div style={{ opacity: 0.7, fontSize: 12, marginTop: 2 }}>
                    {new Date(a.createdAt).toLocaleString()}
                  </div>
                </div>

                <button
                  onClick={() => onDelete(a.id)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 10,
                    border: "1px solid rgba(0,0,0,0.2)",
                    cursor: "pointer",
                    height: "fit-content",
                  }}
                >
                  Delete
                </button>
              </div>

              <div style={{ marginTop: 10, whiteSpace: "pre-wrap" }}>
                {a.body}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}