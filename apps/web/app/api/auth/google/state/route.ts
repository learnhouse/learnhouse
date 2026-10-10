import { NextRequest, NextResponse } from 'next/server'
import { verifyOAuthState } from '@/lib/auth/oauth-state'

// Verifies a Google OAuth state we signed in /api/auth/google/authorize, so the
// callback page can trust its returnOrigin before bouncing the code anywhere.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const payload = verifyOAuthState(body?.state)
  if (!payload) {
    return NextResponse.json({ valid: false }, { status: 400 })
  }
  return NextResponse.json({
    valid: true,
    returnOrigin: payload.returnOrigin ?? null,
  })
}
