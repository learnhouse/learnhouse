// Request body for POST /api/auth/google/authorize. Kept in one place so every
// Google sign-in entry point (login, signup, invite links) sends the shape the
// route validates: `state` is a plain object that the server signs, never a
// string the browser encoded itself.
export interface GoogleAuthorizeBody {
  redirect_uri: string
  state: { callbackUrl: string; csrf: string; timestamp: number }
  returnOrigin?: string
}

export function buildGoogleAuthorizeBody(input: {
  redirectUri: string
  callbackUrl: string
  csrf: string
  returnOrigin?: string
  now?: number
}): GoogleAuthorizeBody {
  return {
    redirect_uri: input.redirectUri,
    state: {
      callbackUrl: input.callbackUrl,
      csrf: input.csrf,
      timestamp: input.now ?? Date.now(),
    },
    ...(input.returnOrigin ? { returnOrigin: input.returnOrigin } : {}),
  }
}
