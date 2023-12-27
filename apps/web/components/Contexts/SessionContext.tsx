'use client';
import { getNewAccessTokenUsingRefreshToken, getUserSession } from '@services/auth/auth';
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import React, { useContext, createContext, useEffect } from 'react'
import { useOrg } from './OrgContext';

export const SessionContext = createContext({}) as any;

const PATHS_THAT_REQUIRE_AUTH = ['/dash'];

type Session = {
    access_token: string;
    user: any;
    roles: any;
    isLoading: boolean;
    isAuthenticated: boolean;
}

function SessionProvider({ children }: { children: React.ReactNode }) {
    const [session, setSession] = React.useState<Session>({ access_token: "", user: {}, roles: {}, isLoading: true, isAuthenticated: false });
    const org = useOrg() as any;
    const pathname = usePathname()
    const router = useRouter()


    async function getNewAccessTokenUsingRefreshTokenUI() {
        let data = await getNewAccessTokenUsingRefreshToken();
        return data.access_token;
    }

    async function checkSession() {
        // Get new access token using refresh token
        const access_token = await getNewAccessTokenUsingRefreshTokenUI();

        if (access_token) {
            // Get user session info
            const user_session = await getUserSession(access_token);

            // Set session
            setSession({ access_token: access_token, user: user_session.user, roles: user_session.roles, isLoading: false, isAuthenticated: true });
        }
    }



    useEffect(() => {
        // Check session
        checkSession();



    }, [])

    return (
        <SessionContext.Provider value={session}>
            {children}
        </SessionContext.Provider>
    )
}

export function useSession() {
    return useContext(SessionContext);
}

export default SessionProvider