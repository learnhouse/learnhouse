import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { redirect_uri, state, scope } = body

    if (!redirect_uri) {
      return NextResponse.json(
        { error: 'Missing redirect_uri' },
        { status: 400 }
      )
    }

    const clientId = process.env.LEARNHOUSE_GOOGLE_CLIENT_ID
    if (!clientId) {
      return NextResponse.json(
        { error: 'Google OAuth not configured' },
        { status: 500 }
      )
    }

    const googleAuthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    googleAuthUrl.searchParams.set('client_id', clientId)
    googleAuthUrl.searchParams.set('redirect_uri', redirect_uri)
    googleAuthUrl.searchParams.set('response_type', 'code')
    googleAuthUrl.searchParams.set('scope', scope || 'openid email profile')
    googleAuthUrl.searchParams.set('state', state || '')
    googleAuthUrl.searchParams.set('access_type', 'offline')
    googleAuthUrl.searchParams.set('prompt', 'consent')

    return NextResponse.json({ url: googleAuthUrl.toString() })
  } catch (error: any) {
    console.error('Google authorize error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
