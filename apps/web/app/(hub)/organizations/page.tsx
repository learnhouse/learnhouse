'use client'

// /organizations — the hub entry point.
//
// Thin route that renders the same org picker used at /home, so the apex
// org-management hub has a stable, descriptive URL. Kept a client component
// because HomeClient relies on session + react-query on the client.
import HomeClient from '@/app/home/home'

export default function OrganizationsPage() {
  return <HomeClient />
}
