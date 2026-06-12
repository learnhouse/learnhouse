'use client'

import Link from 'next/link'
import {
  PencilSimple,
  Brain,
  UsersThree,
  BookOpen,
  ClipboardText,
  Terminal,
  ChatCircle,
  ChalkboardSimple,
  Microphone,
  Certificate,
  ChartBar,
  CreditCard,
  Buildings,
  ShieldCheck,
  MagnifyingGlass,
} from '@phosphor-icons/react/dist/ssr'

const features = [
  // Row 1 — hero features (large)
  { icon: PencilSimple, label: 'Block Editor', desc: 'Notion-like WYSIWYG editor with rich content blocks, videos, documents, and embeds', color: '#3b82f6', size: 'large', href: '/platform/editor' },
  { icon: Brain, label: 'AI Tutoring', desc: 'Built-in AI assistant for students and teachers with RAG-powered context', color: '#a855f7', size: 'large', href: '/platform/ai' },
  { icon: UsersThree, label: 'Real-time Collaboration', desc: 'Live co-editing for course content and boards powered by Hocuspocus', color: '#ec4899', size: 'large', href: '/platform/editor/collaboration' },

  // Row 2+ — standard features
  { icon: BookOpen, label: 'Courses & Trails', desc: 'Chapters, activities, collections, and learning paths', color: '#10b981', href: '/platform/courses' },
  { icon: ClipboardText, label: 'Assignments', desc: 'Automated and manual grading', color: '#f59e0b', href: '/platform/assignments' },
  { icon: Terminal, label: 'Code Execution', desc: 'Run code in 7+ languages', color: '#8b5cf6', href: '/platform/code-execution' },
  { icon: ChatCircle, label: 'Discussions', desc: 'Threaded conversations', color: '#f43f5e', href: '/platform/discussions' },
  { icon: ChalkboardSimple, label: 'Boards', desc: 'Collaborative whiteboards', color: '#f97316', href: '/platform/boards' },
  { icon: Microphone, label: 'Podcasts', desc: 'Audio content and episodes', color: '#ec4899', href: '/platform/podcasts' },
  { icon: Certificate, label: 'Certifications', desc: 'Auto-generate on completion', color: '#14b8a6', href: '/platform/certifications' },
  { icon: ChartBar, label: 'Analytics', desc: 'Track progress and engagement', color: '#d97706', href: '/platform/analytics' },
  { icon: CreditCard, label: 'Payments', desc: 'Sell courses with Stripe', color: '#6366f1', href: '/platform/payments' },
  { icon: Buildings, label: 'Multi-tenancy', desc: 'Multiple organizations', color: '#0891b2', href: '/platform/organizations/multi-tenancy' },
  { icon: ShieldCheck, label: 'Enterprise SSO', desc: 'WorkOS SAML/OIDC', color: '#475569', href: '/platform/users/authentication' },
  { icon: MagnifyingGlass, label: 'Search', desc: 'Full-text search', color: '#737373', href: '/platform/search' },
]

function FeatureCard({ icon: Icon, label, color, desc, large, href }) {
  return (
    <Link
      href={href}
      style={{
        padding: large ? '24px 26px' : '18px 20px',
        borderRadius: 16,
        background: '#fff',
        overflow: 'hidden',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: large ? 14 : 10,
        boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 0 0 1px rgba(0,0,0,0.03)',
        textDecoration: 'none',
        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.02)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.04)' }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04), 0 0 0 1px rgba(0,0,0,0.03)' }}
    >
      {/* Dot pattern */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          opacity: 1,
          backgroundImage: `radial-gradient(${color}30 1px, transparent 1px)`,
          backgroundSize: '14px 14px',
          maskImage: 'linear-gradient(to bottom, black 0%, transparent 50%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black 0%, transparent 50%)',
        }}
      />

      <div
        style={{
          width: large ? 40 : 34,
          height: large ? 40 : 34,
          borderRadius: large ? 12 : 10,
          background: color + '10',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Icon size={large ? 20 : 17} weight="duotone" style={{ color }} />
      </div>

      <div>
        <div style={{ fontSize: large ? 15 : 13, fontWeight: 650, color: '#1a1a1a', lineHeight: 1.3, margin: 0 }}>
          {label}
        </div>
        <div style={{ fontSize: large ? 13 : 11.5, color: '#9ca3af', lineHeight: 1.45, margin: 0, marginTop: 3 }}>
          {desc}
        </div>
      </div>
    </Link>
  )
}

export default function FeaturesGrid() {
  const heroFeatures = features.filter(f => f.size === 'large')
  const standardFeatures = features.filter(f => !f.size)

  return (
    <div style={{ margin: '24px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Hero row — 3 large cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {heroFeatures.map(f => (
          <FeatureCard key={f.label} {...f} large />
        ))}
      </div>

      {/* Standard features — compact bento grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {standardFeatures.map(f => (
          <FeatureCard key={f.label} {...f} />
        ))}
      </div>
    </div>
  )
}
