'use client'

import {
  Buildings, BookOpen, Stack, Article,
  User, Path, Flag, CheckCircle,
} from '@phosphor-icons/react/dist/ssr'

// Two parallel chains: the content tree you read, and the progress tree you
// write. Cross-links (Run↔Course, Step↔Activity) are described in the caption
// rather than drawn, which keeps the picture clean.

function Card({ node }) {
  const Icon = node.icon
  return (
    <div
      style={{
        flex: '1 1 0', minWidth: 116,
        background: node.bg, border: `1px solid ${node.border}`,
        borderRadius: 14, padding: '12px 14px',
        display: 'flex', flexDirection: 'column', gap: 7,
      }}
    >
      <div
        style={{
          width: 28, height: 28, borderRadius: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#fff', border: `1px solid ${node.border}`,
        }}
      >
        <Icon size={16} weight="duotone" color={node.color} />
      </div>
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 650, color: '#1e293b', lineHeight: 1.2 }}>{node.label}</div>
        {node.sub && <div style={{ fontSize: 10, color: '#64748b', lineHeight: 1.25, marginTop: 2 }}>{node.sub}</div>}
      </div>
    </div>
  )
}

function Arrow({ label }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, flexShrink: 0, minWidth: 58 }}>
      <span style={{ fontSize: 9.5, color: '#94a3b8', whiteSpace: 'nowrap' }}>{label}</span>
      <svg width="100%" height="12" viewBox="0 0 58 12" preserveAspectRatio="none">
        <line x1="2" y1="6" x2="48" y2="6" stroke="#cbd5e1" strokeWidth="2" />
        <path d="M46 2 L56 6 L46 10" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

function Chain({ title, nodes }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>
        {title}
      </div>
      <div style={{ display: 'flex', alignItems: 'stretch', overflowX: 'auto', paddingBottom: 2 }}>
        {nodes.map((node, i) => (
          <div key={node.label} style={{ display: 'contents' }}>
            <Card node={node} />
            {i < nodes.length - 1 && <Arrow label="has many" />}
          </div>
        ))}
      </div>
    </div>
  )
}

const content = [
  { label: 'Organization', sub: 'org_slug', icon: Buildings, color: '#6366f1', bg: '#eef2ff', border: '#c7d2fe' },
  { label: 'Course', sub: 'course_uuid', icon: BookOpen, color: '#0ea5e9', bg: '#e0f2fe', border: '#bae6fd' },
  { label: 'Chapter', sub: 'ordered', icon: Stack, color: '#8b5cf6', bg: '#f5f3ff', border: '#ddd6fe' },
  { label: 'Activity', sub: 'video · doc · page', icon: Article, color: '#db2777', bg: '#fdf2f8', border: '#fbcfe8' },
]

const progress = [
  { label: 'User', sub: 'learner', icon: User, color: '#10b981', bg: '#ecfdf5', border: '#a7f3d0' },
  { label: 'Trail', sub: 'one per user, per org', icon: Path, color: '#0d9488', bg: '#f0fdfa', border: '#99f6e4' },
  { label: 'Run', sub: 'one per enrolled course', icon: Flag, color: '#f59e0b', bg: '#fffbeb', border: '#fde68a' },
  { label: 'Step', sub: 'one per completed activity', icon: CheckCircle, color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' },
]

export default function ResourceModelDiagram() {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 16, background: '#fafafa', padding: 20, margin: '24px 0', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Chain title="Content you read" nodes={content} />
      <Chain title="Progress you write" nodes={progress} />
      <p style={{ fontSize: 12, color: '#64748b', margin: '0 2px', lineHeight: 1.5 }}>
        The two chains connect through enrollment: a <strong>Run</strong> records a learner&apos;s enrollment in a <strong>Course</strong>, and each <strong>Step</strong> records completion of an <strong>Activity</strong>.
      </p>
    </div>
  )
}
