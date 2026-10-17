import { NextRequest, NextResponse } from 'next/server'
import { requestOriginHost, signOAuthState } from '@/lib/auth/oauth-state'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { redirect_uri, state: clientState, returnOrigin } = body

    if (!redirect_uri) {
      return NextResponse.json(
        { error: 'Missing redirect_uri' },
        { status: 400 }
      )
    }

    // Same rule as the token route: only our own callback path.
    try {
      const ru = new URL(redirect_uri)
      if ((ru.protocol !== 'http:' && ru.protocol !== 'https:') || ru.pathname !== '/auth/callback/google') {
        return NextResponse.json({ error: 'Invalid redirect_uri' }, { status: 400 })
      }
    } catch {
      return NextResponse.json({ error: 'Invalid redirect_uri' }, { status: 400 })
    }

    const clientId = process.env.LEARNHOUSE_GOOGLE_CLIENT_ID
    if (!clientId) {
      return NextResponse.json(
        { error: 'Google OAuth not configured' },
        { status: 500 }
      )
    }

    if (
      !clientState ||
      typeof clientState.csrf !== 'string' ||
      !clientState.csrf ||
      typeof clientState.timestamp !== 'number'
    ) {
      return NextResponse.json({ error: 'Invalid state' }, { status: 400 })
    }

    // returnOrigin is where the callback will bounce the code, so it may only
    // ever be the origin this request actually came from.
    let signedReturnOrigin: string | undefined
    if (returnOrigin !== undefined && returnOrigin !== null) {
      let ro: URL
      try {
        ro = new URL(String(returnOrigin))
      } catch {
        return NextResponse.json({ error: 'Invalid returnOrigin' }, { status: 400 })
      }
      if (
        (ro.protocol !== 'http:' && ro.protocol !== 'https:') ||
        ro.host.toLowerCase() !== requestOriginHost(request)
      ) {
        return NextResponse.json({ error: 'Invalid returnOrigin' }, { status: 400 })
      }
      signedReturnOrigin = ro.origin
    }

    const state = signOAuthState({
      csrf: clientState.csrf,
      callbackUrl: typeof clientState.callbackUrl === 'string' ? clientState.callbackUrl : undefined,
      timestamp: clientState.timestamp,
      returnOrigin: signedReturnOrigin,
    })
    if (!state) {
      return NextResponse.json(
        { error: 'Google OAuth not configured' },
        { status: 500 }
      )
    }

    const googleAuthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    googleAuthUrl.searchParams.set('client_id', clientId)
    googleAuthUrl.searchParams.set('redirect_uri', redirect_uri)
    googleAuthUrl.searchParams.set('response_type', 'code')
    googleAuthUrl.searchParams.set('scope', 'openid email profile')
    googleAuthUrl.searchParams.set('state', state)
    googleAuthUrl.searchParams.set('prompt', 'select_account')

    return NextResponse.json({ url: googleAuthUrl.toString(), state })
  } catch (error: any) {
    console.error('Google authorize error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
