'use client'

import Link from 'next/link'
import {
  Browser,
  Robot,
  Stack,
  WebhooksLogo,
  GraduationCap,
  PlugsConnected,
} from '@phosphor-icons/react/dist/ssr'

// Card sets, keyed by the `set` prop. Icons live inside this client component
// so MDX pages only need to pass a string.
const SETS = {
  // Guides section landing
  index: [
    {
      href: '/guides/build-learning-platform',
      icon: GraduationCap,
      color: '#6366f1',
      title: 'Build a learning platform',
      desc: 'Ship your own headless learning platform with Next.js and the LearnHouse API — anonymous browsing first, then auth, enrollment and progress.',
    },
    {
      href: '/guides/custom-features',
      icon: PlugsConnected,
      color: '#10b981',
      title: 'Custom features & webhooks',
      desc: 'Drive the API with tokens, automate with webhooks, and extend LearnHouse with your own integrations.',
    },
  ],
  // build-learning-platform landing — the two paths
  build: [
    {
      href: '/guides/build-learning-platform/do-it-yourself',
      icon: Browser,
      color: '#0ea5e9',
      title: 'Do it yourself',
      desc: 'A complete, tested step-by-step build. Start with a public catalogue, then layer on login, enrollment and progress.',
    },
    {
      href: '/guides/build-learning-platform/with-an-agent',
      icon: Robot,
      color: '#8b5cf6',
      title: 'Let an agent build it',
      desc: 'Hand a coding agent (Claude Code, Cursor…) a ready-made spec and have it build the whole platform for you.',
    },
  ],
  // custom-features landing
  custom: [
    {
      href: '/guides/custom-features',
      icon: Stack,
      color: '#10b981',
      title: 'Work with the API',
      desc: 'API tokens, request conventions, and recipes for creating and querying content programmatically.',
    },
    {
      href: '/guides/custom-features/webhooks',
      icon: WebhooksLogo,
      color: '#f97316',
      title: 'Consume webhooks',
      desc: 'Subscribe to dozens of events, verify signatures, and react to learning activity in real time.',
    },
  ],
}

export default function GuideCards({ set = 'index' }) {
  const cards = SETS[set] || SETS.index
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, margin: '32px 0' }}>
      {cards.map((card) => {
        const Icon = card.icon
        return (
          <Link
            key={card.href}
            href={card.href}
            className="nice-shadow"
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 16,
              padding: '22px 24px',
              borderRadius: 16,
              background: '#fff',
              overflow: 'hidden',
              position: 'relative',
              textDecoration: 'none',
              transition: 'transform 0.15s ease',
            }}
            onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.02)'}
            onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
          >
            <div
              style={{
                position: 'relative', zIndex: 1,
                flexShrink: 0,
                width: 42, height: 42,
                borderRadius: 12,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                backgroundColor: card.color + '10',
              }}
            >
              <Icon size={20} weight="duotone" style={{ color: card.color }} />
            </div>
            <div style={{ position: 'relative', zIndex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 650, color: '#1a1a1a', lineHeight: 1.3, margin: 0 }}>{card.title}</div>
              <div style={{ fontSize: 13, color: '#9ca3af', lineHeight: 1.45, margin: 0, marginTop: 3 }}>{card.desc}</div>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
