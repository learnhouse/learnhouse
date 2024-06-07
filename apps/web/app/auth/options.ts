import {
  getNewAccessTokenUsingRefreshTokenServer,
  getUserSession,
  loginAndGetToken,
  loginWithOAuthToken,
} from '@services/auth/auth'
import { LEARNHOUSE_TOP_DOMAIN, getUriWithOrg } from '@services/config/config'
import { getResponseMetadata } from '@services/utils/ts/requests'
import CredentialsProvider from 'next-auth/providers/credentials'
import GoogleProvider from 'next-auth/providers/google'

const isDevEnv = LEARNHOUSE_TOP_DOMAIN == 'localhost' ? true : false

export const nextAuthOptions = {
  debug: true,
  providers: [
    CredentialsProvider({
      // The name to display on the sign in form (e.g. 'Sign in with...')
      name: 'Credentials',
      // The credentials is used to generate a suitable form on the sign in page.
      // You can specify whatever fields you are expecting to be submitted.
      // e.g. domain, username, password, 2FA token, etc.
      // You can pass any HTML attribute to the <input> tag through the object.
      credentials: {
        email: { label: 'Email', type: 'text', placeholder: 'jsmith' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, req) {
        // logic to verify if user exists
        let unsanitized_req = await loginAndGetToken(
          credentials?.email,
          credentials?.password
        )
        let res = await getResponseMetadata(unsanitized_req)
        if (res.success) {
          // If login failed, then this is the place you could do a registration
          return res.data
        } else {
          return null
        }
      },
    }),
    GoogleProvider({
      clientId: process.env.LEARNHOUSE_GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.LEARNHOUSE_GOOGLE_CLIENT_SECRET || '',
    }),
  ],
  pages: {
    signIn: getUriWithOrg('auth', '/'),
    verifyRequest: getUriWithOrg('auth', '/'),
    error: getUriWithOrg('auth', '/'), // Error code passed in query string as ?error=
  },
  cookies: {
    sessionToken: {
      name: `${!isDevEnv ? '__Secure-' : ''}next-auth.session-token`,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        // When working on localhost, the cookie domain must be omitted entirely (https://stackoverflow.com/a/1188145)
        domain: `.${LEARNHOUSE_TOP_DOMAIN}`,
        secure: !isDevEnv,
      },
    },
  },
  callbacks: {
    async jwt({ token, user, account }: any) {
      // First sign in with Credentials provider
      if (account?.provider == 'credentials' && user) {
        token.user = user
      }

      // Sign up with Google
      if (account?.provider == 'google' && user) {
        let unsanitized_req = await loginWithOAuthToken(
          user.email,
          'google',
          account.access_token
        )
        let userFromOAuth = await getResponseMetadata(unsanitized_req)
        token.user = userFromOAuth.data
      }

        // Refresh token
        // TODO : Improve this implementation
        if (token?.user?.tokens) {
          const RefreshedToken = await getNewAccessTokenUsingRefreshTokenServer(
            token?.user?.tokens?.refresh_token
          )
          token = {
            ...token,
            user: {
              ...token.user,
              tokens: {
                ...token.user.tokens,
                access_token: RefreshedToken.access_token,
              },
            },
          }
        }
        return token
    },
    async session({ session, token }: any) {
      // Include user information in the session
      if (token.user) {
        let api_SESSION = await getUserSession(token.user.tokens.access_token)
        session.user = api_SESSION.user
        session.roles = api_SESSION.roles
        session.tokens = token.user.tokens
      }
      return session
    },
  },
}
