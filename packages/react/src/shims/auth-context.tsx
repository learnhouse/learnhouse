// The web app's AuthContext runs the whole sign-in flow (refresh cookies,
// OAuth, redirects). Inside a host app the session is whatever the host hands
// to <LearnHouseProvider> (`session` / `getSession`), so blocks get it from
// there, in both shapes the web app exposes: useSession() and useAuth().
import { useLearnHouseInternal } from '../context'

export interface Session {
  user: any | undefined
  roles?: any[] | undefined
  tokens?: { access_token?: string; refresh_token?: string; expiry?: number }
}

export type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated'

export interface UseSessionReturn {
  data: Session | null
  status: SessionStatus
  update: (_force?: boolean) => Promise<void>
}

export function useSession(): UseSessionReturn {
  return useLearnHouseInternal().session
}

const hostOnly = (what: string) => async (): Promise<never> => {
  throw new Error(`@learnhouse/react: ${what} is handled by the host app (pass \`getSession\` to LearnHouseProvider)`)
}

export function useAuth() {
  const internal = useLearnHouseInternal()
  const session = internal.session
  const accessToken = session.data?.tokens?.access_token ?? null
  return {
    // useSession() shape, kept for blocks that read it through useAuth().
    data: session.data,
    update: session.update,
    // The web app's useAuth() shape.
    session: session.data,
    status: session.status,
    accessToken,
    getAccessToken: internal.getAccessToken,
    refreshSession: async () => {
      await session.update(true)
      return internal.getAccessToken()
    },
    signIn: hostOnly('sign-in'),
    signOut: async () => {},
    completeMfaLogin: hostOnly('sign-in'),
    requestMagicLink: hostOnly('sign-in'),
    completeMagicLink: hostOnly('sign-in'),
  }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  return children
}

export const signIn = hostOnly('sign-in')

export async function signOut(): Promise<void> {}

export default SessionProvider
