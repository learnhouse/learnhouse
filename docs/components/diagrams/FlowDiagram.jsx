'use client'

// A clean, predictable horizontal flow diagram: a row of labelled cards
// connected by labelled arrows. Wraps/scrolls on narrow screens. Used for the
// linear pipelines (architecture, auth, webhooks) — no floating-edge guesswork.

function Arrow({ label, dashed }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        flexShrink: 0,
        minWidth: 64,
        padding: '0 4px',
      }}
    >
      {label && (
        <span style={{ fontSize: 10.5, color: '#64748b', whiteSpace: 'nowrap', textAlign: 'center', lineHeight: 1.2 }}>
          {label}
        </span>
      )}
      <svg width="100%" height="14" viewBox="0 0 64 14" preserveAspectRatio="none" style={{ display: 'block' }}>
        <line
          x1="2" y1="7" x2="54" y2="7"
          stroke="#cbd5e1" strokeWidth="2"
          strokeDasharray={dashed ? '4 4' : undefined}
        />
        <path d="M52 2 L62 7 L52 12" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

function Node({ node }) {
  const Icon = node.icon
  return (
    <div
      style={{
        flex: '1 1 0',
        minWidth: 130,
        background: node.bg || '#f8fafc',
        border: `1px solid ${node.border || '#e2e8f0'}`,
        borderRadius: 14,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div
        style={{
          width: 30, height: 30, borderRadius: 9,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#fff',
          border: `1px solid ${node.border || '#e2e8f0'}`,
        }}
      >
        {Icon && <Icon size={17} weight="duotone" color={node.color || '#475569'} />}
      </div>
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 650, color: '#1e293b', lineHeight: 1.25 }}>{node.label}</div>
        {node.sub && <div style={{ fontSize: 10.5, color: '#64748b', lineHeight: 1.3, marginTop: 2 }}>{node.sub}</div>}
      </div>
    </div>
  )
}

export default function FlowDiagram({ nodes, caption }) {
  return (
    <div
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 16,
        background: '#fafafa',
        padding: 20,
        margin: '24px 0',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'stretch', overflowX: 'auto', paddingBottom: 2 }}>
        {nodes.map((node, i) => (
          <div key={node.label} style={{ display: 'contents' }}>
            <Node node={node} />
            {i < nodes.length - 1 && <Arrow label={node.edge?.label} dashed={node.edge?.dashed} />}
          </div>
        ))}
      </div>
      {caption && (
        <p style={{ fontSize: 12, color: '#64748b', margin: '14px 2px 0', lineHeight: 1.5 }}>{caption}</p>
      )}
    </div>
  )
}
