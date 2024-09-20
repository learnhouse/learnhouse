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
import type { NextAuthConfig } from 'next-auth'

export const isDevEnv = LEARNHOUSE_TOP_DOMAIN == 'localhost' ? true : false

export default {
  debug: true,
  trustHost: true,
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
      async authorize(credentials: any, req: any) {
        // logic to verify if user exists
        let unsanitized_req = await loginAndGetToken(
          credentials?.email,
          credentials?.password
        )
        let res = await getResponseMetadata(unsanitized_req)

        //comment added by ARUN
        console.log("getResponseMetadata ")
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
      checks: ['none']
    }),
  ],
  pages: {
    signIn: getUriWithOrg('auth', '/'),
    verifyRequest: getUriWithOrg('auth', '/'),
    error: getUriWithOrg('auth', '/'), // Error code passed in query string as ?error=
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
} satisfies NextAuthConfig
