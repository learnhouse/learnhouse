import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { code, redirect_uri } = body

    if (!code || !redirect_uri) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      )
    }

    // Validate redirect_uri before forwarding it to Google: it must be a well-
    // formed http(s) URL pointing at our own callback path. Google additionally
    // enforces it against the registered URIs, but validating here rejects
    // malformed / scheme-injection values early (RFC 6749 §4.1.3).
    try {
      const ru = new URL(redirect_uri)
      if ((ru.protocol !== 'http:' && ru.protocol !== 'https:') || ru.pathname !== '/auth/callback/google') {
        return NextResponse.json({ error: 'Invalid redirect_uri' }, { status: 400 })
      }
    } catch {
      return NextResponse.json({ error: 'Invalid redirect_uri' }, { status: 400 })
    }

    const clientId = process.env.LEARNHOUSE_GOOGLE_CLIENT_ID
    const clientSecret = process.env.LEARNHOUSE_GOOGLE_CLIENT_SECRET

    if (!clientId || !clientSecret) {
      return NextResponse.json(
        { error: 'Google OAuth not configured' },
        { status: 500 }
      )
    }

    // Exchange code for tokens with Google
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri,
        grant_type: 'authorization_code',
      }),
    })

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json().catch(() => ({}))
      console.error('Google token exchange failed:', errorData)
      return NextResponse.json(
        { error: errorData.error_description || 'Token exchange failed' },
        { status: tokenResponse.status }
      )
    }

    const tokenData = await tokenResponse.json()

    return NextResponse.json({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_in: tokenData.expires_in,
      token_type: tokenData.token_type,
      id_token: tokenData.id_token,
    })
  } catch (error: any) {
    console.error('Google token exchange error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
