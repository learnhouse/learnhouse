'use client'
import PageLoading from '@components/Objects/Loaders/PageLoading';
import { useSession } from 'next-auth/react';
import React, { useContext, createContext, useEffect } from 'react'

export const SessionContext = createContext({}) as any

function LHSessionProvider({ children }: { children: React.ReactNode }) {
    const session = useSession();

    useEffect(() => {
        console.log('useLHSession', session);
    }, [])


    if (session && session.status == 'loading') {
        return <PageLoading />
    }

    else if (session) {
        return (
            <SessionContext.Provider value={session}>
                {console.log('rendered')}
                {children}
            </SessionContext.Provider>
        )
    }
}

export function useLHSession() {
    return useContext(SessionContext)
}

export default LHSessionProvider