import { LEARNHOUSE_TOP_DOMAIN } from '@services/config/config'

const cookiePrefix = '__LRN-'
const cookieDomain =
  LEARNHOUSE_TOP_DOMAIN ==  `.${LEARNHOUSE_TOP_DOMAIN}`
const cookieSecure = LEARNHOUSE_TOP_DOMAIN == 'localhost' ? true : true
const cookieSameSite = LEARNHOUSE_TOP_DOMAIN == 'localhost' ? 'lax' : 'None'

export const cookiesOptions = {
  sessionToken: {
    name: `__Secure-next-auth.session-token`,
    options: {
      domain: cookieDomain,
      httpOnly: true,
      sameSite: cookieSameSite,
      path: '/',
      secure: cookieSecure,
    },
  },
  callbackUrl: {
    name: `__Secure-next-auth.callback-url`,
    options: {
      domain: cookieDomain,
      httpOnly: true,
      sameSite: cookieSameSite,
      path: '/',
      secure: cookieSecure,
    },
  },
  csrfToken: {
    name: `__Host-next-auth.csrf-token`,
    options: {
      domain: cookieDomain,
      httpOnly: true,
      sameSite: cookieSameSite,
      path: '/',
      secure: cookieSecure,
    },
  },
  pkceCodeVerifier: {
    name: `${cookiePrefix}next-auth.pkce.code_verifier`,
    options: {
      domain: cookieDomain,
      httpOnly: true,
      sameSite: cookieSameSite,
      path: '/',
      secure: cookieSecure,
    },
  },
  state: {
    name: `${cookiePrefix}next-auth.state`,
    options: {
      domain: cookieDomain,
      httpOnly: true,
      sameSite: cookieSameSite,
      path: '/',
      secure: cookieSecure,
    },
  },
  nonce: {
    name: `${cookiePrefix}next-auth.nonce`,
    options: {
      domain: cookieDomain,
      httpOnly: true,
      sameSite: cookieSameSite,
      path: '/',
      secure: cookieSecure,
    },
  },
}
