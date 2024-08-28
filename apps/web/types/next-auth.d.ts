// eslint-disable-next-line unused-imports/no-unused-imports
import type { nextAuthConfig } from 'next-auth/index';

// next-auth.d.ts
declare module 'next-auth' {
  interface Session {
    user: any | undefined
    roles?: string[] | undefined
    tokens?:
      | {
          access_token?: string | undefined
          refresh_token?: string | undefined
        }
      | undefined
  }
}
