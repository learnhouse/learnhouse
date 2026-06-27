'use client'

import { Browser, Stack, Cube } from '@phosphor-icons/react/dist/ssr'
import FlowDiagram from './FlowDiagram'

// Browser → your Next.js app (BFF) → LearnHouse API. Media streams straight
// from the API's content-delivery endpoint.
const nodes = [
  { label: 'Browser', sub: 'Your learners', icon: Browser, color: '#6366f1', bg: '#eef2ff', border: '#c7d2fe',
    edge: { label: 'HTTP' } },
  { label: 'Your Next.js app', sub: 'Server Components + BFF Route Handlers', icon: Stack, color: '#0ea5e9', bg: '#e0f2fe', border: '#bae6fd',
    edge: { label: 'REST + Bearer' } },
  { label: 'LearnHouse API', sub: '/api/v1', icon: Cube, color: '#10b981', bg: '#ecfdf5', border: '#a7f3d0' },
]

export default function HeadlessArchitecture() {
  return (
    <FlowDiagram
      nodes={nodes}
      caption="Reads happen in Server Components; anything with a token goes through a Route Handler acting as a Backend-for-Frontend, so tokens never reach the browser. Media (thumbnails, video, files) streams directly from the backend's content-delivery endpoint at /content/… (served at the root, not under /api/v1)."
    />
  )
}
