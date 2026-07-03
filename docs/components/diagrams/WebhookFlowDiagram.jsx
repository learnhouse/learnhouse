'use client'

import { Lightning, Cube, ShieldCheck, CheckCircle } from '@phosphor-icons/react/dist/ssr'
import FlowDiagram from './FlowDiagram'

// How a webhook reaches your receiver and is verified.
const nodes = [
  { label: 'Event happens', sub: 'e.g. course_completed', icon: Lightning, color: '#f59e0b', bg: '#fffbeb', border: '#fde68a',
    edge: { label: 'signs payload' } },
  { label: 'LearnHouse API', sub: 'HMAC-SHA256 over body', icon: Cube, color: '#10b981', bg: '#ecfdf5', border: '#a7f3d0',
    edge: { label: 'signed POST' } },
  { label: 'Your endpoint', sub: 'Verify X-Webhook-Signature', icon: ShieldCheck, color: '#0ea5e9', bg: '#e0f2fe', border: '#bae6fd',
    edge: { label: 'valid → handle' } },
  { label: 'Return 2xx', sub: 'Delivery logged', icon: CheckCircle, color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' },
]

export default function WebhookFlowDiagram() {
  return (
    <FlowDiagram
      nodes={nodes}
      caption="Recompute the HMAC-SHA256 of the raw request body with your endpoint secret and compare it to X-Webhook-Signature before trusting the payload. If your endpoint doesn't return a 2xx, LearnHouse retries — up to 3 attempts, waiting 1s then 4s between them."
    />
  )
}
