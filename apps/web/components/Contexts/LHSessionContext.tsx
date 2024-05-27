'use client'
import PageLoading from '@components/Objects/Loaders/PageLoading';
import { useSession } from 'next-auth/react';
import React, { useContext, createContext, useEffect } from 'react'

export const SessionContext = createContext({}) as any

function LHSessionProvider({ children }: { children: React.ReactNode }) {
    const session = useSession();

    useEffect(() => {
        console.log('useLHSession', session);
    }, [session])


    if (session.status == 'loading') {
        return <PageLoading />
    }

    else {
        return (
            <SessionContext.Provider value={session}>
                {children}
            </SessionContext.Provider>
        )
    }
}

export function useLHSession() {
    return useContext(SessionContext)
}

export default LHSessionProvider