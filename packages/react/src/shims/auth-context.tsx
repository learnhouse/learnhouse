// The web app's AuthContext runs the whole sign-in flow (refresh cookies,
// OAuth, redirects). Inside a host app the session is whatever the host hands
// to <LearnHouseProvider>, so blocks get it from there.
import { useLearnHouseInternal } from '../context'

export interface Session {
  user: any | undefined
  roles?: string[] | undefined
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

export function useAuth() {
  return useLearnHouseInternal().session
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  return children
}

export async function signIn(): Promise<never> {
  throw new Error('@learnhouse/react: sign-in is handled by the host app (pass `getToken` to LearnHouseProvider)')
}

export async function signOut(): Promise<void> {}

export default SessionProvider
