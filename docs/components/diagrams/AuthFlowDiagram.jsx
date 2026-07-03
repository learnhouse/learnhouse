'use client'

import { Browser, Stack, SignIn, Cookie } from '@phosphor-icons/react/dist/ssr'
import FlowDiagram from './FlowDiagram'

// The BFF login flow: the browser talks only to your Next.js server, which
// holds the LearnHouse tokens in its own httpOnly cookie.
const nodes = [
  { label: 'Browser', sub: 'Login form', icon: Browser, color: '#6366f1', bg: '#eef2ff', border: '#c7d2fe',
    edge: { label: 'email + password' } },
  { label: 'Next.js Route Handler', sub: 'Your BFF', icon: Stack, color: '#0ea5e9', bg: '#e0f2fe', border: '#bae6fd',
    edge: { label: 'form POST' } },
  { label: 'POST /auth/login', sub: 'Returns access + refresh tokens', icon: SignIn, color: '#10b981', bg: '#ecfdf5', border: '#a7f3d0',
    edge: { label: 'tokens in body', dashed: true } },
  { label: 'httpOnly session cookie', sub: 'Tokens stay server-side', icon: Cookie, color: '#f59e0b', bg: '#fffbeb', border: '#fde68a' },
]

export default function AuthFlowDiagram() {
  return (
    <FlowDiagram
      nodes={nodes}
      caption="The browser only ever holds your app's own session cookie — never the LearnHouse tokens. To refresh, your server re-sends the stored refresh token to GET /auth/refresh as a Cookie: LH_refresh=… header (the endpoint reads it only from that cookie)."
    />
  )
}
