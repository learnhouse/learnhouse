// apps/web/app/admin/announcements/page.tsx
import AnnouncementsClient from "./announcementsClient";

export const metadata = {
  title: "Announcements",
};

export default function AnnouncementsPage() {
  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Announcements</h1>
      <p style={{ marginTop: 8, opacity: 0.8 }}>
        Create and manage announcements (local-only for now).
      </p>

      <div style={{ marginTop: 16 }}>
        <AnnouncementsClient />
      </div>
    </div>
  );
}