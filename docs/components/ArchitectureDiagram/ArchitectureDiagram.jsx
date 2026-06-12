'use client'

import { ReactFlow, Background, MarkerType } from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import {
  SiNextdotjs,
  SiFastapi,
  SiPostgresql,
  SiRedis,
  SiStripe,
  SiGooglegemini,
  SiSentry,
  SiUnsplash,
} from '@icons-pack/react-simple-icons'

import {
  Users,
  PencilSimple,
  HardDrives,
  Envelope,
  Terminal,
  Key,
  ChartBar,
} from '@phosphor-icons/react/dist/ssr'

const nodeDefaults = {
  draggable: false,
  connectable: false,
  selectable: false,
}

function NodeLabel({ icon, label, sub }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ flexShrink: 0, display: 'flex' }}>{icon}</span>
      <div style={{ textAlign: 'left' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#1a1a1a', lineHeight: 1.3 }}>{label}</div>
        {sub && <div style={{ fontSize: 9.5, color: '#6b7280', lineHeight: 1.3 }}>{sub}</div>}
      </div>
    </div>
  )
}

const makeNode = (id, icon, label, sub, x, y, bg, border, width = 155) => ({
  id,
  position: { x, y },
  data: { label: <NodeLabel icon={icon} label={label} sub={sub} /> },
  style: {
    background: bg,
    border: `1px solid ${border}`,
    borderRadius: 12,
    padding: '10px 14px',
    width,
  },
  ...nodeDefaults,
})

const nodes = [
  // Row 0 — Users
  makeNode('users', <Users size={16} weight="fill" color="#6366f1" />, 'Users', 'Browser', 265, 0, '#f0f4ff', '#c7d2fe'),

  // Row 1 — Core apps
  makeNode('web', <SiNextdotjs size={14} color="#000" />, 'Web', 'Next.js 16', 30, 120, '#e0f2fe', '#93c5fd'),
  makeNode('api', <SiFastapi size={14} color="#009688" />, 'API', 'FastAPI', 265, 120, '#dcfce7', '#86efac'),
  makeNode('collab', <PencilSimple size={14} weight="fill" color="#db2777" />, 'Collab', 'Hocuspocus', 500, 120, '#fce7f3', '#f9a8d4'),

  // Row 2 — Data layer
  makeNode('pg', <SiPostgresql size={14} color="#4169E1" />, 'PostgreSQL', 'pgvector', 145, 260, '#f3e8ff', '#c4b5fd'),
  makeNode('redis', <SiRedis size={14} color="#DC382D" />, 'Redis', 'Cache & Sessions', 385, 260, '#fef9c3', '#fde047'),

  // Row 3 — External services (API)
  makeNode('gemini', <SiGooglegemini size={13} color="#8E75B2" />, 'Google Gemini', 'AI & RAG', 0, 400, '#ecfdf5', '#6ee7b7', 145),
  makeNode('s3', <HardDrives size={14} weight="fill" color="#E25D10" />, 'S3 Storage', 'Media files', 165, 400, '#fff7ed', '#fdba74', 145),
  makeNode('stripe', <SiStripe size={13} color="#635BFF" />, 'Stripe', 'Payments', 330, 400, '#eef2ff', '#a5b4fc', 145),
  makeNode('email', <Envelope size={14} weight="fill" color="#EF4444" />, 'Email', 'Resend / SMTP', 495, 400, '#fef2f2', '#fca5a5', 145),

  // Row 4 — More services
  makeNode('judge0', <Terminal size={14} weight="fill" color="#16A34A" />, 'Judge0', 'Code execution', 0, 490, '#f0fdf4', '#86efac', 145),
  makeNode('workos', <Key size={14} weight="fill" color="#7C3AED" />, 'WorkOS', 'Enterprise SSO', 165, 490, '#fdf4ff', '#d8b4fe', 145),
  makeNode('sentry', <SiSentry size={13} color="#362D59" />, 'Sentry', 'Error tracking', 330, 490, '#faf5ff', '#c4b5fd', 145),
  makeNode('tinybird', <ChartBar size={14} weight="fill" color="#0d9488" />, 'Tinybird', 'Analytics', 495, 490, '#f0fdfa', '#5eead4', 145),

  // Web → Unsplash
  makeNode('unsplash', <SiUnsplash size={12} color="#000" />, 'Unsplash', 'Stock images', 30, 260, '#f5f5f4', '#d6d3d1', 105),
]

const solid = {
  type: 'default',
  style: { stroke: '#94a3b8', strokeWidth: 1.5 },
  markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8', width: 14, height: 14 },
}

const dashed = {
  type: 'default',
  style: { stroke: '#cbd5e1', strokeWidth: 1.2, strokeDasharray: '5 4' },
  markerEnd: { type: MarkerType.ArrowClosed, color: '#cbd5e1', width: 12, height: 12 },
}

const edges = [
  // Users → Core apps
  { id: 'u-web', source: 'users', target: 'web', label: 'HTTP', ...solid },
  { id: 'u-api', source: 'users', target: 'api', label: 'REST', ...solid },
  { id: 'u-collab', source: 'users', target: 'collab', label: 'WebSocket', ...solid },

  // Inter-app
  { id: 'web-api', source: 'web', target: 'api', label: 'SSR', ...solid },
  { id: 'collab-api', source: 'collab', target: 'api', label: 'Persist', ...solid },

  // Data stores
  { id: 'api-pg', source: 'api', target: 'pg', ...solid },
  { id: 'api-redis', source: 'api', target: 'redis', ...solid },
  { id: 'collab-redis', source: 'collab', target: 'redis', label: 'Cache', ...solid },

  // API → External
  { id: 'api-gemini', source: 'api', target: 'gemini', ...dashed },
  { id: 'api-s3', source: 'api', target: 's3', ...dashed },
  { id: 'api-stripe', source: 'api', target: 'stripe', ...dashed },
  { id: 'api-email', source: 'api', target: 'email', ...dashed },
  { id: 'api-judge0', source: 'api', target: 'judge0', ...dashed },
  { id: 'api-workos', source: 'api', target: 'workos', ...dashed },
  { id: 'api-sentry', source: 'api', target: 'sentry', ...dashed },
  { id: 'api-tinybird', source: 'api', target: 'tinybird', ...dashed },

  // Web → External
  { id: 'web-unsplash', source: 'web', target: 'unsplash', ...dashed },
  { id: 'web-sentry', source: 'web', target: 'sentry', ...dashed },
]

export default function ArchitectureDiagram() {
  return (
    <div style={{
      border: '1px solid #e5e7eb',
      borderRadius: 16,
      overflow: 'hidden',
      background: '#fafafa',
      margin: '24px 0',
      height: 620,
    }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#e5e7eb" gap={20} size={1} />
      </ReactFlow>
    </div>
  )
}
