import {
  getNewAccessTokenUsingRefreshTokenServer,
  getUserSession,
  loginAndGetToken,
  loginWithOAuthToken,
} from '@services/auth/auth'
import {
    getLEARNHOUSE_TELEMETRY_DISABLED_VAL,
    getLEARNHOUSE_TOP_DOMAIN_VAL,
    getUriWithOrg
} from '@services/config/config'
import { getResponseMetadata } from '@services/utils/ts/requests'
import CredentialsProvider from 'next-auth/providers/credentials'
import GoogleProvider from 'next-auth/providers/google'

// Add type declarations at the top of the file
declare global {
  var sessionCache: {
    [key: string]: {
      data: any;
      timestamp: number;
    };
  };
}

export const isDevEnv = getLEARNHOUSE_TOP_DOMAIN_VAL() == 'localhost' ? true : false
export const isTelemetryDisabled = getLEARNHOUSE_TELEMETRY_DISABLED_VAL() === 'true'

export const nextAuthOptions = {
  debug: isDevEnv,
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
        sso: { label: 'SSO', type: 'hidden' },
        sso_access_token: { label: 'SSO Access Token', type: 'hidden' },
        sso_refresh_token: { label: 'SSO Refresh Token', type: 'hidden' },
        sso_user: { label: 'SSO User', type: 'hidden' },
      },
      async authorize(credentials, req) {
        // Handle SSO login - tokens already obtained from backend
        if (credentials?.sso === 'true' && credentials?.sso_access_token) {
          try {
            const user = credentials.sso_user ? JSON.parse(credentials.sso_user) : null
            return {
              user: user,
              tokens: {
                access_token: credentials.sso_access_token,
                refresh_token: credentials.sso_refresh_token,
                expiry: Date.now() + (8 * 60 * 60 * 1000), // 8 hours
              },
            }
          } catch (e) {
            console.error('SSO login error:', e)
            return null
          }
        }

        // Regular credentials login
        let unsanitized_req = await loginAndGetToken(
          credentials?.email,
          credentials?.password
        )
        let res = await getResponseMetadata(unsanitized_req)
        if (res.success) {
          return res.data
        } else {
          // Throw error with backend error details so frontend can display proper message
          const errorData = res.data?.detail || res.data
          throw new Error(JSON.stringify({
            code: errorData?.code || 'UNKNOWN_ERROR',
            message: errorData?.message || 'Login failed',
            email: errorData?.email,
            retry_after: errorData?.retry_after,
          }))
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
        domain: `.${getLEARNHOUSE_TOP_DOMAIN_VAL()}`,
        secure: !isDevEnv,
      },
    },
  },
  callbacks: {
    async jwt({ token, user, account }: any) {
      // First sign in with Credentials provider
      if (account?.provider == 'credentials' && user) {
        token.user = user;
      }

      // Sign up with Google
      if (account?.provider == 'google' && user) {
        // Read org_id from cookie
        const { cookies } = require('next/headers');
        const cookieStore = cookies();
        const orgIdCookie = cookieStore.get('learnhouse_oauth_org_id');
        const orgId = orgIdCookie?.value ? parseInt(orgIdCookie.value, 10) : undefined;

        let unsanitized_req = await loginWithOAuthToken(
          user.email,
          'google',
          account.access_token,
          orgId
        );
        let userFromOAuth = await getResponseMetadata(unsanitized_req);
        token.user = userFromOAuth.data;
      }

      // Refresh token only if it's close to expiring (1 minute before expiry)
      if (token?.user?.tokens) {
        const tokenExpiry = token.user.tokens.expiry || 0;
        const oneMinute = 1 * 60 * 1000;

        if (Date.now() + oneMinute >= tokenExpiry) {
          try {
            const RefreshedToken = await getNewAccessTokenUsingRefreshTokenServer(
              token?.user?.tokens?.refresh_token
            );
            // Only update token if refresh succeeded
            if (RefreshedToken?.access_token) {
              token = {
                ...token,
                user: {
                  ...token.user,
                  tokens: {
                    ...token.user.tokens,
                    access_token: RefreshedToken.access_token,
                    expiry: Date.now() + (60 * 60 * 1000), // 1 hour from now
                  },
                },
              };
            }
          } catch (error) {
            console.error("Token refresh failed:", error);
            // Keep existing token if refresh fails
          }
        }
      }
      return token;
    },
    async session({ session, token }: any) {
      // Include user information in the session
      if (token.user && token.user.tokens?.access_token) {
        // Cache the session for 10 seconds for quick role updates
        const cacheKey = `user_session_${token.user.tokens.access_token}`;

        // Initialize cache if it doesn't exist
        if (!global.sessionCache) {
          global.sessionCache = {};
        }

        // Prevent memory leak: clear cache if it grows too large
        if (Object.keys(global.sessionCache).length > 1000) {
          global.sessionCache = {};
        }

        let cachedSession = global.sessionCache[cacheKey];
        const now = Date.now();

        if (cachedSession && now - cachedSession.timestamp < 10 * 1000) {
          return cachedSession.data;
        }

        try {
          let api_SESSION = await getUserSession(token.user.tokens.access_token);

          if (api_SESSION && api_SESSION.user) {
            session.user = api_SESSION.user;
            session.roles = api_SESSION.roles;
            session.tokens = token.user.tokens;

            // Cache the session
            global.sessionCache[cacheKey] = {
              data: session,
              timestamp: now
            };
          } else {
            // If API session fetch fails, fall back to what we have in token
            if (token.user?.user) {
              session.user = token.user.user;
            }
            session.tokens = token.user.tokens;
            session.roles = [];
          }
        } catch (error) {
          console.error("Error in session callback:", error);
          // Fall back to token data if API fails
          if (token.user?.user) {
            session.user = token.user.user;
          }
          session.tokens = token.user.tokens;
          session.roles = [];
        }
      } else if (token.user) {
        // Token exists but no valid access_token - set what we can
        if (token.user?.user) {
          session.user = token.user.user;
        }
        session.tokens = token.user.tokens || {};
        session.roles = [];
      }
      return session;
    },
  },
}
